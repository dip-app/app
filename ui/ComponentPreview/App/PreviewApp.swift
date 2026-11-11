import DIPCore
import DIPDesignSystem
import SwiftUI

@main
struct PreviewApp: App {
    @StateObject private var calendar = FakeCalendarAdder()
    /// Previews send reports to the in-memory submitter (never a network); `--bugreport-*` flags pick the outcome.
    private let previewBugReporting = BugReportContext.make(
        uid: "preview-member", submitter: BugReportPreviewBehavior.submitter(),
        queueDirectory: FileManager.default.temporaryDirectory.appendingPathComponent("PreviewBugReports-\(UUID().uuidString)"))
    var body: some Scene {
        WindowGroup {
            Group {
                if let theme = HomeThemePreview.launchMode() {
                    HomeThemePreview(mode: theme.mode, count: theme.count)
                } else if let demo = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--onboarding-demo=") }) {
                    let sceneID = String(demo.dropFirst("--onboarding-demo=".count))
                    OnboardingDemoPreview(sceneID: sceneID, configuration: OnboardingDemoPreview.configuration(sceneID: sceneID))
                } else if let mode = HomeFilterPreview.launchMode() {
                    HomeFilterPreview(mode: mode)
                } else if let mode = LongTitlesPreview.launchMode() {
                    LongTitlesPreview(mode: mode)
                } else if let state = ProfileStatesPreview.launchState() {
                    ProfileStatesPreview(state: state)
                } else if let mode = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--changes-sheet=") }) {
                    ChangesSheetPreview(mode: String(mode.dropFirst("--changes-sheet=".count)))
                } else if ProcessInfo.processInfo.arguments.contains("--member-events") {
                    MemberEventsPreview()
                } else if ProcessInfo.processInfo.arguments.contains("--onboarding-interests") {
                    OnboardingInterestsPreview()
                } else if ProcessInfo.processInfo.arguments.contains("--onboarding-tour"),
                          !ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("--onboarding=") }) {
                    OnboardingPreview(account: "member")
                } else if let account = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--onboarding=") }) {
                    OnboardingPreview(account: String(account.dropFirst("--onboarding=".count)))
                } else if ProcessInfo.processInfo.arguments.contains("--gallery") {
                    DIPFoundationGallery()
                } else {
                    DIPHomeFixturePreview()
                }
            }
            // `--progress-style=wheel|orbit|hop` compares the Bar's progress indicators (wheel ships).
            .environment(\.dipProgressIndicatorStyle, ProcessInfo.processInfo.arguments
                .first { $0.hasPrefix("--progress-style=") }
                .flatMap { DIPProgressIndicatorStyle(rawValue: String($0.dropFirst("--progress-style=".count))) }
                ?? .shipping)
            .environment(\.eventCalendarAdder, calendar)
            .environment(\.bugReporting, previewBugReporting)
            .overlay(alignment: .bottom) {
                if ProcessInfo.processInfo.arguments.contains("--fake-calendar") {
                    Text(calendar.summary).font(.system(size: 1)).opacity(0.02)
                        .accessibilityIdentifier("calendar.fake.last")
                }
            }
            .environment(
                \.dynamicTypeSize,
                ProcessInfo.processInfo.arguments.contains("--largest-text") ? .accessibility5
                    : ProcessInfo.processInfo.arguments.contains("--large-text") ? .accessibility3 : .large)
        }
    }
}
