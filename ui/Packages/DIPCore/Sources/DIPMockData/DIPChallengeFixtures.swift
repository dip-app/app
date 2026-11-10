import DIPCore
import Foundation

/// Synthetic weekly-theme fixtures (spec section 5 values). Not server data.
public enum DIPChallengeFixtures {
    /// Monday Nov 9 2026 00:00 America/New_York (05:00 UTC).
    public static let weekStart = Date(timeIntervalSince1970: 1_794_200_400)
    /// The following Monday 00:00 New York minus one second (Sunday Nov 15 23:59:59).
    public static let weekEnd = weekStart.addingTimeInterval(7 * 86_400 - 1)
    public static let description = "Get moving with coworkers this week: try a class, a walk or a workout together and log it."

    /// The Fitness theme with a participant count (0, 1 and 128 are the reviewed variants).
    /// Pass `relativeTo` to centre the window on another instant (live previews use today).
    public static func fitness(participantCount: Int = 128, relativeTo now: Date? = nil) -> DIPWeeklyChallenge {
        let start = now.map { $0.addingTimeInterval(-86_400) } ?? weekStart
        return DIPWeeklyChallenge(
            id: "weekly-fitness-20261109", title: "Fitness", description: description, type: "weekly",
            goal: 3, goalUnit: "workouts", coverImageURL: DIPThemeCatalog.catalogURL(for: "fitness"),
            startDate: start, endDate: start.addingTimeInterval(7 * 86_400 - 1),
            pointsReward: 50, participantCount: participantCount, completedCount: 0)
    }

    /// Reference Home card: the Figma frame's faces and "+ 128 others participating".
    public static var referenceSummary: DIPChallengeSummary {
        var summary = DIPChallengeProjection.summary(fitness())
        summary.id = referenceID
        summary.avatars = ["CoworkerProfilePicture", "AvatarRed", "AvatarTeal"].map(MediaReference.asset)
        return summary
    }

    public static var referenceDetail: DIPChallengeDetail {
        var detail = DIPChallengeProjection.detail(fitness(), locale: Locale(identifier: "en_US"))
        detail.id = referenceID
        return detail
    }

    /// Stable route ID kept from the original prototype fixture.
    public static let referenceID = "fitness-challenge"
}
