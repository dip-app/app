import DIPCore
import Foundation

/// In-memory notifications for previews, Debug fixtures and tests; never a Firebase adapter. It follows the rules:
/// the member can only flip `isRead`, lists are newest first, and a listener failure ends the stream with an error.
public actor DIPMockNotificationsRepository: DIPNotificationsRepository {
    public struct Behavior: Equatable, Sendable {
        public var observeFailure = false
        public var markFailure: DIPNotificationFailure?
        public var loadOlderFailure: DIPNotificationFailure?
        public var latency: Duration = .zero
        public init(observeFailure: Bool = false, markFailure: DIPNotificationFailure? = nil,
                    loadOlderFailure: DIPNotificationFailure? = nil, latency: Duration = .zero) {
            self.observeFailure = observeFailure; self.markFailure = markFailure
            self.loadOlderFailure = loadOlderFailure; self.latency = latency
        }
    }

    private var all: [DIPNotification]
    private var behavior: Behavior
    private var observers: [UUID: (limit: Int, continuation: AsyncThrowingStream<[DIPNotification], Error>.Continuation)] = [:]
    private var unreadObservers: [UUID: AsyncThrowingStream<[String], Error>.Continuation] = [:]
    public private(set) var markedRead: [String] = []

    public init(notifications: [DIPNotification] = [], behavior: Behavior = Behavior()) {
        self.all = notifications.sorted { $0.createdAt > $1.createdAt }; self.behavior = behavior
    }

    public static func empty() -> DIPMockNotificationsRepository { DIPMockNotificationsRepository() }

    /// Design-review fixture: every type across Today, Yesterday and Earlier, four unread.
    public static func reference(now: Date = Date(), count: Int? = nil, behavior: Behavior = Behavior()) -> DIPMockNotificationsRepository {
        let minute: TimeInterval = 60, hour = 3_600 * 1.0, day = 86_400 * 1.0
        var items: [DIPNotification] = [
            .init(id: "invite_e1_me", kind: .invite, title: "New invitation", body: "Priya Shah invited you to Puppy Yoga.",
                  destination: .invitations, createdAt: now.addingTimeInterval(-4 * minute), isRead: false),
            .init(id: "event_e2_5", kind: .eventUpdated, title: "Kayaking on the Lake", body: "Updated: time, location.",
                  destination: .event("kayaking"), createdAt: now.addingTimeInterval(-50 * minute), isRead: false),
            .init(id: "challenge_approved_week1", kind: .challengeApproved, title: "Challenge approved", body: "You earned 50 points.",
                  destination: .challenge("week1"), createdAt: now.addingTimeInterval(-3 * hour), isRead: false),
            .init(id: "reminder_e3", kind: .reminder, title: "Sunset Run", body: "Starts in about an hour.",
                  destination: .event("sunset-run"), createdAt: now.addingTimeInterval(-5 * hour), isRead: true),
            .init(id: "event_e4_3", kind: .eventCancelled, title: "Board Game Night", body: "This activity was cancelled.",
                  destination: .event("board-games"), createdAt: now.addingTimeInterval(-day - hour), isRead: false),
            .init(id: "challenge_changes_week0_1", kind: .challengeChanges, title: "Changes needed",
                  body: "Please add a photo that shows the full route.", destination: .challenge("week0"),
                  createdAt: now.addingTimeInterval(-day - 3 * hour), isRead: true),
            .init(id: "admin_r1", kind: .attendeeAdded, title: "You’re going!", body: "An organizer added you to Trivia Lunch.",
                  destination: .event("trivia"), createdAt: now.addingTimeInterval(-4 * day), isRead: true),
            .init(id: "photo_p1", kind: .photo, title: "New photos", body: "Sam added photos to Kayaking on the Lake.",
                  destination: .album("kayaking-memory"), createdAt: now.addingTimeInterval(-6 * day), isRead: true),
        ]
        if let count, count > items.count {
            for index in items.count..<count {
                items.append(.init(id: "older_\(index)", kind: .eventUpdated, title: "Activity \(index)", body: "Updated: time.",
                                   destination: .event("e\(index)"), createdAt: now.addingTimeInterval(-Double(index) * day / 2), isRead: true))
            }
        }
        return DIPMockNotificationsRepository(notifications: items, behavior: behavior)
    }

    public func observe(limit: Int) async -> AsyncThrowingStream<[DIPNotification], Error> {
        let behavior = behavior
        return AsyncThrowingStream { continuation in
            Task {
                if behavior.latency > .zero { try? await Task.sleep(for: behavior.latency) }
                if behavior.observeFailure { continuation.finish(throwing: DIPNotificationFailure.offline); return }
                self.attach(limit: limit, continuation)
            }
        }
    }

    public func observeUnread() async -> AsyncThrowingStream<[String], Error> {
        let behavior = behavior
        return AsyncThrowingStream { continuation in
            Task {
                if behavior.latency > .zero { try? await Task.sleep(for: behavior.latency) }
                if behavior.observeFailure { continuation.finish(throwing: DIPNotificationFailure.offline); return }
                self.attachUnread(continuation)
            }
        }
    }

    private func attach(limit: Int, _ continuation: AsyncThrowingStream<[DIPNotification], Error>.Continuation) {
        let id = UUID()
        observers[id] = (limit, continuation)
        continuation.onTermination = { _ in Task { await self.detach(id) } }
        continuation.yield(Array(all.prefix(limit)))
    }

    private func attachUnread(_ continuation: AsyncThrowingStream<[String], Error>.Continuation) {
        let id = UUID()
        unreadObservers[id] = continuation
        continuation.onTermination = { _ in Task { await self.detachUnread(id) } }
        continuation.yield(unreadIDs)
    }

    private func detach(_ id: UUID) { observers[id] = nil }
    private func detachUnread(_ id: UUID) { unreadObservers[id] = nil }
    private var unreadIDs: [String] { Array(all.filter { !$0.isRead }.map(\.id).prefix(50)) }

    public func loadOlder(before date: Date, limit: Int) async throws -> [DIPNotification] {
        if behavior.latency > .zero { try? await Task.sleep(for: behavior.latency) }
        if let failure = behavior.loadOlderFailure { throw failure }
        return Array(all.filter { $0.createdAt < date }.prefix(limit))
    }

    public func markRead(ids: [String]) async throws {
        if let failure = behavior.markFailure { throw failure }
        let set = Set(ids)
        for index in all.indices where set.contains(all[index].id) { all[index].isRead = true }
        markedRead.append(contentsOf: ids)
        for (_, observer) in observers { observer.continuation.yield(Array(all.prefix(observer.limit))) }
        for (_, continuation) in unreadObservers { continuation.yield(unreadIDs) }
    }

    /// Test hook: a new server-created notification arrives.
    public func deliver(_ notification: DIPNotification) {
        all.insert(notification, at: 0); all.sort { $0.createdAt > $1.createdAt }
        for (_, observer) in observers { observer.continuation.yield(Array(all.prefix(observer.limit))) }
        for (_, continuation) in unreadObservers { continuation.yield(unreadIDs) }
    }
}
