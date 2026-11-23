import DIPCore
import UserNotifications
import XCTest
@testable import DIP

@MainActor
final class PushNotificationActionTests: XCTestCase {
    /// Records `respond` calls; can fail or hold the call open to test a second press.
    final class FakeInvites: DIPInvitesRepository, @unchecked Sendable {
        var responses: [(inviteID: String, accept: Bool)] = []
        var failure: DIPInviteFailure?
        var hold = false
        /// Called when a `respond` call starts (lets a test wait for it without spinning).
        var onCall: (() -> Void)?
        private var gate: CheckedContinuation<Void, Never>?
        func observe() async -> AsyncThrowingStream<DIPInvites, Error> { AsyncThrowingStream { $0.finish() } }
        func searchCoworkers(eventID: String, query: String) async throws -> [DIPCoworker] { [] }
        func send(eventID: String, toUserID: String, message: String, requestID: String) async throws {}
        func respond(inviteID: String, accept: Bool) async throws -> DIPInviteReply {
            responses.append((inviteID, accept))
            onCall?(); onCall = nil
            if hold { await withCheckedContinuation { gate = $0 } }
            if let failure { throw failure }
            return DIPInviteReply(status: accept ? .accepted : .declined, joined: accept)
        }
        func release() { hold = false; gate?.resume(); gate = nil }
    }

    private let invitePayload = PushPayload(type: "invite", companyID: "company1", eventID: "event1", inviteID: "invite1",
                                            deepLink: "dip://events/event1")

    private func coordinator(responder: PushInviteResponder?) -> (PushCoordinator, PushRegistrarTests.FakeSystem) {
        let system = PushRegistrarTests.FakeSystem()
        let store = PushRegistrarTests.FakeStore()
        let registrar = PushRegistrar(api: PushRegistrarTests.FakeAPI(), system: system, store: store, appVersion: "1", enabled: true)
        return (PushCoordinator(registrar: registrar, system: system, store: store, enabled: true, inviteResponder: responder), system)
    }

    // MARK: Payload and links

    func testPayloadReadsTheDataKeysAndIgnoresEmptyOrNonStringValues() {
        let payload = PushPayload(userInfo: ["type": "invite", "companyId": "c1", "eventId": " e1 ", "inviteId": "", "deepLink": 42,
                                             "aps": ["category": "DIP_INVITE"]])
        XCTAssertEqual(payload, PushPayload(type: "invite", companyID: "c1", eventID: "e1", inviteID: nil, deepLink: nil))
    }

    func testAnyTypeFallsBackToItsDeepLinkThenToTheEventPage() {
        // Known, new and unknown types all route by link, never by type.
        for type in ["chat", "photo_comment", "photo_added", "attendee_removed", "something_from_the_future", nil] {
            XCTAssertEqual(PushPayload(type: type, eventID: "e1", deepLink: "dip://events/e1/chat").link?.absoluteString, "dip://events/e1/chat")
        }
        XCTAssertEqual(PushPayload(type: "photo_added", eventID: "e1").link?.absoluteString, "dip://events/e1")
        XCTAssertEqual(PushPayload(eventID: "e1", deepLink: "https://evil.example/e/x").link?.absoluteString, "dip://events/e1")
        XCTAssertEqual(PushPayload(eventID: "e1", deepLink: "dip://challenges/w1").link?.absoluteString, "dip://events/e1")
        XCTAssertNil(PushPayload(type: "weekly_theme", deepLink: "dip://challenges/w1").link)
        XCTAssertNil(PushPayload(eventID: "../x").link)
        XCTAssertNil(PushPayload().link)
    }

    func testActionIdentifiersMatchTheServerCategory() {
        XCTAssertEqual(PushResponseAction(identifier: "DIP_INVITE_ACCEPT"), .answerInvite(accept: true))
        XCTAssertEqual(PushResponseAction(identifier: "DIP_INVITE_DECLINE"), .answerInvite(accept: false))
        XCTAssertEqual(PushResponseAction(identifier: UNNotificationDefaultActionIdentifier), .open)
        XCTAssertEqual(PushResponseAction(identifier: "SOMETHING_NEW"), .open)
    }

    func testInviteCategoryHasBackgroundButtonsThatNeedAnUnlockedDevice() {
        let category = SystemPushAdapter.inviteCategory()
        XCTAssertEqual(category.identifier, "DIP_INVITE")
        XCTAssertEqual(category.actions.map(\.identifier), ["DIP_INVITE_ACCEPT", "DIP_INVITE_DECLINE"])
        for action in category.actions {
            XCTAssertTrue(action.options.contains(.authenticationRequired), action.identifier)
            XCTAssertFalse(action.options.contains(.foreground), action.identifier)
            XCTAssertFalse(action.options.contains(.destructive), action.identifier)
            XCTAssertFalse(action.title.isEmpty)
        }
    }

    // MARK: Invite responder

