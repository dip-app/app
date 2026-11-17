import DIPCore
import EventKit
import Foundation

/// The one `EKEventStore` DIP uses, so the system editor, the conflict reads and the direct saves all see the same
/// calendar database and one `EKEventStoreChanged` stream. Creating a store is expensive; EventKit asks apps to keep one.
@MainActor enum DIPEventKitStore {
    static let shared = EKEventStore()
}

/// `EKEventStore` is thread safe for fetching, but not annotated Sendable; reads run off the main actor through this box.
private struct StoreBox: @unchecked Sendable {
    let store: EKEventStore
}

/// The device calendar over one shared `EKEventStore` (docs/design/stretch/calendar.md, conflict engine).
///
/// Reads need full access and cover one cached window at a time; the cache is dropped when the store changes. Fetches
/// run off the main actor (a busy calendar can hold thousands of occurrences), and store-change notifications are
/// debounced because syncing fires them in bursts. Writes are limited to entries DIP created, recognized by the DIP
/// share link in the entry URL. Calendar titles are never logged or persisted here.
@MainActor final class DIPEventKitDeviceCalendar: DIPDeviceCalendar {
    private let store: EKEventStore
    /// Set by the model wiring; called (debounced) after the cache is cleared when the calendar database changes.
    var onChange: (@MainActor () -> Void)?
    private var cache: (start: Date, end: Date, items: [DIPCalendarItem])?
    /// Bumped whenever cached data may be stale, so a fetch that was in flight cannot store an old window.
    private var generation = 0
    private var debounce: Task<Void, Never>?
    nonisolated(unsafe) private var observer: NSObjectProtocol?
    /// The shortest window a read caches, so scrolling Home does not re-query per event.
    private static let minimumWindowDays = 45
    private static let changeDebounce: Duration = .milliseconds(500)

    init(store: EKEventStore = DIPEventKitStore.shared) {
        self.store = store
        observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.storeChanged() }
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    private func storeChanged() {
        invalidateCache()
        debounce?.cancel()
        debounce = Task { [weak self] in
            try? await Task.sleep(for: Self.changeDebounce)
            guard !Task.isCancelled else { return }
            self?.onChange?()
        }
    }

    private func invalidateCache() {
        generation += 1
        cache = nil
    }

    // MARK: Access

