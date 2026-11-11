import DIPCore
import XCTest
@testable import DIP

@MainActor
final class PushRegistrarTests: XCTestCase {
    final class FakeAPI: PushDeviceAPI {
        var registered: [(token: String, version: String)] = []
        var unregistered: [String] = []
        var failRegister = false
        var failUnregister = false
        struct Failure: Error {}
        func register(token: String, appVersion: String) async throws {
            if failRegister { throw Failure() }
            registered.append((token, appVersion))
        }
        func unregister(token: String) async throws {
            unregistered.append(token)
            if failUnregister { throw Failure() }
        }
    }

    final class FakeSystem: PushSystem {
        var status: DIPPushAuthorization = .notDetermined
        var grant = true
        var token: String?
        var remoteRegistrations = 0
        var prompts = 0
        func authorization() async -> DIPPushAuthorization { status }
        func requestAuthorization() async -> Bool { prompts += 1; if grant { status = .authorized }; return grant }
        func registerForRemoteNotifications() { remoteRegistrations += 1 }
        func currentToken() async -> String? { token }
        var deletedTokens = 0
        func deleteToken() async { deletedTokens += 1 }
    }

    final class FakeStore: PushStateStore {
        var hasPrimed = false
        var registeredKey: String?
        var pendingUnregisterToken: String?
    }

    private func make(enabled: Bool = true) -> (PushCoordinator, PushRegistrar, FakeAPI, FakeSystem, FakeStore) {
        let api = FakeAPI(), system = FakeSystem(), store = FakeStore()
        let registrar = PushRegistrar(api: api, system: system, store: store, appVersion: "1.2", enabled: enabled)
        return (PushCoordinator(registrar: registrar, system: system, store: store, enabled: enabled), registrar, api, system, store)
    }

    func testFlagOffDoesNothingAtAll() async {
        let (coordinator, registrar, api, system, store) = make(enabled: false)
        system.status = .authorized; system.token = "t1"
        await registrar.memberSignedIn(uid: "u1")
        await registrar.tokenChanged("t2")
        await coordinator.didJoin()
        XCTAssertFalse(coordinator.isPrimingVisible)
        XCTAssertTrue(api.registered.isEmpty)
        XCTAssertEqual(system.remoteRegistrations, 0)
        let granted = await registrar.requestPermission()
        XCTAssertFalse(granted)
        XCTAssertFalse(store.hasPrimed)
    }

    func testAuthorizedMemberRegistersOnceAndTokenRefreshReRegisters() async {
        let (_, registrar, api, system, store) = make()
        system.status = .authorized; system.token = "t1"
        await registrar.memberSignedIn(uid: "u1")
        await registrar.memberSignedIn(uid: "u1")                      // relaunch with the same token: no duplicate call
        XCTAssertEqual(api.registered.map(\.token), ["t1"])
        XCTAssertEqual(api.registered.first?.version, "1.2")
        XCTAssertEqual(store.registeredKey, "u1|t1")
        await registrar.tokenChanged("t2")
        await registrar.tokenChanged("t2")
        XCTAssertEqual(api.registered.map(\.token), ["t1", "t2"])
    }

    func testNotAuthorizedOrSignedOutMembersAreNotRegistered() async {
        let (_, registrar, api, system, _) = make()
        system.status = .denied; system.token = "t1"
        await registrar.memberSignedIn(uid: "u1")
        XCTAssertTrue(api.registered.isEmpty)
        XCTAssertEqual(system.remoteRegistrations, 0)
        await registrar.memberSigningOut()
        await registrar.tokenChanged("t9")                    // token arriving while signed out is ignored
        XCTAssertTrue(api.registered.isEmpty)
    }

    func testRegistrationFailureIsRetriedLaterAndNeverThrows() async {
        let (_, registrar, api, system, store) = make()
        system.status = .authorized; system.token = "t1"
        api.failRegister = true
        await registrar.memberSignedIn(uid: "u1")
        XCTAssertNil(store.registeredKey)
        api.failRegister = false
        await registrar.memberSignedIn(uid: "u1")
        XCTAssertEqual(store.registeredKey, "u1|t1")
    }

    func testSignOutUnregistersDropsTheTokenAndRetriesAFailureAtNextSignIn() async {
        let (_, registrar, api, system, store) = make()
        system.status = .authorized; system.token = "t1"
        await registrar.memberSignedIn(uid: "u1")
        api.failUnregister = true
        await registrar.memberSigningOut()                    // best effort: never blocks sign-out
        XCTAssertEqual(api.unregistered, ["t1"])
        XCTAssertNil(store.registeredKey)
        XCTAssertEqual(store.pendingUnregisterToken, "t1", "Remembered for a retry")
        XCTAssertEqual(system.deletedTokens, 1)
        api.failUnregister = false
        await registrar.memberSignedIn(uid: "u2")             // next sign-in retries, then registers the new member
        XCTAssertEqual(api.unregistered, ["t1", "t1"])
        XCTAssertNil(store.pendingUnregisterToken)
    }

