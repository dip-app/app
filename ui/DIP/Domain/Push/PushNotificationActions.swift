import CryptoKit
import DIPCore
import Foundation

// Push actions (DEVICE-UNVERIFIED, see docs/design/push-client.md): what a tapped notification or an action button does.
// Pure rules here; the UserNotifications adapter is SystemPushAdapter.

/// The FCM `data` keys the app reads (all strings, written by the notifications module). Anything missing is nil.
struct PushPayload: Equatable, Sendable {
    let type: String?
    let companyID: String?
    let eventID: String?
    let inviteID: String?
    let deepLink: String?
    /// The album photo a `photo_comment` push is about (its Reply comments on the same photo).
    let photoID: String?

    init(type: String? = nil, companyID: String? = nil, eventID: String? = nil, inviteID: String? = nil, deepLink: String? = nil,
         photoID: String? = nil) {
        self.type = type; self.companyID = companyID; self.eventID = eventID; self.inviteID = inviteID; self.deepLink = deepLink
        self.photoID = photoID
    }

    init(userInfo: [AnyHashable: Any]) {
        func text(_ key: String) -> String? {
            guard let value = userInfo[key] as? String else { return nil }
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        self.init(type: text("type"), companyID: text("companyId"), eventID: text("eventId"),
                  inviteID: text("inviteId"), deepLink: text("deepLink"), photoID: text("photoId"))
    }

    /// Where a tap goes, whatever the `type` (unknown and future types included): the payload's `deepLink` when the app
    /// can open it, otherwise the event page from `eventId`. Nil when neither is usable; the app then just opens.
    var link: URL? {
        if let deepLink, let url = URL(string: deepLink), DIPShareLink.destination(from: url) != nil { return url }
        // Valid ids are plain `[A-Za-z0-9_-]`, so they need no escaping; the parser re-checks the result.
        guard let eventID, MemberEventsRepository.validID(eventID),
              let url = URL(string: "\(DIPShareLink.appScheme)://events/\(eventID)"), DIPShareLink.destination(from: url) != nil else { return nil }
        return url
    }
}

/// `aps.category` values shared with the server (`APNS_CATEGORIES` in the notifications module, docs/design/push-catalog.md
/// "Quick actions"). A push whose category this build does not register shows no buttons; its tap still opens the link.
enum PushCategory {
    /// invite: Accept, Decline.
    static let invite = "DIP_INVITE"
    /// attendee_added, event_changed (not cancelled): Can't make it, Open.
    static let eventGoing = "DIP_EVENT_GOING"
    /// reminder: Directions, Can't make it.
    static let reminder = "DIP_REMINDER"
    /// chat: Reply (text).
    static let chat = "DIP_CHAT"
    /// photo_comment: Reply (text) on the same photo.
    static let photoComment = "DIP_PHOTO_COMMENT"
    /// Look-only pushes (cancelled, removed, invite accepted, new photo, challenges): Open.
    static let open = "DIP_OPEN"

    static let all = [invite, eventGoing, reminder, chat, photoComment, open]
}

/// What the member chose on a delivered notification.
enum PushResponseAction: Equatable, Sendable {
    /// The notification itself was tapped, its Open button pressed, or any action the app does not know: open its link.
    case open
    case answerInvite(accept: Bool)
    /// "Can't make it": leave the activity (setRsvpV1 cancelled, like the event page's Leave).
    case leaveEvent
    /// "Directions": open Maps for the activity's venue.
    case directions
    /// "Reply" on a chat push: post the text to the activity chat.
    case replyChat(text: String)
    /// "Reply" on a photo comment push: comment on the same photo.
    case replyPhotoComment(text: String)

    static let acceptInvite = "DIP_INVITE_ACCEPT"
    static let declineInvite = "DIP_INVITE_DECLINE"
    static let openItem = "DIP_OPEN"
    static let leaveEventAction = "DIP_EVENT_LEAVE"
    static let directionsAction = "DIP_DIRECTIONS"
    static let replyChatAction = "DIP_CHAT_REPLY"
    static let replyPhotoCommentAction = "DIP_PHOTO_COMMENT_REPLY"