    var access: DIPCalendarAccess {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .notDetermined: .notDetermined
        case .restricted: .restricted
        case .denied: .denied
        case .writeOnly: .writeOnly
        case .fullAccess, .authorized: .fullAccess
        @unknown default: .denied
        }
    }

    func requestFullAccess() async -> DIPCalendarAccess {
        _ = try? await store.requestFullAccessToEvents()
        invalidateCache()
        return access
    }

    // MARK: Reads

    func items(start: Date, end: Date) async -> [DIPCalendarItem] {
        guard access == .fullAccess, end > start else { return [] }
        let all: [DIPCalendarItem]
        if let cache, cache.start <= start, cache.end >= end {
            all = cache.items
        } else {
            let calendar = Calendar.current
            let windowStart = calendar.startOfDay(for: start)
            let minimumEnd = calendar.date(byAdding: .day, value: Self.minimumWindowDays, to: windowStart) ?? end
            let dayAfterEnd = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: end)) ?? end
            let windowEnd = max(minimumEnd, dayAfterEnd)
            let started = generation
            let fetched = await Self.fetch(StoreBox(store: store), start: windowStart, end: windowEnd)
            // A change (or a write) while the fetch ran makes the window stale: use it once, but do not keep it.
            if started == generation { cache = (windowStart, windowEnd, fetched) }
            all = fetched
        }
        return all.filter { $0.start < end && $0.end > start }
    }

    func identifier(forURL url: URL, start: Date, end: Date) async -> String? {
        guard access == .fullAccess else { return nil }
        return await Self.find(StoreBox(store: store), url: url, start: start, end: end)
    }

    func entryExists(identifier: String) async -> Bool {
        access == .fullAccess && store.event(withIdentifier: identifier) != nil
    }

    private static func fetch(_ box: StoreBox, start: Date, end: Date) async -> [DIPCalendarItem] {
        await Task.detached(priority: .userInitiated) {
            let predicate = box.store.predicateForEvents(withStart: start, end: end, calendars: nil)
            return box.store.events(matching: predicate).map(item)
        }.value
    }

    private static func find(_ box: StoreBox, url: URL, start: Date, end: Date) async -> String? {
        await Task.detached(priority: .userInitiated) {
            let day: TimeInterval = 86_400
            let predicate = box.store.predicateForEvents(withStart: start.addingTimeInterval(-day), end: end.addingTimeInterval(day), calendars: nil)
            return box.store.events(matching: predicate).first { $0.url == url }?.eventIdentifier
        }.value
    }

    nonisolated private static func item(_ event: EKEvent) -> DIPCalendarItem {
        let availability: DIPCalendarItem.Availability = switch event.availability {
        case .free: .free
        case .tentative: .tentative
        default: .busy
        }
        let declined = event.attendees?.contains { $0.isCurrentUser && $0.participantStatus == .declined } ?? false
        return DIPCalendarItem(
            title: event.title ?? "", start: event.startDate, end: event.endDate, isAllDay: event.isAllDay,
            availability: availability, isDeclined: declined, isCanceled: event.status == .canceled, url: event.url,
            identifier: event.eventIdentifier)
    }

    // MARK: Writes (entries DIP created)

    func save(_ fields: DIPCalendarEventFields) async throws -> String {
        let current = access
        guard current == .fullAccess || current == .writeOnly else { throw DIPCalendarWriteError.noAccess }
        guard let calendar = store.defaultCalendarForNewEvents, calendar.allowsContentModifications else {
            throw DIPCalendarWriteError.noDefaultCalendar
        }
        let event = EKEvent(eventStore: store)
        event.calendar = calendar
        event.title = fields.title
        apply(fields, to: event)
        event.url = fields.url
        do {
            try store.save(event, span: .thisEvent)
        } catch {
            throw DIPCalendarWriteError.failed("save")
        }
        invalidateCache()
        guard let identifier = event.eventIdentifier else { throw DIPCalendarWriteError.failed("identifier") }
        return identifier
    }

    func update(identifier: String, with fields: DIPCalendarEventFields) async throws -> String {
        guard access == .fullAccess else { throw DIPCalendarWriteError.noAccess }
        guard let event = store.event(withIdentifier: identifier), let url = fields.url, event.url == url else {
            throw DIPCalendarWriteError.notFound
        }
        event.title = fields.title
        apply(fields, to: event)
        do {
            try store.save(event, span: .thisEvent)
        } catch {
            throw DIPCalendarWriteError.failed("update")
        }
        invalidateCache()
        return event.eventIdentifier ?? identifier
    }

    func remove(identifier: String, eventID: String?) async throws {
        guard access == .fullAccess else { throw DIPCalendarWriteError.noAccess }
        // Only DIP's own entries, and (when asked) only the entry for this event.
        guard let event = store.event(withIdentifier: identifier), let url = event.url,
              let linkedEvent = DIPShareLink.eventID(from: url), eventID == nil || linkedEvent == eventID else {
            throw DIPCalendarWriteError.notFound
        }
        do {
            try store.remove(event, span: .thisEvent)
        } catch {
            throw DIPCalendarWriteError.failed("remove")
        }
        invalidateCache()
    }

    /// Times, venue and notes, matching `DIPEventKitCalendarAdder`: all-day entries float on the same calendar days.
    private func apply(_ fields: DIPCalendarEventFields, to event: EKEvent) {
        event.isAllDay = fields.isAllDay
        if fields.isAllDay {
            let days = fields.floatingAllDayDates()
            event.startDate = days.start
            event.endDate = days.end
            event.timeZone = nil
        } else {
            event.startDate = fields.startDate
            event.endDate = fields.endDate
            event.timeZone = fields.timeZone
        }
        event.location = fields.location.isEmpty ? nil : fields.location
        event.notes = fields.notes.isEmpty ? nil : fields.notes
    }
}
