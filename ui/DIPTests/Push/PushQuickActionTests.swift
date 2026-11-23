import DIPCore
import UserNotifications
import XCTest
@testable import DIP

/// Quick actions other than the invite buttons (docs/design/push-catalog.md, "Quick actions"): categories, action
/// mapping, the responder's calls, idempotency and every fallback. The Firebase adapter is replaced by a fake.
@MainActor
final class PushQuickActionTests: XCTestCase {
    /// Records every member call; can fail or hold a call open to test a second press.
    final class FakeActions: PushMemberActions {
        enum Call: Equatable {
            case leave(String)
            case chat(eventID: String, messageID: String, text: String)
            case comment(eventID: String, photoID: String, commentID: String, text: String)
            case directions(String)
        }
        var calls: [Call] = []
        var failure: Error?
        var directions: URL? = URL(string: "https://maps.apple.com/?q=Park")
        var hold = false
        /// Called when a call starts (lets a test wait for it without spinning).
        var onCall: (() -> Void)?
        private var gate: CheckedContinuation<Void, Never>?

        private func run(_ call: Call) async throws {
            calls.append(call)
            onCall?(); onCall = nil
            if hold { await withCheckedContinuation { gate = $0 } }
            if let failure { throw failure }
        }
        func release() { hold = false; gate?.resume(); gate = nil }

        func leave(eventID: String) async throws { try await run(.leave(eventID)) }
        func sendChat(eventID: String, messageID: String, text: String) async throws {
            try await run(.chat(eventID: eventID, messageID: messageID, text: text))
        }
        func commentOnPhoto(eventID: String, photoID: String, commentID: String, text: String) async throws {
            try await run(.comment(eventID: eventID, photoID: photoID, commentID: commentID, text: text))
        }
        func directionsURL(eventID: String) async throws -> URL? { try await run(.directions(eventID)); return directions }
    }

    private let event = PushPayload(type: "reminder", companyID: "company1", eventID: "event1", deepLink: "dip://events/event1")
    private let chat = PushPayload(type: "chat", companyID: "company1", eventID: "event1", deepLink: "dip://events/event1/chat")
    private let comment = PushPayload(type: "photo_comment", companyID: "company1", eventID: "event1", deepLink: "dip://events/event1",
                                      photoID: "owner_3")
    private let eventLink = URL(string: "dip://events/event1")
    private let chatLink = URL(string: "dip://events/event1/chat")

    private func coordinator(_ responder: PushQuickActionResponder?) -> (PushCoordinator, PushRegistrarTests.FakeSystem) {
        let system = PushRegistrarTests.FakeSystem()
        let store = PushRegistrarTests.FakeStore()
        let registrar = PushRegistrar(api: PushRegistrarTests.FakeAPI(), system: system, store: store, appVersion: "1", enabled: true)
        return (PushCoordinator(registrar: registrar, system: system, store: store, enabled: true, quickActions: responder), system)
    }

    // MARK: Categories and identifiers

    func testEveryServerCategoryIsRegisteredWithAtMostTwoActions() {
        let categories = SystemPushAdapter.categories()
        XCTAssertEqual(Set(categories.map(\.identifier)), Set(PushCategory.all))
        XCTAssertEqual(Set(PushCategory.all), ["DIP_INVITE", "DIP_EVENT_GOING", "DIP_REMINDER", "DIP_CHAT", "DIP_PHOTO_COMMENT", "DIP_OPEN"])
        for category in categories {
            XCTAssertFalse(category.actions.isEmpty, category.identifier)
            XCTAssertLessThanOrEqual(category.actions.count, 2, category.identifier)
            for action in category.actions { XCTAssertFalse(action.title.isEmpty, action.identifier) }
        }
        func actions(_ id: String) -> [String] { categories.first { $0.identifier == id }?.actions.map(\.identifier) ?? [] }
        XCTAssertEqual(actions("DIP_EVENT_GOING"), ["DIP_OPEN", "DIP_EVENT_LEAVE"])
        XCTAssertEqual(actions("DIP_REMINDER"), ["DIP_DIRECTIONS", "DIP_EVENT_LEAVE"])
        XCTAssertEqual(actions("DIP_CHAT"), ["DIP_CHAT_REPLY"])
        XCTAssertEqual(actions("DIP_PHOTO_COMMENT"), ["DIP_PHOTO_COMMENT_REPLY"])
        XCTAssertEqual(actions("DIP_OPEN"), ["DIP_OPEN"])
        XCTAssertEqual(actions("DIP_INVITE"), ["DIP_INVITE_ACCEPT", "DIP_INVITE_DECLINE"])
    }

