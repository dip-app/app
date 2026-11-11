import Foundation

/// Where "now" falls in a weekly theme's window.
public enum DIPChallengePhase: Equatable, Sendable {
    case upcoming, active, ended
}

public extension DIPChallengeDetail {
    /// nil when the source supplied no window (the onboarding demo theme).
    func phase(now: Date) -> DIPChallengePhase? {
        guard let startDate, let endDate else { return nil }
        if now < startDate { return .upcoming }
        return now < endDate ? .active : .ended
    }

    /// Note under "How it works": what the member can do right now (the page is read-only until submissions ship).
    func statusNote(now: Date, timeZone: TimeZone = DIPChallengeProjection.displayTimeZone, locale: Locale = .current) -> String {
        switch phase(now: now) {
        case .upcoming?:
            let formatter = DateFormatter()
            formatter.locale = locale; formatter.timeZone = timeZone
            formatter.setLocalizedDateFormatFromTemplate("EEEMMMd")
            return "Starts \(formatter.string(from: startDate ?? now))"
        case .ended?: return "This weekly theme has ended"
        default: return DIPChallengeText.submissionsSoon
        }
    }

    /// Adding the window to a calendar only makes sense before it ends, and needs real dates.
    func canAddToCalendar(now: Date) -> Bool {
        guard let phase = phase(now: now) else { return false }
        return phase != .ended
    }

    /// All-day multi-day calendar entry for the weekly window (days as displayed, in the window's time zone).
    func calendarFields(timeZone: TimeZone = DIPChallengeProjection.displayTimeZone) -> DIPCalendarEventFields? {
        guard let startDate, let endDate, endDate > startDate else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let firstDay = calendar.startOfDay(for: startDate)
        // The end is exclusive: the last included day is the one containing the last instant.
        let lastInstant = endDate.addingTimeInterval(-1)
        let lastDay = calendar.startOfDay(for: max(lastInstant, firstDay))
        let notes = [description, goalText.map { "Goal: \($0)" }, rewardText.map { "Reward: \($0)" }]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.joined(separator: "\n")
        return DIPCalendarEventFields(
            title: String("Weekly theme: \(title)".prefix(DIPEventMetadata.calendarTitleLimit)),
            startDate: firstDay, endDate: lastDay, isAllDay: true, timeZone: timeZone, location: "",
            notes: String(notes.prefix(DIPEventMetadata.calendarNotesLimit)), url: nil)
    }
}