    func testADifferentMemberOnTheSamePhoneRegistersAgainAfterAnUncleanSessionEnd() async {
        let (_, registrar, api, system, store) = make()
        system.status = .authorized; system.token = "t1"
        await registrar.memberSignedIn(uid: "alice")
        XCTAssertEqual(store.registeredKey, "alice|t1")
        // Alice's session ended without sign-out (expired/revoked); Bob signs in with the same token.
        await registrar.memberSignedIn(uid: "bob")
        XCTAssertEqual(api.registered.map(\.token), ["t1", "t1"])
        XCTAssertEqual(store.registeredKey, "bob|t1")
    }

    func testForegroundRefreshPicksUpAPermissionGrantedLaterInSettings() async {
        let (_, registrar, api, system, _) = make()
        system.status = .denied; system.token = "t1"
        await registrar.memberSignedIn(uid: "u1")
        XCTAssertTrue(api.registered.isEmpty)
        system.status = .authorized                          // the member enabled notifications in iOS Settings
        await registrar.refresh()
        XCTAssertEqual(api.registered.map(\.token), ["t1"])
    }

    func testALinkThatArrivesBeforeTheHandlerIsAttachedIsDeliveredLater() {
        let (coordinator, _, _, _, _) = make()
        coordinator.handleDeepLink("dip://events/abc123/chat")      // cold launch: tap before the app attached its inbox
        var received: [String] = []
        coordinator.onLink = { received.append($0.absoluteString) }
        XCTAssertEqual(received, ["dip://events/abc123/chat"])
        coordinator.handleDeepLink("dip://events/def456")
        XCTAssertEqual(received.count, 2)
    }

    func testPrimingAppearsOnlyAfterTheFirstJoinAndOnlyOnce() async {
        let (coordinator, _, api, system, store) = make()
        // Nothing at launch or sign-in.
        XCTAssertFalse(coordinator.isPrimingVisible)
        await coordinator.memberSignedIn(uid: "u1")
        XCTAssertFalse(coordinator.isPrimingVisible)
        XCTAssertEqual(system.prompts, 0)

        await coordinator.didJoin()
        XCTAssertTrue(coordinator.isPrimingVisible)
        coordinator.primingDeclined()
        XCTAssertFalse(coordinator.isPrimingVisible)
        XCTAssertTrue(store.hasPrimed)
        await coordinator.didJoin()
        XCTAssertFalse(coordinator.isPrimingVisible, "Never asks twice")
        XCTAssertEqual(system.prompts, 0)
        XCTAssertTrue(api.registered.isEmpty)
    }

    func testAcceptingPrimingShowsTheSystemPromptAndRegistersWhenGranted() async {
        let (coordinator, _, api, system, store) = make()
        system.token = "t1"
        await coordinator.memberSignedIn(uid: "u1")
        await coordinator.didJoin()
        await coordinator.primingAccepted()
        XCTAssertEqual(system.prompts, 1)
        XCTAssertTrue(store.hasPrimed)
        XCTAssertEqual(system.remoteRegistrations, 1)
        XCTAssertEqual(api.registered.map(\.token), ["t1"])
    }

    func testDeniedPermissionRegistersNothing() async {
        let (coordinator, _, api, system, _) = make()
        system.grant = false; system.token = "t1"
        await coordinator.memberSignedIn(uid: "u1")
        await coordinator.didJoin()
        await coordinator.primingAccepted()
        XCTAssertEqual(system.remoteRegistrations, 0)
        XCTAssertTrue(api.registered.isEmpty)
    }

    func testAlreadyDecidedUsersAreNeverPrimed() async {
        for status in [DIPPushAuthorization.denied, .authorized] {
            let (coordinator, _, _, system, _) = make()
            system.status = status
            await coordinator.didJoin()
            XCTAssertFalse(coordinator.isPrimingVisible, "\(status)")
        }
    }

    func testNotificationTapsForwardOnlyValidDeepLinks() {
        let (coordinator, _, _, _, _) = make()
        var received: [URL] = []
        coordinator.onLink = { received.append($0) }
        coordinator.handleDeepLink("dip://events/abc123")
        coordinator.handleDeepLink("dip://events/abc123/chat")
        coordinator.handleDeepLink("https://evil.example/e/abc123")
        coordinator.handleDeepLink("dip://events/abc123/photos")
        coordinator.handleDeepLink("not a url")
        XCTAssertEqual(received.map(\.absoluteString), ["dip://events/abc123", "dip://events/abc123/chat"])
    }

    func testLinkInboxKeepsTheChatFlagUntilConsumed() {
        let inbox = EventLinkInbox()
        XCTAssertTrue(inbox.receive(URL(string: "dip://events/abc123/chat")!))
        XCTAssertEqual(inbox.pendingEventID, "abc123")
        XCTAssertTrue(inbox.pendingOpensChat)
        inbox.consume("abc123")
        XCTAssertNil(inbox.pendingEventID)
        XCTAssertFalse(inbox.pendingOpensChat)
        XCTAssertTrue(inbox.receive(URL(string: "https://team05-dip.web.app/e/xyz")!))
        XCTAssertFalse(inbox.pendingOpensChat)
        XCTAssertFalse(inbox.receive(URL(string: "dip://settings")!))
    }
}