    func testDataChangingActionsNeedAnUnlockAndStayInTheBackground() {
        let leave = SystemPushAdapter.leaveAction()
        XCTAssertEqual(leave.options, [.authenticationRequired, .destructive])
        for category in [SystemPushAdapter.chatCategory(), SystemPushAdapter.photoCommentCategory()] {
            let reply = try? XCTUnwrap(category.actions.first as? UNTextInputNotificationAction)
            XCTAssertNotNil(reply, category.identifier)
            XCTAssertEqual(reply?.options, [.authenticationRequired], category.identifier)
            XCTAssertFalse(reply?.textInputButtonTitle.isEmpty ?? true)
            XCTAssertFalse(reply?.textInputPlaceholder.isEmpty ?? true)
        }
        // Look-only actions bring the app (or Maps) forward and change nothing.
        XCTAssertEqual(SystemPushAdapter.openAction().options, [.foreground])
        let directions = SystemPushAdapter.reminderCategory().actions.first
        XCTAssertEqual(directions?.options, [.foreground])
    }

    func testActionIdentifiersMapToActions() {
        XCTAssertEqual(PushResponseAction(identifier: "DIP_EVENT_LEAVE"), .leaveEvent)
        XCTAssertEqual(PushResponseAction(identifier: "DIP_DIRECTIONS"), .directions)
        XCTAssertEqual(PushResponseAction(identifier: "DIP_OPEN"), .open)
        XCTAssertEqual(PushResponseAction(identifier: "DIP_CHAT_REPLY", text: "On my way"), .replyChat(text: "On my way"))
        XCTAssertEqual(PushResponseAction(identifier: "DIP_PHOTO_COMMENT_REPLY", text: "Thanks"), .replyPhotoComment(text: "Thanks"))
        // A reply without a text response (should not happen) and unknown actions open the item.
        XCTAssertEqual(PushResponseAction(identifier: "DIP_CHAT_REPLY"), .open)
        XCTAssertEqual(PushResponseAction(identifier: "DIP_FUTURE_ACTION", text: "x"), .open)
    }

    func testPayloadReadsThePhotoID() {
        let payload = PushPayload(userInfo: ["type": "photo_comment", "companyId": "c1", "eventId": "e1", "photoId": "u1_2", "commentId": "x"])
        XCTAssertEqual(payload.photoID, "u1_2")
        XCTAssertNil(PushPayload(userInfo: ["photoId": 7]).photoID)
    }

    // MARK: Can't make it

    func testLeaveUsesTheMemberActionsForThePushCompany() async {
        let actions = FakeActions()
        var companies: [String] = []
        let responder = PushQuickActionResponder(makeActions: { companies.append($0); return actions })
        let outcome = await responder.leave(payload: event)
        XCTAssertEqual(outcome, .done)
        XCTAssertEqual(companies, ["company1"])
        XCTAssertEqual(actions.calls, [.leave("event1")])
    }

    func testLeaveFailuresSignedOutAndMissingIdsFallBackToTheActivity() async {
        let actions = FakeActions()
        actions.failure = RsvpFailure.closed
        let failing = PushQuickActionResponder(makeActions: { _ in actions })
        let failed = await failing.leave(payload: event)
        XCTAssertEqual(failed, .fallback(.leave, eventLink))
        let signedOut = PushQuickActionResponder(makeActions: { _ in nil })
        let noSession = await signedOut.leave(payload: event)
        XCTAssertEqual(noSession, .fallback(.leave, eventLink))
        let fresh = FakeActions()
        let responder = PushQuickActionResponder(makeActions: { _ in fresh })
        let noEvent = await responder.leave(payload: PushPayload(type: "reminder", companyID: "company1"))
        let badCompany = await responder.leave(payload: PushPayload(companyID: "a/b", eventID: "event1"))
        XCTAssertEqual(noEvent, .fallback(.leave, nil))
        XCTAssertEqual(badCompany, .fallback(.leave, eventLink))
        XCTAssertTrue(fresh.calls.isEmpty)
    }

