import DIPCore
import EventKit
import Foundation

/// The device calendar over one shared `EKEventStore` (docs/design/stretch/calendar.md, conflict engine).
///
/// Reads need full access and cover one cached window at a time; the cache is dropped when the store changes.
/// Writes are limited to entries DIP created, recognized by the DIP share link in the entry URL. Calendar titles
/// are never logged or persisted here.
@MainActor final class DIPEventKitDeviceCalendar: DIPDeviceCalendar {
    private let store: EKEventStore
    /// Set by the model wiring; called after the cache is cleared when the calendar database changes.
    var onChange: (@MainActor () -> Void)?
    private var cache: (start: Date, end: Date, items: [DIPCalendarItem])?
    nonisolated(unsafe) private var observer: NSObjectProtocol?
    /// The shortest window a read caches, so scrolling Home does not re-query per event.
    private static let minimumWindowDays = 45

    init(store: EKEventStore = EKEventStore()) {
        self.store = store
        observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.cache = nil
                self?.onChange?()
            }
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
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
        cache = nil
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
            let predicate = store.predicateForEvents(withStart: windowStart, end: windowEnd, calendars: nil)
            let fetched = store.events(matching: predicate).map(Self.item)
            cache = (windowStart, windowEnd, fetched)
            all = fetched
        }
        return all.filter { $0.start < end && $0.end > start }
    }

    func identifier(forURL url: URL, start: Date, end: Date) async -> String? {
        guard access == .fullAccess else { return nil }
        let day: TimeInterval = 86_400
        let predicate = store.predicateForEvents(withStart: start.addingTimeInterval(-day), end: end.addingTimeInterval(day), calendars: nil)
        return store.events(matching: predicate).first { $0.url == url }?.eventIdentifier
    }

    private static func item(_ event: EKEvent) -> DIPCalendarItem {
        let availability: DIPCalendarItem.Availability = switch event.availability {
        case .free: .free
        case .tentative: .tentative
        default: .busy
        }
        let declined = event.attendees?.contains { $0.isCurrentUser && $0.participantStatus == .declined } ?? false
        return DIPCalendarItem(
            title: event.title ?? "", start: event.startDate, end: event.endDate, isAllDay: event.isAllDay,
            availability: availability, isDeclined: declined, isCanceled: event.status == .canceled, url: event.url)
    }

    // MARK: Writes (entries DIP created)

    func save(_ fields: DIPCalendarEventFields) async throws -> String {
        let current = access
        guard current == .fullAccess || current == .writeOnly else { throw DIPCalendarWriteError.noAccess }
        let event = EKEvent(eventStore: store)
        event.calendar = store.defaultCalendarForNewEvents
        event.title = fields.title
        apply(fields, to: event)
        event.url = fields.url
        do {
            try store.save(event, span: .thisEvent)
        } catch {
            throw DIPCalendarWriteError.failed("save")
        }
        cache = nil
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
        cache = nil
        return event.eventIdentifier ?? identifier
    }

    func remove(identifier: String) async throws {
        guard access == .fullAccess else { throw DIPCalendarWriteError.noAccess }
        guard let event = store.event(withIdentifier: identifier), let url = event.url,
              DIPShareLink.eventID(from: url) != nil else {
            throw DIPCalendarWriteError.notFound
        }
        do {
            try store.remove(event, span: .thisEvent)
        } catch {
            throw DIPCalendarWriteError.failed("remove")
        }
        cache = nil
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