    /// `text` is the typed reply of a text input action (nil for buttons). A reply action without text opens the item.
    init(identifier: String, text: String? = nil) {
        switch identifier {
        case Self.acceptInvite: self = .answerInvite(accept: true)
        case Self.declineInvite: self = .answerInvite(accept: false)
        case Self.leaveEventAction: self = .leaveEvent
        case Self.directionsAction: self = .directions
        case Self.replyChatAction: self = text.map { .replyChat(text: $0) } ?? .open
        case Self.replyPhotoCommentAction: self = text.map { .replyPhotoComment(text: $0) } ?? .open
        default: self = .open
        }
    }
}

/// Answers an invitation from the Accept and Decline buttons on an invite push, through the same repository call as the
/// in-app buttons (`DIPInvitesRepository.respond`, i.e. respondToInviteV1). The server derives the member from the
/// auth and checks the company and recipient; the payload's ids only say which invitation.
@MainActor final class PushInviteResponder {
    /// The invites repository for the signed-in member in `companyID`, or nil when nobody is signed in or the app is not
    /// configured. Built per action: a background launch may have no member session on screen yet.
    typealias RepositoryFactory = @MainActor (_ companyID: String) -> (any DIPInvitesRepository)?

    enum Outcome: Equatable, Sendable {
        case answered
        /// A second press while the first is still running.
        case ignored
        /// Could not answer: open the activity so the member can answer in the app.
        case openInvite(URL?)
    }

    private let makeRepository: RepositoryFactory
    private var inFlight: Set<String> = []

    init(makeRepository: @escaping RepositoryFactory) { self.makeRepository = makeRepository }

    func answer(accept: Bool, payload: PushPayload) async -> Outcome {
        guard let companyID = payload.companyID, let inviteID = payload.inviteID,
              MemberEventsRepository.validID(companyID), MemberEventsRepository.validID(inviteID),
              let repository = makeRepository(companyID) else { return .openInvite(payload.link) }
        guard inFlight.insert(inviteID).inserted else { return .ignored }
        defer { inFlight.remove(inviteID) }
        do {
            _ = try await repository.respond(inviteID: inviteID, accept: accept)
            return .answered
        } catch DIPInviteFailure.alreadyAnswered {
            // Idempotent: a repeated press (or iOS redelivering the action) after the first answer went through.
            return .answered
        } catch {
            return .openInvite(payload.link)
        }
    }
}

/// Which local notification to post when a quick action pressed in the background could not finish.
enum PushActionFallback: Equatable, Sendable {
    case invite, leave, reply
}

/// The member-side calls behind the quick actions, for the signed-in member in one company. The Firebase adapter
/// (`FirebasePushMemberActions`) reuses the sources the in-app UI calls, so the server applies the same rules.
@MainActor protocol PushMemberActions: AnyObject {
    /// The event page's Leave: setRsvpV1 with status cancelled. Leaving twice is a no-op on the server.
    func leave(eventID: String) async throws
    /// The chat composer's send: an own-author message whose id is the document id (a retry rewrites the same message).
    func sendChat(eventID: String, messageID: String, text: String) async throws
    /// The photo viewer's comment composer: an own-author comment whose id is the document id.
    func commentOnPhoto(eventID: String, photoID: String, commentID: String, text: String) async throws
    /// The event page's Directions link; nil when the activity has no location.
    func directionsURL(eventID: String) async throws -> URL?
}

/// Runs "Can't make it", "Directions" and "Reply" from a push (docs/design/push-client.md, "Quick actions"). The payload's
/// ids only say which item; the server derives the member from the auth and checks company, attendance and windows.
/// Never logs ids, names or message text.
@MainActor final class PushQuickActionResponder {
    /// The member actions for the signed-in member in `companyID`, or nil when nobody is signed in or the app is not
    /// configured. Built per action: a background launch may have no member session on screen yet.
    typealias Factory = @MainActor (_ companyID: String) -> (any PushMemberActions)?