    func testAcceptAndDeclineUseTheInvitesRepositoryForThePushCompany() async {
        let invites = FakeInvites()
        var companies: [String] = []
        let responder = PushInviteResponder(makeRepository: { companies.append($0); return invites })
        let accepted = await responder.answer(accept: true, payload: invitePayload)
        let declined = await responder.answer(accept: false, payload: invitePayload)
        XCTAssertEqual(accepted, .answered)
        XCTAssertEqual(declined, .answered)
        XCTAssertEqual(companies, ["company1", "company1"])
        XCTAssertEqual(invites.responses.map(\.inviteID), ["invite1", "invite1"])
        XCTAssertEqual(invites.responses.map(\.accept), [true, false])
    }

    func testAlreadyAnsweredCountsAsDoneAndOtherFailuresOpenTheActivity() async {
        let invites = FakeInvites()
        let responder = PushInviteResponder(makeRepository: { _ in invites })
        invites.failure = .alreadyAnswered
        let repeated = await responder.answer(accept: true, payload: invitePayload)
        XCTAssertEqual(repeated, .answered)
        for failure in [DIPInviteFailure.offline, .full, .notFound, .unauthenticated, .unknown] {
            invites.failure = failure
            let outcome = await responder.answer(accept: true, payload: invitePayload)
            XCTAssertEqual(outcome, .openInvite(URL(string: "dip://events/event1")), "\(failure)")
        }
    }

    func testMissingIdsOrNoSignedInMemberOpenTheActivityWithoutCalling() async {
        let invites = FakeInvites()
        let responder = PushInviteResponder(makeRepository: { _ in invites })
        let noInvite = await responder.answer(accept: true, payload: PushPayload(type: "invite", companyID: "company1", eventID: "event1"))
        let badCompany = await responder.answer(accept: true, payload: PushPayload(companyID: "a/b", eventID: "event1", inviteID: "invite1"))
        XCTAssertEqual(noInvite, .openInvite(URL(string: "dip://events/event1")))
        XCTAssertEqual(badCompany, .openInvite(URL(string: "dip://events/event1")))
        XCTAssertTrue(invites.responses.isEmpty)
        let signedOut = PushInviteResponder(makeRepository: { _ in nil })
        let outcome = await signedOut.answer(accept: false, payload: invitePayload)
        XCTAssertEqual(outcome, .openInvite(URL(string: "dip://events/event1")))
    }

    func testASecondPressWhileTheFirstIsRunningIsIgnored() async {
        let invites = FakeInvites()
        invites.hold = true
        let responder = PushInviteResponder(makeRepository: { _ in invites })
        let payload = invitePayload
        var first: Task<PushInviteResponder.Outcome, Never>!
        await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
            invites.onCall = { started.resume() }
            first = Task { await responder.answer(accept: true, payload: payload) }
        }
        let second = await responder.answer(accept: true, payload: payload)
        XCTAssertEqual(second, .ignored)
        invites.release()
        let firstOutcome = await first.value
        XCTAssertEqual(firstOutcome, .answered)
        XCTAssertEqual(invites.responses.count, 1)
    }

    // MARK: Coordinator

    func testTapOpensTheLinkForAnyType() async {
        let (coordinator, _) = coordinator(responder: nil)
        var opened: [String] = []
        coordinator.onLink = { opened.append($0.absoluteString) }
        await coordinator.handleResponse(.open, payload: PushPayload(type: "photo_comment", eventID: "e1", deepLink: "dip://events/e1"))
        await coordinator.handleResponse(.open, payload: PushPayload(type: "brand_new_type", eventID: "e2"))
        await coordinator.handleResponse(.open, payload: PushPayload(type: "brand_new_type"))   // no link: the app just opens
        XCTAssertEqual(opened, ["dip://events/e1", "dip://events/e2"])
    }

    func testAnsweredInviteOpensNothing() async {
        let invites = FakeInvites()
        let (coordinator, system) = coordinator(responder: PushInviteResponder(makeRepository: { _ in invites }))
        var opened: [URL] = []
        coordinator.onLink = { opened.append($0) }
        await coordinator.handleResponse(.answerInvite(accept: true), payload: invitePayload)
        XCTAssertEqual(invites.responses.count, 1)
        XCTAssertTrue(opened.isEmpty)
        XCTAssertTrue(system.fallbacks.isEmpty)
    }

    func testFailedAnswerInTheBackgroundPostsAFallbackAndInTheForegroundOpensTheActivity() async {
        let invites = FakeInvites()
        invites.failure = .offline
        let (coordinator, system) = coordinator(responder: PushInviteResponder(makeRepository: { _ in invites }))
        var opened: [String] = []
        coordinator.onLink = { opened.append($0.absoluteString) }
        system.isForeground = false
        await coordinator.handleResponse(.answerInvite(accept: true), payload: invitePayload)
        XCTAssertEqual(system.fallbacks, [URL(string: "dip://events/event1")])
        XCTAssertTrue(opened.isEmpty)
        system.isForeground = true
        await coordinator.handleResponse(.answerInvite(accept: false), payload: invitePayload)
        XCTAssertEqual(opened, ["dip://events/event1"])
        XCTAssertEqual(system.fallbacks.count, 1)
    }

    func testWithoutAResponderTheButtonsFallBackToTheActivity() async {
        let (coordinator, system) = coordinator(responder: nil)
        await coordinator.handleResponse(.answerInvite(accept: true), payload: invitePayload)
        XCTAssertEqual(system.fallbacks, [URL(string: "dip://events/event1")])
    }
}
