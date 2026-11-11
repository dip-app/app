import DIPCore
import SwiftUI

/// Review host for the weekly-theme page phases: `--challenge-phase=upcoming|active|ended` (window Mon-Sun, New York).
struct ChallengePhasePreview: View {
    let phase: String

    static func launchMode() -> String? {
        ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--challenge-phase=") }
            .map { String($0.dropFirst("--challenge-phase=".count)) }
    }

    private var window: (start: Date, end: Date, now: Date) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = DIPChallengeProjection.displayTimeZone
        let start = calendar.date(from: DateComponents(year: 2030, month: 3, day: 4))!
        let end = calendar.date(byAdding: .day, value: 7, to: start)!
        switch phase {
        case "upcoming": return (start, end, start.addingTimeInterval(-3 * 86_400))
        case "ended": return (start, end, end.addingTimeInterval(2 * 86_400))
        default: return (start, end, start.addingTimeInterval(2 * 86_400))
        }
    }

    var body: some View {
        let w = window
        let weekly = DIPWeeklyChallenge(
            id: "preview", title: "Fitness", description: "Get moving with coworkers this week: try a class, a walk or a workout together and log it.",
            type: "fitness", goal: 3, goalUnit: "workouts", coverImageURL: "catalog://theme/fitness",
            startDate: w.start, endDate: w.end, pointsReward: 50, participantCount: 12)
        DIPChallengeDetailsScreen(challenge: DIPChallengeProjection.detail(weekly), onBack: {}, now: w.now)
    }
}
