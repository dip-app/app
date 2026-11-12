import DIPCore
import Foundation
import Observation

private func failure(_ error: Error) -> DIPNotificationFailure {
    (error as? DIPNotificationFailure) ?? .unknown
}

/// The signed-in member's notifications: a live first page, older pages on demand, a live unread count for the bell.
/// Marking read is optimistic and reverted if the write fails; the live listener is the source of truth afterwards.
@MainActor @Observable
public final class DIPNotificationsModel {
    public enum Phase: Equatable, Sendable { case loading, ready, failed(String) }

    public private(set) var phase: Phase = .loading
    /// A listener failed after data arrived: what is shown is the last good state (offline).
    public private(set) var isStale = false
    public private(set) var loadingMore = false
    public private(set) var loadMoreError: String?
    public private(set) var markAllError: String?
    public private(set) var isMarkingAll = false
    /// Ids the member opened or cleared in this session, shown as read before the server confirms.
    public private(set) var locallyRead: Set<String> = []

    @ObservationIgnored private let repository: any DIPNotificationsRepository
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var generation = UUID()
    private var head: [DIPNotification] = []
    private var older: [DIPNotification] = []
    private var unreadIDs: [String] = []
    private var unreadKnown = false
    /// False once a page came back short: there is nothing older to load.
    private var hasMorePages = true

    public init(repository: any DIPNotificationsRepository, now: @escaping () -> Date = { Date() }) {
        self.repository = repository; self.now = now
    }

    // MARK: Observation

    /// Runs both listeners until the host's task is cancelled (sign-out, member change), which removes them.
    public func observe() async {
        let current = UUID()
        generation = current
        if head.isEmpty { phase = .loading }
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.observeList(current) }
            group.addTask { await self.observeUnread(current) }
        }
    }

    private func observeList(_ current: UUID) async {
        do {
            let stream = await repository.observe(limit: DIPNotificationRules.pageSize)
            for try await value in stream {
                guard !Task.isCancelled, generation == current else { return }
                head = value; phase = .ready; isStale = false
                // The live page is the newest window: older pages stay, minus anything the window now covers.
                let covered = Set(value.map(\.id))
                older.removeAll { covered.contains($0.id) }
                if older.isEmpty { hasMorePages = value.count >= DIPNotificationRules.pageSize }
                locallyRead.subtract(value.filter(\.isRead).map(\.id))
            }
            guard !Task.isCancelled, generation == current else { return }
            markUnavailable("Updates stopped. Check your connection.")
        } catch {
            guard !Task.isCancelled, generation == current else { return }
            markUnavailable(failure(error).message)
        }
    }

    private func observeUnread(_ current: UUID) async {
        do {
            let stream = await repository.observeUnread()
            for try await ids in stream {
                guard !Task.isCancelled, generation == current else { return }
                unreadIDs = ids; unreadKnown = true
            }
        } catch {
            guard !Task.isCancelled, generation == current else { return }
            // The badge keeps its last value; the list reports the failure.
        }
    }

    private func markUnavailable(_ message: String) {
        if phase == .ready || !head.isEmpty { isStale = true } else { phase = .failed(message) }
    }

    // MARK: Reading

    /// Live window plus loaded older pages, newest first, with this session's reads applied.
    public var items: [DIPNotification] {
        var seen = Set<String>()
        return (head + older).filter { seen.insert($0.id).inserted }.map { item in
            var item = item
            if locallyRead.contains(item.id) { item.isRead = true }
            return item
        }
    }

    public func sections() -> [DIPNotificationRules.Section] { DIPNotificationRules.sections(items, now: now()) }

    /// Live unread count (0 until the first answer); drives the bell badge.
    public var unreadCount: Int {
        unreadKnown ? unreadIDs.filter { !locallyRead.contains($0) }.count : 0
    }

    /// Unread ids known to the list or the unread listener (the unread listener may know of rows older than the loaded pages).
    private var allUnreadIDs: [String] {
        var ids = unreadIDs.filter { !locallyRead.contains($0) }
        for item in items where !item.isRead && !ids.contains(item.id) { ids.append(item.id) }
        return ids
    }

    public var hasUnread: Bool { !allUnreadIDs.isEmpty }
    public var canLoadMore: Bool { phase == .ready && hasMorePages && !items.isEmpty }
    public var isEmpty: Bool { phase == .ready && items.isEmpty }

    // MARK: Commands

    /// Opening a row marks it read. Failure is silent for the member (the row simply stays unread after the live update).
    public func markRead(_ id: String) async {
        guard allUnreadIDs.contains(id) else { return }
        locallyRead.insert(id)
        do { try await repository.markRead(ids: [id]) } catch { locallyRead.remove(id) }
    }

    /// Marks every unread notification read. The unread listener is capped, so the call repeats until it has nothing left
    /// (bounded rounds). Returns true when nothing is left unread.
    @discardableResult
    public func markAllRead() async -> Bool {
        guard !isMarkingAll else { return false }
        isMarkingAll = true; markAllError = nil
        defer { isMarkingAll = false }
        var rounds = 0
        while rounds < 5 {
            rounds += 1
            let pending = allUnreadIDs
            guard !pending.isEmpty else { break }
            locallyRead.formUnion(pending)
            do { try await repository.markRead(ids: pending) } catch {
                locallyRead.subtract(pending)
                markAllError = failure(error) == .offline ? "You’re offline. Try again when you’re back online." : "Couldn’t mark everything as read. Try again."
                return false
            }
            // Let the live listeners deliver the remainder (if any) before another round.
            try? await Task.sleep(for: .milliseconds(400))
            if unreadIDs.filter({ !locallyRead.contains($0) }).isEmpty { break }
        }
        return true
    }

    public func clearMarkAllError() { markAllError = nil }

    /// Loads the next older page. Safe to call repeatedly from a scroll trigger.
    public func loadMore() async {
        guard canLoadMore, !loadingMore, let last = items.last else { return }
        loadingMore = true; loadMoreError = nil
        defer { loadingMore = false }
        do {
            let page = try await repository.loadOlder(before: last.createdAt, limit: DIPNotificationRules.pageSize)
            older.append(contentsOf: page)
            hasMorePages = page.count >= DIPNotificationRules.pageSize
        } catch {
            loadMoreError = failure(error) == .offline ? "You’re offline. Try again when you’re back online." : "Couldn’t load more. Try again."
        }
    }
}