    func testASecondLeaveWhileTheFirstIsRunningIsIgnored() async {
        let actions = FakeActions()
        actions.hold = true
        let responder = PushQuickActionResponder(makeActions: { _ in actions })
        let payload = event
        var first: Task<PushQuickActionResponder.Outcome, Never>!
        await withCheckedContinuation { (started: CheckedContinuation<Void, Never>) in
            actions.onCall = { started.resume() }
            first = Task { await responder.leave(payload: payload) }
        }
        let second = await responder.leave(payload: payload)
        XCTAssertEqual(second, .ignored)
        actions.release()
        let firstOutcome = await first.value
        XCTAssertEqual(firstOutcome, .done)
        XCTAssertEqual(actions.calls, [.leave("event1")])
    }

    // MARK: Directions

    func testDirectionsOpensMapsOrFallsBackToTheActivity() async {
        let actions = FakeActions()
        let responder = PushQuickActionResponder(makeActions: { _ in actions })
        let found = await responder.directions(payload: event)
        XCTAssertEqual(found, .openExternal(URL(string: "https://maps.apple.com/?q=Park")!))
        actions.directions = nil
        let noVenue = await responder.directions(payload: event)
        XCTAssertEqual(noVenue, .openLink(eventLink))
        actions.directions = URL(string: "https://maps.apple.com/?q=Park")
        actions.failure = EventReadFailure.permissionDenied
        let denied = await responder.directions(payload: event)
        XCTAssertEqual(denied, .openLink(eventLink))
        let signedOut = await PushQuickActionResponder(makeActions: { _ in nil }).directions(payload: event)
        XCTAssertEqual(signedOut, .openLink(eventLink))
    }

    // MARK: Reply

    func testChatReplySendsTrimmedTextWithAStableMessageID() async {
        let actions = FakeActions()
        let responder = PushQuickActionResponder(makeActions: { _ in actions })
        let outcome = await responder.replyChat(text: "  On my way \n", payload: chat, notificationID: "n1")
        XCTAssertEqual(outcome, .done)
        let expectedID = PushQuickActionResponder.replyID(notificationID: "n1", text: "On my way")
        XCTAssertEqual(actions.calls, [.chat(eventID: "event1", messageID: expectedID, text: "On my way")])
        // The same reply to the same notification reuses the id (the write is idempotent on it); another notification does not.
        _ = await responder.replyChat(text: "On my way", payload: chat, notificationID: "n1")
        _ = await responder.replyChat(text: "On my way", payload: chat, notificationID: "n2")
        guard case .chat(_, let again, _) = actions.calls[1], case .chat(_, let other, _) = actions.calls[2] else { return XCTFail("calls") }
        XCTAssertEqual(again, expectedID)
        XCTAssertNotEqual(other, expectedID)
    }

    func testReplyIDsAreValidDocumentIdsThatRevealNothing() {
        let id = PushQuickActionResponder.replyID(notificationID: "0:1764000000%abc", text: "secret plans")
        XCTAssertTrue(ChatFailure.validMessageID(id))
        XCTAssertTrue(MemberEventsRepository.validID(id))
        XCTAssertEqual(id.count, 45)
        XCTAssertFalse(id.contains("secret"))
    }

    func testEmptyTooLongFailedOrSignedOutChatReplies() async {
        let actions = FakeActions()
        let responder = PushQuickActionResponder(makeActions: { _ in actions })
        let empty = await responder.replyChat(text: "   ", payload: chat, notificationID: "n1")
        XCTAssertEqual(empty, .ignored)
        let long = await responder.replyChat(text: String(repeating: "a", count: ChatFailure.maximumLength + 1), payload: chat, notificationID: "n1")
        XCTAssertEqual(long, .fallback(.reply, chatLink))
        XCTAssertTrue(actions.calls.isEmpty)
        actions.failure = ChatFailure.closed
        let closed = await responder.replyChat(text: "hi", payload: chat, notificationID: "n1")
        XCTAssertEqual(closed, .fallback(.reply, chatLink))
        let signedOut = await PushQuickActionResponder(makeActions: { _ in nil }).replyChat(text: "hi", payload: chat, notificationID: "n1")
        XCTAssertEqual(signedOut, .fallback(.reply, chatLink))
    }