    enum Outcome: Equatable, Sendable {
        case done
        /// A second press of the same action while the first is still running, or an empty reply.
        case ignored
        /// Directions found: open this Maps link.
        case openExternal(URL)
        /// Open the item in the app (a foreground action that could not finish).
        case openLink(URL?)
        /// Could not finish: tell the member (local notification in the background, the item in the foreground).
        case fallback(PushActionFallback, URL?)
    }

    /// The rules and the photo viewer allow comments of up to 2,000 characters (chat: `ChatFailure.maximumLength`).
    static let commentMaximumLength = 2_000

    private let makeActions: Factory
    private var inFlight: Set<String> = []

    init(makeActions: @escaping Factory) { self.makeActions = makeActions }

    func leave(payload: PushPayload) async -> Outcome {
        guard let target = resolve(payload) else { return .fallback(.leave, payload.link) }
        return await once("leave|\(target.eventID)") {
            do { try await target.actions.leave(eventID: target.eventID); return .done } catch { return .fallback(.leave, payload.link) }
        }
    }

    func directions(payload: PushPayload) async -> Outcome {
        guard let target = resolve(payload) else { return .openLink(payload.link) }
        return await once("directions|\(target.eventID)") {
            guard let url = try? await target.actions.directionsURL(eventID: target.eventID) else { return .openLink(payload.link) }
            return .openExternal(url)
        }
    }

    /// `notificationID` is the delivered notification's request identifier: with the text it makes the message id, so iOS
    /// delivering the same reply twice (or a double press) writes one message.
    func replyChat(text: String, payload: PushPayload, notificationID: String) async -> Outcome {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .ignored }
        guard trimmed.count <= ChatFailure.maximumLength, let target = resolve(payload) else { return .fallback(.reply, payload.link) }
        let messageID = Self.replyID(notificationID: notificationID, text: trimmed)
        return await once("chat|\(messageID)") {
            do { try await target.actions.sendChat(eventID: target.eventID, messageID: messageID, text: trimmed); return .done }
            catch { return .fallback(.reply, payload.link) }
        }
    }

    func replyPhotoComment(text: String, payload: PushPayload, notificationID: String) async -> Outcome {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .ignored }
        guard trimmed.count <= Self.commentMaximumLength, let photoID = payload.photoID, MemberEventsRepository.validID(photoID),
              let target = resolve(payload) else { return .fallback(.reply, payload.link) }
        let commentID = Self.replyID(notificationID: notificationID, text: trimmed)
        return await once("comment|\(commentID)") {
            do {
                try await target.actions.commentOnPhoto(eventID: target.eventID, photoID: photoID, commentID: commentID, text: trimmed)
                return .done
            } catch { return .fallback(.reply, payload.link) }
        }
    }

    /// `push-` and 40 hex characters of SHA-256(notification id, text): a valid message or comment id (8 to 128 of
    /// `[A-Za-z0-9_-]`) that is the same for the same reply to the same notification and reveals neither.
    nonisolated static func replyID(notificationID: String, text: String) -> String {
        let digest = SHA256.hash(data: Data("\(notificationID)\u{1F}\(text)".utf8))
        return "push-" + digest.map { String(format: "%02x", $0) }.joined().prefix(40)
    }

    private struct Target {
        let actions: any PushMemberActions
        let eventID: String
    }

    private func resolve(_ payload: PushPayload) -> Target? {
        guard let companyID = payload.companyID, let eventID = payload.eventID,
              MemberEventsRepository.validID(companyID), MemberEventsRepository.validID(eventID),
              let actions = makeActions(companyID) else { return nil }
        return Target(actions: actions, eventID: eventID)
    }

    private func once(_ key: String, _ body: () async -> Outcome) async -> Outcome {
        guard inFlight.insert(key).inserted else { return .ignored }
        defer { inFlight.remove(key) }
        return await body()
    }
}
