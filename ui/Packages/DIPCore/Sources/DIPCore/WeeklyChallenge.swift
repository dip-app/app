import Foundation

/// Transport-free view of a stored weekly theme (`companies/{companyId}/challenges/{id}`).
/// The app maps the generated `Challenge` DTO into this value at the data boundary.
public struct DIPWeeklyChallenge: Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var description: String
    public var type: String
    public var goal: Double
    public var goalUnit: String
    public var coverImageURL: String
    public var startDate: Date
    public var endDate: Date
    public var pointsReward: Int
    public var participantCount: Int
    public var completedCount: Int
    public init(id: String, title: String, description: String, type: String = "weekly", goal: Double, goalUnit: String,
                coverImageURL: String, startDate: Date, endDate: Date, pointsReward: Int, participantCount: Int, completedCount: Int = 0) {
        self.id = id; self.title = title; self.description = description; self.type = type; self.goal = goal
        self.goalUnit = goalUnit; self.coverImageURL = coverImageURL; self.startDate = startDate; self.endDate = endDate
        self.pointsReward = pointsReward; self.participantCount = participantCount; self.completedCount = completedCount
    }

    public var theme: DIPTheme { DIPThemeCatalog.theme(coverImageURL: coverImageURL) }

    /// Windows are closed intervals of absolute instants: `startDate <= now <= endDate`.
    public func isCurrent(at now: Date) -> Bool { startDate <= now && now <= endDate }
}

public enum DIPWeeklyChallengeSelection {
    public static let weeklyType = "weekly"

    /// Picks the current weekly theme from the Home query result (`endDate >= now`, ordered by
    /// `endDate`, limit 5): the earliest-ending weekly window that has already started.
    /// Comparison uses absolute instants, so the device time zone never changes the choice.
    public static func current(_ candidates: [DIPWeeklyChallenge], now: Date) -> DIPWeeklyChallenge? {
        candidates
            .filter { $0.type == weeklyType && $0.isCurrent(at: now) }
            .min { ($0.endDate, $0.startDate, $0.id) < ($1.endDate, $1.startDate, $1.id) }
    }
}

/// Shared member-facing copy for the card and detail.
public enum DIPChallengeText {
    public static func participation(_ count: Int) -> String {
        switch count {
        case ...0: String(localized: "challenge.participation.none", defaultValue: "Be the first this week", bundle: .module, comment: "Challenge card: nobody has taken part yet")
        default: String(localized: "challenge.participation.others", defaultValue: "+ \(count) others participating", bundle: .module, comment: "Challenge card; %lld = number of other participants (1 or more)")
        }
    }
    public static func participationSpoken(_ count: Int) -> String {
        switch count {
        case ...0: String(localized: "challenge.participation.spoken.none", defaultValue: "be the first this week", bundle: .module, comment: "VoiceOver for the challenge card: nobody has taken part yet")
        default: String(localized: "challenge.participation.spoken.others", defaultValue: "\(count) others participating", bundle: .module, comment: "VoiceOver for the challenge card; %lld = number of other participants (1 or more)")
        }
    }
    /// How entries work, shown above the entry action (the testing finding: explain before submit).
    public static var howItWorks: String { String(localized: "challenge.text.howItWorks", defaultValue: "Do the activity with coworkers during this week, then add how much you did, a short note and optionally a photo as your entry. Entries are reviewed before points are awarded.", bundle: .module, comment: "Challenge details: explains how entries work") }
    public static var submissionsSoon: String { String(localized: "challenge.text.submissionsSoon", defaultValue: "Submissions open soon", bundle: .module, comment: "Challenge note: entries are not open yet") }
    public static var noneTitle: String { String(localized: "challenge.text.noneTitle", defaultValue: "No weekly theme right now.", bundle: .module, comment: "Home empty state title: no weekly theme") }
    public static var noneBody: String { String(localized: "challenge.text.noneBody", defaultValue: "A new one starts Monday.", bundle: .module, comment: "Home empty state body: no weekly theme") }
    public static var failure: String { String(localized: "challenge.text.failure", defaultValue: "Couldn’t load this week’s challenge.", bundle: .module, comment: "Home error: challenge failed to load") }
    public static var stale: String { String(localized: "challenge.text.stale", defaultValue: "Offline · last update", bundle: .module, comment: "Badge shown when the challenge comes from the offline cache") }
}

