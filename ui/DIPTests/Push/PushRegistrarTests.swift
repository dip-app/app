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
        /// While set, `register` suspends until `releaseRegister()`; lets a test sign out mid-flight.
        var holdRegister = false
        var registerStarted = 0
        private var gate: CheckedContinuation<Void, Never>?
        struct Failure: Error {}
        func register(token: String, appVersion: String) async throws {
            registerStarted += 1
            if holdRegister { await withCheckedContinuation { gate = $0 } }
            if failRegister { throw Failure() }
            registered.append((token, appVersion))
        }
        func releaseRegister() { holdRegister = false; gate?.resume(); gate = nil }
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
        var failDelete = false
        func deleteToken() async -> Bool { deletedTokens += 1; return !failDelete }
        var isForeground = false
        var fallbacks: [URL?] = []
        func postInviteFallback(link: URL?) async { fallbacks.append(link) }
    }

    final class FakeStore: PushStateStore {
        var hasPrimed = false
        var registeredKey: String?
        var pendingUnregister: String?
        var pendingTokenDeletion = false
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
        XCTAssertEqual(store.pendingUnregister, "u1|t1", "Remembered with its owner for a retry")
        XCTAssertEqual(system.deletedTokens, 1)
        XCTAssertFalse(store.pendingTokenDeletion)
        api.failUnregister = false
        await registrar.memberSignedIn(uid: "u1")             // only the same member can retry the server unregister
        XCTAssertEqual(api.unregistered, ["t1", "t1"])
        XCTAssertNil(store.pendingUnregister)
    }

    func testPendingUnregisterIsNeverRetriedAsADifferentMember() async {
        let (_, registrar, api, system, store) = make()
        system.status = .authorized; system.token = "t1"
        await registrar.memberSignedIn(uid: "u1")
        api.failUnregister = true
        await registrar.memberSigningOut()
        XCTAssertEqual(api.unregistered, ["t1"])
        api.failUnregister = false
        await registrar.memberSignedIn(uid: "u2")
        XCTAssertEqual(api.unregistered, ["t1"], "u2 must not unregister u1's registration")
        XCTAssertNil(store.pendingUnregister, "The stale entry is dropped; the token itself was deleted")
    }

    func testTokenDeletionIsRetriedWhileSignedOutUntilItWorks() async {
        let (_, registrar, api, system, store) = make()
        system.status = .authorized; system.token = "t1"
        await registrar.memberSignedIn(uid: "u1")
        api.failUnregister = true; system.failDelete = true       // offline sign-out
        await registrar.memberSigningOut()
        XCTAssertTrue(store.pendingTokenDeletion)
        XCTAssertEqual(system.deletedTokens, 1)
        await registrar.refresh()                                  // app activation / next launch, still signed out
        XCTAssertEqual(system.deletedTokens, 2)
        XCTAssertTrue(store.pendingTokenDeletion)
        XCTAssertEqual(api.unregistered, ["t1"], "No server unregister while signed out")
        system.failDelete = false
        await registrar.refresh()
        XCTAssertEqual(system.deletedTokens, 3)
        XCTAssertFalse(store.pendingTokenDeletion)
        await registrar.refresh()
        XCTAssertEqual(system.deletedTokens, 3, "Done: nothing more to retry")
    }

    func testSigningOutDuringAnInFlightRegisterDoesNotPersistTheRegistration() async {
        let (_, registrar, api, system, store) = make()
        system.status = .authorized; system.token = "t1"
        api.holdRegister = true
        let signIn = Task { await registrar.memberSignedIn(uid: "u1") }
        while api.registerStarted == 0 { await Task.yield() }
        let signOut = Task { await registrar.memberSigningOut() }
        await Task.yield()
        api.releaseRegister()
        await signIn.value; await signOut.value
        XCTAssertNil(store.registeredKey, "A registration finished after sign-out must not be remembered")
        XCTAssertEqual(api.unregistered, ["t1"], "The late registration is removed again")
        XCTAssertNil(store.pendingUnregister)
        XCTAssertEqual(system.deletedTokens, 1)
    }

    func testPermissionRevokedInSettingsUnregistersAndClearsTheKey() async {
        let (_, registrar, api, system, store) = make()
        system.status = .authorized; system.token = "t1"
        await registrar.memberSignedIn(uid: "u1")
        XCTAssertEqual(store.registeredKey, "u1|t1")
        system.status = .denied
        await registrar.refresh()
        XCTAssertEqual(api.unregistered, ["t1"])
        XCTAssertNil(store.registeredKey)
        system.status = .authorized                                // turned back on: registers again
        await registrar.refresh()
        XCTAssertEqual(api.registered.map(\.token), ["t1", "t1"])
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
        XCTAssertTrue(inbox.receive(URL(string: "https://letsdip.work/e/xyz")!))
        XCTAssertFalse(inbox.pendingOpensChat)
        XCTAssertFalse(inbox.receive(URL(string: "dip://settings")!))
    }

    func testLinkInboxRejectsUnsafeIdsAndClearsWhenTheSessionEnds() {
        let inbox = EventLinkInbox()
        for bad in ["dip://events/..", "dip://events/__x__", "dip://events/%E2%80%A6", "dip://events/a.b", "https://letsdip.work/e/%2E%2E"] {
            XCTAssertFalse(inbox.receive(URL(string: bad)!), bad)
        }
        XCTAssertNil(inbox.pendingEventID)
        XCTAssertTrue(inbox.receive(URL(string: "dip://events/abc123/chat")!))
        inbox.clear()                                   // sign-out or another account: the old link must not open for the next member
        XCTAssertNil(inbox.pendingEventID)
        XCTAssertFalse(inbox.pendingOpensChat)
    }
}