    func testPhotoCommentReplyCommentsOnTheSamePhoto() async {
        let actions = FakeActions()
        let responder = PushQuickActionResponder(makeActions: { _ in actions })
        let outcome = await responder.replyPhotoComment(text: "Thanks!", payload: comment, notificationID: "n9")
        XCTAssertEqual(outcome, .done)
        XCTAssertEqual(actions.calls, [.comment(eventID: "event1", photoID: "owner_3",
                                                commentID: PushQuickActionResponder.replyID(notificationID: "n9", text: "Thanks!"), text: "Thanks!")])
        let noPhoto = await responder.replyPhotoComment(text: "Thanks!", payload: event, notificationID: "n9")
        XCTAssertEqual(noPhoto, .fallback(.reply, eventLink))
        actions.failure = AlbumFailure.unavailable
        let offline = await responder.replyPhotoComment(text: "Again", payload: comment, notificationID: "n9")
        XCTAssertEqual(offline, .fallback(.reply, eventLink))
        XCTAssertEqual(actions.calls.count, 2)
    }

    // MARK: Coordinator

    func testCoordinatorRunsEachActionAndOpensNothingOnSuccess() async {
        let actions = FakeActions()
        let (coordinator, system) = coordinator(PushQuickActionResponder(makeActions: { _ in actions }))
        var opened: [URL] = []
        coordinator.onLink = { opened.append($0) }
        await coordinator.handleResponse(.leaveEvent, payload: event)
        await coordinator.handleResponse(.replyChat(text: "hi"), payload: chat, notificationID: "n1")
        await coordinator.handleResponse(.replyPhotoComment(text: "ok"), payload: comment, notificationID: "n2")
        XCTAssertEqual(actions.calls.count, 3)
        XCTAssertTrue(opened.isEmpty)
        XCTAssertTrue(system.fallbacks.isEmpty)
        await coordinator.handleResponse(.directions, payload: event)
        XCTAssertEqual(system.external, [URL(string: "https://maps.apple.com/?q=Park")!])
        XCTAssertTrue(opened.isEmpty)
    }

    func testCoordinatorFallbacksPostInTheBackgroundAndOpenInTheForeground() async {
        let actions = FakeActions()
        actions.failure = RsvpFailure.unavailable
        let (coordinator, system) = coordinator(PushQuickActionResponder(makeActions: { _ in actions }))
        var opened: [String] = []
        coordinator.onLink = { opened.append($0.absoluteString) }
        system.isForeground = false
        await coordinator.handleResponse(.leaveEvent, payload: event)
        await coordinator.handleResponse(.replyChat(text: "hi"), payload: chat, notificationID: "n1")
        XCTAssertEqual(system.fallbackKinds, [.leave, .reply])
        XCTAssertEqual(system.fallbacks, [eventLink, chatLink])
        XCTAssertTrue(opened.isEmpty)
        system.isForeground = true
        await coordinator.handleResponse(.replyPhotoComment(text: "hi"), payload: comment, notificationID: "n1")
        XCTAssertEqual(opened, ["dip://events/event1"])
        XCTAssertEqual(system.fallbacks.count, 2)
        // Directions that cannot resolve opens the activity even in the background (it is a foreground action).
        system.isForeground = false
        await coordinator.handleResponse(.directions, payload: event)
        XCTAssertEqual(opened, ["dip://events/event1", "dip://events/event1"])
        XCTAssertTrue(system.external.isEmpty)
    }

    func testWithoutAResponderEveryActionFallsBackToTheItem() async {
        let (coordinator, system) = coordinator(nil)
        var opened: [String] = []
        coordinator.onLink = { opened.append($0.absoluteString) }
        await coordinator.handleResponse(.leaveEvent, payload: event)
        await coordinator.handleResponse(.replyChat(text: "hi"), payload: chat)
        await coordinator.handleResponse(.directions, payload: event)
        XCTAssertEqual(system.fallbackKinds, [.leave, .reply])
        XCTAssertEqual(opened, ["dip://events/event1"])
    }

    func testEmptyReplyDoesNothing() async {
        let actions = FakeActions()
        let (coordinator, system) = coordinator(PushQuickActionResponder(makeActions: { _ in actions }))
        var opened: [URL] = []
        coordinator.onLink = { opened.append($0) }
        await coordinator.handleResponse(.replyChat(text: "  "), payload: chat, notificationID: "n1")
        XCTAssertTrue(actions.calls.isEmpty)
        XCTAssertTrue(opened.isEmpty)
        XCTAssertTrue(system.fallbacks.isEmpty)
    }
}