public enum DIPChallengeProjection {
    /// Weekly windows are defined in America/New_York (spec section 1); show the same calendar days
    /// on every device so a West-coast member never sees "Nov 8 - Nov 15".
    public static let displayTimeZone = TimeZone(identifier: "America/New_York")!

    public static func summary(_ challenge: DIPWeeklyChallenge) -> DIPChallengeSummary {
        let theme = challenge.theme
        return DIPChallengeSummary(id: challenge.id, category: challenge.title, participantCount: max(0, challenge.participantCount),
                                   avatars: [], artwork: theme.illustration, accent: theme.accent)
    }

    public static func detail(_ challenge: DIPWeeklyChallenge, timeZone: TimeZone = displayTimeZone,
                              locale: Locale = .current) -> DIPChallengeDetail {
        let theme = challenge.theme
        return DIPChallengeDetail(
            id: challenge.id, title: challenge.title, image: theme.illustration,
            timing: windowText(start: challenge.startDate, end: challenge.endDate, timeZone: timeZone, locale: locale),
            description: challenge.description, tags: [], completedCount: max(0, challenge.completedCount),
            goalText: goalText(goal: challenge.goal, unit: challenge.goalUnit),
            rewardText: rewardText(challenge.pointsReward), accent: theme.accent,
            startDate: challenge.startDate, endDate: challenge.endDate, goal: challenge.goal, pointsReward: challenge.pointsReward)
    }

    /// "Nov 9 - Nov 15". The end is inclusive: a window ending Monday 00:00 (or Sunday 23:59:59)
    /// shows Sunday, so the last instant is formatted rather than the exclusive boundary.
    public static func windowText(start: Date, end: Date, timeZone: TimeZone = displayTimeZone, locale: Locale = .current) -> String {
        let last = max(start, end.addingTimeInterval(-1))
        return windowFormatters.format(start: start, last: last, timeZone: timeZone, locale: locale)
    }

    /// Formatters are expensive to build and `detail` runs from view bodies, so they are cached per locale and time
    /// zone (a changed locale or zone gets its own entry). Access is serialized because `DateFormatter` is not Sendable.
    private static let windowFormatters = WindowFormatterCache()

    private final class WindowFormatterCache: @unchecked Sendable {
        private let lock = NSLock()
        private var formatters: [String: DateFormatter] = [:]

        func format(start: Date, last: Date, timeZone: TimeZone, locale: Locale) -> String {
            lock.lock(); defer { lock.unlock() }
            let key = "\(locale.identifier)|\(timeZone.identifier)"
            let formatter: DateFormatter
            if let cached = formatters[key] { formatter = cached } else {
                formatter = DateFormatter()
                formatter.locale = locale; formatter.timeZone = timeZone
                formatter.setLocalizedDateFormatFromTemplate("MMMd")
                formatters[key] = formatter
            }
            return String(localized: "challenge.window.range", defaultValue: "\(formatter.string(from: start)) - \(formatter.string(from: last))", bundle: .module, comment: "Date range of a weekly theme; first %@ = first day, second %@ = last day, e.g. Nov 9 - Nov 15")
        }
    }

    public static func goalText(goal: Double, unit: String) -> String? {
        guard goal.isFinite, goal > 0 else { return nil }
        let number = goal.rounded() == goal ? String(Int(goal)) : String(format: "%g", goal)
        let trimmed = unit.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? number : String(localized: "challenge.goal.format", defaultValue: "\(number) \(trimmed)", bundle: .module, comment: "Goal text; first %@ = number, second %@ = unit such as miles")
    }

    public static func rewardText(_ points: Int) -> String? { points > 0 ? String(localized: "challenge.reward.points", defaultValue: "+\(points) points", bundle: .module, comment: "Reward text; %lld = points") : nil }
}

/// What the Home challenge section renders. Pure value so every state is testable without UI.
public enum DIPChallengeCardState: Equatable, Sendable {
    /// First load: a card-shaped skeleton with the loaded card's footprint.
    case loading
    /// The current theme. `stale` means it came from the offline cache or a failed refresh.
    case current(DIPChallengeSummary, stale: Bool)
    /// No theme this week: the designed empty card.
    case none
    /// Nothing to show and the read failed: retry in place, rest of Home unaffected.
    case failed(String)

    public var summary: DIPChallengeSummary? {
        if case .current(let summary, _) = self { return summary }
        return nil
    }
    public var isStale: Bool {
        if case .current(_, let stale) = self { return stale }
        return false
    }
}
