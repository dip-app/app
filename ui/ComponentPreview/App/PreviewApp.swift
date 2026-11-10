import SwiftUI

@main
struct PreviewApp: App {
    var body: some Scene {
        WindowGroup {
            Group {
                if let theme = HomeThemePreview.launchMode() {
                    HomeThemePreview(mode: theme.mode, count: theme.count)
                } else if ProcessInfo.processInfo.arguments.contains("--member-events") {
                    MemberEventsPreview()
                } else if let account = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--onboarding=") }) {
                    OnboardingPreview(account: String(account.dropFirst("--onboarding=".count)))
                } else if ProcessInfo.processInfo.arguments.contains("--gallery") {
                    DIPFoundationGallery()
                } else {
                    DIPHomeFixturePreview()
                }
            }
            .environment(
                \.dynamicTypeSize,
                ProcessInfo.processInfo.arguments.contains("--largest-text") ? .accessibility5
                    : ProcessInfo.processInfo.arguments.contains("--large-text") ? .accessibility3 : .large)
        }
    }
}
