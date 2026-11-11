import DIPCore
import Foundation

/// One chat message as read from `companies/{c}/events/{e}/messages/{clientMessageId}`.
struct ChatMessageRecord: Equatable, Sendable {
    let id: String
    let authorID: String
    let authorName: String
    let text: String
    let createdAt: Date
}

/// Author fields the rules require to equal the caller's server-owned profile.
struct ChatAuthor: Equatable, Sendable {
    let name: String
    let avatarID: String
}

/// User-facing chat failures, mapped from Firestore errors against the deployed rules.
enum ChatFailure: Error, Equatable {
    case invalidText, notGoing, closed, unauthenticated, unavailable, unknown

    var message: String {
        switch self {
        case .invalidText: "Messages must be 1 to 1000 characters."
        case .notGoing: "Join this activity to chat."
        case .closed: "This chat is closed. It stays open until 24 hours after the activity ends."
        case .unauthenticated: "Please sign in again."
        case .unavailable: "You’re offline. Your message wasn’t sent; try again."
        case .unknown: "Couldn’t send your message. Please try again."
        }
    }

    static let maximumLength = 1_000

    /// The rules require trimmed text of 1...1000 characters.
    static func validated(_ text: String) throws -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= maximumLength else { throw ChatFailure.invalidText }
        return trimmed
    }

    /// The message ID doubles as the document ID: 8-128 of A-Z a-z 0-9 _ -.
    static func validMessageID(_ id: String) -> Bool {
        (8...128).contains(id.count) && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
    }
}

/// Live chat and per-event notification preference for one membership. `stop()` removes every listener.
@MainActor protocol ChatSource: AnyObject {
    /// Newest 100 messages, oldest first, updated live (local pending writes included).
    func observeMessages(scope: EventReadScope, eventID: String) -> AsyncThrowingStream<[ChatMessageRecord], Error>
    /// Idempotent on `messageID`: a retry rewrites the same document.
    func sendMessage(scope: EventReadScope, eventID: String, messageID: String, text: String, author: ChatAuthor) async throws
    func notificationLevel(scope: EventReadScope, eventID: String) async throws -> DIPNotificationLevel?
    func setNotificationLevel(scope: EventReadScope, eventID: String, level: DIPNotificationLevel) async throws
    func stopChat()
}
