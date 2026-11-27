import Foundation

/// The date line of an upcoming event, relative to now so cards feel current:
/// "Today, 7:30 PM", "Tomorrow, 7:30 PM", "Wed, 7:30 PM" within the next six days, otherwise "Nov 30, 7:30 PM"
/// (the year only when it is not the current one). Earlier days (an event that started yesterday and still runs)
/// and past events use the absolute form. Locale-aware: day and month order, weekday names and 12- or 24-hour time
/// follow the locale. Build one per publish and reuse it; the formatters are created once.
public struct DIPEventDateText {
    private let now: Date
    private let calendar: Calendar
    private let locale: Locale
    private let time: DateFormatter
    private let weekday: DateFormatter
    private let monthDay: DateFormatter
    private let monthDayYear: DateFormatter

    public init(now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current, timeZone: TimeZone = .current) {
        var calendar = calendar
        calendar.locale = locale
        calendar.timeZone = timeZone
        self.now = now
        self.calendar = calendar
        self.locale = locale
        func formatter(_ template: String) -> DateFormatter {
            let formatter = DateFormatter()
            formatter.calendar = calendar
            formatter.locale = locale
            formatter.timeZone = timeZone
            formatter.setLocalizedDateFormatFromTemplate(template)
            return formatter
        }
        time = formatter("jmm")
        weekday = formatter("EEE")
        monthDay = formatter("MMMd")
        monthDayYear = formatter("yMMMd")
    }

    /// Card and facts-line text for an event starting at `date`.
    public func string(_ date: Date) -> String {
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? -1
        let clock = time.string(from: date)
        switch days {
        case 0:
            return String(localized: "event.date.today", defaultValue: "Today, \(clock)", bundle: .module, locale: locale,
                          comment: "Event date on a card or the event page when it starts today; %@ = start time such as 7:30 PM")
        case 1:
            return String(localized: "event.date.tomorrow", defaultValue: "Tomorrow, \(clock)", bundle: .module, locale: locale,
                          comment: "Event date on a card or the event page when it starts tomorrow; %@ = start time such as 7:30 PM")
        case 2...6:
            return dayTime(weekday.string(from: date), clock)
        default:
            return absolute(date)
        }
    }

    /// "Nov 30, 7:30 PM" in the current year, "Nov 30, 2027, 7:30 PM" otherwise.
    public func absolute(_ date: Date) -> String {
        let day = calendar.component(.year, from: date) == calendar.component(.year, from: now)
            ? monthDay.string(from: date) : monthDayYear.string(from: date)
        return dayTime(day, time.string(from: date))
    }

    /// One pattern for "Wed, 7:30 PM" and "Nov 30, 7:30 PM" (ICU's own date-time join reads "Nov 30 at 7:30 PM").
    private func dayTime(_ day: String, _ clock: String) -> String {
        String(localized: "event.date.dayTime", defaultValue: "\(day), \(clock)", bundle: .module, locale: locale,
               comment: "Event date on a card or the event page; first %@ = short weekday (Wed) or date (Nov 30), second %@ = start time such as 7:30 PM")
    }
}
