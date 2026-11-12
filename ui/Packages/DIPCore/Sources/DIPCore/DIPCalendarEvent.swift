import Foundation

/// Platform-neutral calendar event fields derived from event metadata. EventKit stays in the app target.
public struct DIPCalendarEventFields: Equatable, Sendable {
    public var title: String
    public var startDate: Date
    public var endDate: Date
    public var isAllDay: Bool
    public var timeZone: TimeZone
    public var location: String
    public var notes: String
    public var url: URL?

    /// All-day entries float: the same calendar days as shown in `timeZone` (the window's zone) land on the same days in
    /// the device calendar, whatever zone the device is in. Dates are local midnights of those days.
    public func floatingAllDayDates(deviceCalendar: Calendar = .current) -> (start: Date, end: Date) {
        var source = Calendar(identifier: .gregorian); source.timeZone = timeZone
        func local(_ date: Date) -> Date {
            let parts = source.dateComponents([.year, .month, .day], from: date)
            return deviceCalendar.date(from: parts) ?? date
        }
        let start = local(startDate)
        return (start, max(start, local(endDate)))
    }
}

public enum DIPCalendarAddResult: Equatable, Sendable {
    case added, cancelled, failed(String)
}

/// Adds an event to the user's calendar. The EventKit adapter lives in the app; previews and tests use a fake.
public protocol DIPEventCalendarAdding: Sendable {
    @MainActor func add(_ fields: DIPCalendarEventFields) async -> DIPCalendarAddResult
}

extension DIPEventMetadata {
    public static let calendarTitleLimit = 120
    public static let calendarNotesLimit = 500
    public static let calendarDefaultDuration: TimeInterval = 3_600

    /// Hidden for cancelled and past events.
    public func canAddToCalendar(now: Date) -> Bool {
        status == .scheduled && calendarEnd > now
    }

    /// An absent or inverted end time defaults to one hour after the start.
    var calendarEnd: Date {
        endTime > startTime ? endTime : startTime.addingTimeInterval(Self.calendarDefaultDuration)
    }

    public func calendarFields(title: String, description: String, timeZone: TimeZone = .current) -> DIPCalendarEventFields {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let end = calendarEnd
        // All-day: starts at local midnight and spans whole days.
        let allDay = calendar.startOfDay(for: startTime) == startTime
            && calendar.startOfDay(for: end) == end
            && end.timeIntervalSince(startTime) >= 86_400
        let location = Self.uniqueJoined([venueName, address, locality])
        return DIPCalendarEventFields(
            title: Self.clip(title, Self.calendarTitleLimit), startDate: startTime, endDate: end,
            isAllDay: allDay, timeZone: timeZone, location: location,
            notes: Self.clip(description, Self.calendarNotesLimit), url: mapsURL)
    }

    static func uniqueJoined(_ parts: [String]) -> String {
        var seen: [String] = []
        for part in parts.map({ $0.trimmingCharacters(in: .whitespacesAndNewlines) }) where !part.isEmpty {
            if !seen.contains(where: { $0.localizedCaseInsensitiveContains(part) }) { seen.append(part) }
        }
        return seen.joined(separator: ", ")
    }

    private static func clip(_ text: String, _ limit: Int) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > limit else { return trimmed }
        return String(trimmed.prefix(limit - 1)) + "…"
    }
}
