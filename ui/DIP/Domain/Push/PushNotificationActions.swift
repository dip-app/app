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

    init(type: String? = nil, companyID: String? = nil, eventID: String? = nil, inviteID: String? = nil, deepLink: String? = nil) {
        self.type = type; self.companyID = companyID; self.eventID = eventID; self.inviteID = inviteID; self.deepLink = deepLink
    }

    init(userInfo: [AnyHashable: Any]) {
        func text(_ key: String) -> String? {
            guard let value = userInfo[key] as? String else { return nil }
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        self.init(type: text("type"), companyID: text("companyId"), eventID: text("eventId"),
                  inviteID: text("inviteId"), deepLink: text("deepLink"))
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

/// `aps.category` and action identifiers shared with the server (`INVITE_APNS_CATEGORY` in the notifications module).
enum PushCategory {
    static let invite = "DIP_INVITE"
}

/// What the member chose on a delivered notification.
enum PushResponseAction: Equatable, Sendable {
    /// The notification itself was tapped (or any action the app does not know): open its link.
    case open
    case answerInvite(accept: Bool)

    static let acceptInvite = "DIP_INVITE_ACCEPT"
    static let declineInvite = "DIP_INVITE_DECLINE"

    init(identifier: String) {
        switch identifier {
        case Self.acceptInvite: self = .answerInvite(accept: true)
        case Self.declineInvite: self = .answerInvite(accept: false)
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
