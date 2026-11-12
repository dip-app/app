import Foundation

/// What a notification is about. Unknown server types fall back to `.other` (generic icon, still readable).
public enum DIPNotificationKind: String, Equatable, Sendable, CaseIterable {
    case invite
    case eventUpdated = "event_updated"
    case eventCancelled = "event_cancelled"
    case reminder
    case challengeApproved = "challenge_approved"
    case challengeChanges = "challenge_changes_requested"
    case attendeeAdded = "attendee_added"
    case comment
    case photo
    case other

    public init(serverType: String) {
        switch serverType {
        case "event_changed": self = .eventUpdated
        case "photo_added": self = .photo
        case "comment_added", "new_comment": self = .comment
        default: self = Self(rawValue: serverType) ?? .other
        }
    }
}

/// Where a tap goes. Derived from the server's `targetType` / `targetId`; anything unrecognised is `.none`
/// (the row is marked read and nothing opens).
public enum DIPNotificationDestination: Equatable, Sendable {
    case event(String)
    case invitations
    case challenge(String)
    case album(String)
    case none

    public init(targetType: String, targetID: String) {
        let id = targetID.trimmingCharacters(in: .whitespacesAndNewlines)
        switch targetType {
        case "invite": self = .invitations
        case "event" where !id.isEmpty: self = .event(id)
        case "challenge" where !id.isEmpty: self = .challenge(id)
        case "album" where !id.isEmpty, "photo" where !id.isEmpty: self = .album(id)
        default: self = .none
        }
    }
}

/// One `users/{uid}/notifications/{id}` document. The server creates it; the member may only flip `isRead`.
public struct DIPNotification: Identifiable, Equatable, Sendable {
    public let id: String
    public let kind: DIPNotificationKind
    public let title: String
    public let body: String
    public let destination: DIPNotificationDestination
    public let createdAt: Date
    public var isRead: Bool

    public init(id: String, kind: DIPNotificationKind, title: String, body: String,
                destination: DIPNotificationDestination, createdAt: Date, isRead: Bool) {
        self.id = id; self.kind = kind; self.title = title; self.body = body
        self.destination = destination; self.createdAt = createdAt; self.isRead = isRead
    }
}

public enum DIPNotificationFailure: Error, Equatable, Sendable {
    case offline, unauthenticated, denied, unknown
    public var message: String {
        switch self {
        case .offline: "You’re offline. Check your connection and try again."
        case .unauthenticated: "Please sign in again to see your notifications."
        case .denied: "Notifications aren’t available for this account."
        case .unknown: "Couldn’t load your notifications. Please try again."
        }
    }
}

/// The member's own notifications. Reads are scoped to the signed-in member by the adapter (never by a supplied uid).
public protocol DIPNotificationsRepository: Sendable {
    /// The newest `limit` notifications, live (newest first). Finishing with an error means the listener failed.
    func observe(limit: Int) async -> AsyncThrowingStream<[DIPNotification], Error>
    /// Ids of unread notifications, live, capped by the adapter (the bell shows "9+" long before the cap).
    func observeUnread() async -> AsyncThrowingStream<[String], Error>
    /// One older page: strictly older than `date`, newest first.
    func loadOlder(before date: Date, limit: Int) async throws -> [DIPNotification]
    /// Marks these read (the only field a member may change). Batches are the adapter's concern.
    func markRead(ids: [String]) async throws
}

/// Pure presentation rules for the notifications center: day groups, relative time, the bell badge text.
public enum DIPNotificationRules {
    public static let pageSize = 30
    /// Firestore allows 500 writes per batch; stay well below it.
    public static let writeBatchSize = 400

    public enum Group: String, Equatable, Sendable, CaseIterable {
        case today = "Today", yesterday = "Yesterday", earlier = "Earlier"
    }

    public struct Section: Equatable, Sendable {
        public let group: Group
        public let items: [DIPNotification]
    }

    public static func group(for date: Date, now: Date, calendar: Calendar = .current) -> Group {
        if calendar.isDate(date, inSameDayAs: now) { return .today }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) { return .yesterday }
        // A timestamp slightly in the future (clock skew) still belongs to today.
        return date > now ? .today : .earlier
    }

    /// Newest first inside each group; empty groups are omitted.
    public static func sections(_ items: [DIPNotification], now: Date, calendar: Calendar = .current) -> [Section] {
        let sorted = items.sorted { $0.createdAt > $1.createdAt }
        return Group.allCases.compactMap { group in
            let matching = sorted.filter { self.group(for: $0.createdAt, now: now, calendar: calendar) == group }
            return matching.isEmpty ? nil : Section(group: group, items: matching)
        }
    }

    /// "Just now", "5m ago", "3h ago" today; the clock time yesterday; "Nov 3" before that (the group header already names the day).
    public static func relativeTime(_ date: Date, now: Date, calendar: Calendar = .current) -> String {
        let seconds = now.timeIntervalSince(date)
        if seconds < 60 { return "Just now" }
        if seconds < 3_600 { return "\(Int(seconds / 60))m ago" }
        let day = group(for: date, now: now, calendar: calendar)
        if day == .today { return "\(Int(seconds / 3_600))h ago" }
        if day == .yesterday {
            return date.formatted(.dateTime.hour().minute().locale(Locale(identifier: "en_US")))
        }
        return date.formatted(.dateTime.month(.abbreviated).day().locale(Locale(identifier: "en_US")))
    }

    /// Splits ids into write batches.
    public static func batches(_ ids: [String]) -> [[String]] {
        stride(from: 0, to: ids.count, by: writeBatchSize).map { Array(ids[$0..<min($0 + writeBatchSize, ids.count)]) }
    }
}
