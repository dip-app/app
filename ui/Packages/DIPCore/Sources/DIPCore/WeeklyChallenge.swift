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
        case ...0: "Be the first this week"
        case 1: "+ 1 other participating"
        default: "+ \(count) others participating"
        }
    }
    public static func participationSpoken(_ count: Int) -> String {
        switch count {
        case ...0: "be the first this week"
        case 1: "1 other participating"
        default: "\(count) others participating"
        }
    }
    /// Shown before any submission UI exists, so members know how entries will work.
    public static let howItWorks = "Do the activity with coworkers during this week, then add a photo and a short note as your entry. Entries are reviewed before points are awarded."
    public static let submissionsSoon = "Submissions open soon"
    public static let noneTitle = "No weekly theme right now."
    public static let noneBody = "A new one starts Monday."
    public static let failure = "Couldn’t load this week’s challenge."
    public static let stale = "Offline · last update"
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
            rewardText: rewardText(challenge.pointsReward), accent: theme.accent)
    }

    /// "Nov 9 - Nov 15". The end is inclusive: a window ending Monday 00:00 (or Sunday 23:59:59)
    /// shows Sunday, so the last instant is formatted rather than the exclusive boundary.
    public static func windowText(start: Date, end: Date, timeZone: TimeZone = displayTimeZone, locale: Locale = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale; formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        let last = max(start, end.addingTimeInterval(-1))
        return "\(formatter.string(from: start)) - \(formatter.string(from: last))"
    }

    public static func goalText(goal: Double, unit: String) -> String? {
        guard goal.isFinite, goal > 0 else { return nil }
        let number = goal.rounded() == goal ? String(Int(goal)) : String(format: "%g", goal)
        let trimmed = unit.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? number : "\(number) \(trimmed)"
    }

    public static func rewardText(_ points: Int) -> String? { points > 0 ? "+\(points) points" : nil }
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
