import DIPCore
import DIPDesignSystem
import SwiftUI
import UIKit

/// Review host for the weekly-theme entry states (F3): `--challenge-submission=<state>` with
/// `none | pending | approved | rejected | missed | loading | load-failed | upcoming`. The window is Mon-Sun,
/// New York; entries go to the in-memory source (no network). `--submission-fail=<n>` makes the first n sends fail
/// (retry review) and `--submission-offline` makes them fail as offline. `--submission-photo` opens the sheet with a
/// photo already picked, `--submission-slow` stretches the upload progress, `--submission-upload-fail` fails the
/// first upload as offline.
struct ChallengeSubmissionPreview: View {
    let state: String
    /// Stands in for the shell: the page publishes its entry action here and this host renders the shared bar.
    @State private var bar = ChallengeEntryBar()

    static func launchMode() -> String? {
        ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--challenge-submission=") }
            .map { String($0.dropFirst("--challenge-submission=".count)) }
    }

    private static func argument(_ name: String) -> String? {
        ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--\(name)=") }.map { String($0.dropFirst("--\(name)=".count)) }
    }

    private var window: (start: Date, end: Date, now: Date) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = DIPChallengeProjection.displayTimeZone
        let start = calendar.date(from: DateComponents(year: 2030, month: 3, day: 4))!
        let end = calendar.date(byAdding: .day, value: 7, to: start)!
        switch state {
        case "upcoming": return (start, end, start.addingTimeInterval(-3 * 86_400))
        case "missed": return (start, end, end.addingTimeInterval(2 * 86_400))
        default: return (start, end, start.addingTimeInterval(2 * 86_400))
        }
    }

    private var source: MockSubmissionSource {
        let id = DIPSubmissionPolicy.submissionID(challengeID: "preview", uid: "preview-member")
        let entry: DIPSubmission? = switch state {
        case "pending": DIPSubmission(id: id, status: .submitted, progress: 2, caption: "Lunchtime run with Sam and Priya", storagePath: "p/0")
        case "approved": DIPSubmission(id: id, status: .approved, progress: 3, caption: "Three classes", pointsAwarded: 50)
        case "rejected": DIPSubmission(id: id, status: .rejected, progress: 3, caption: "Three classes", storagePath: "p/0", reviewNote: "The photo is too dark to see the class.")
        default: nil
        }
        let mock = MockSubmissionSource(initial: entry, load: state == "loading" ? .never : (state == "load-failed" ? .fails : .normal))
        let failures = Int(Self.argument("submission-fail") ?? "") ?? 0
        if let count = Self.argument("submission-evidence-fail") { mock.evidenceFailures = Int(count) ?? 1 }
        if ProcessInfo.processInfo.arguments.contains("--submission-slow") { mock.progressPause = .seconds(2) }
        if ProcessInfo.processInfo.arguments.contains("--submission-upload-fail") { mock.uploadFailures = [.offline] }
        mock.failures = Array(repeating: ProcessInfo.processInfo.arguments.contains("--submission-offline") ? .offline : .unknown, count: failures)
        return mock
    }

    var body: some View {
        let w = window
        let weekly = DIPWeeklyChallenge(
            id: "preview", title: "Fitness", description: "Get moving with coworkers this week: try a class, a walk or a workout together and log it.",
            type: "weekly", goal: 3, goalUnit: "workouts", coverImageURL: "catalog://theme/fitness",
            startDate: w.start, endDate: w.end, pointsReward: 50, participantCount: 12)
        let mock = source
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                DIPChallengeDetailsScreen(challenge: DIPChallengeProjection.detail(weekly), onBack: {}, now: w.now)
                DIPFloatingNavigation(selected: .home, action: bar.action, onSelect: { _ in }, onAction: { bar.perform?() })
                    .padding(.horizontal, 20)
                    .position(x: geometry.size.width / 2, y: geometry.size.height - 61)
            }
        }
        .environment(\.challengeEntryBar, bar)
            .environment(\.challengeSubmissionContext, ChallengeSubmissionContext(
                scope: ChallengeReadScope(uid: "preview-member", companyID: "preview-company"), makeSource: { mock },
                previewPhoto: ProcessInfo.processInfo.arguments.contains("--submission-photo") ? Self.samplePhoto : nil))
    }

    private static var samplePhoto: Data {
        UIGraphicsImageRenderer(size: CGSize(width: 600, height: 450)).jpegData(withCompressionQuality: 0.8) { context in
            UIColor(red: 0.74, green: 0.78, blue: 1.0, alpha: 1).setFill(); context.fill(CGRect(x: 0, y: 0, width: 600, height: 450))
            UIColor(red: 0.98, green: 0.76, blue: 0.18, alpha: 1).setFill(); context.cgContext.fillEllipse(in: CGRect(x: 225, y: 150, width: 150, height: 150))
        }
    }
}
