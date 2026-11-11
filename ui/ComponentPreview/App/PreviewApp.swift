import SwiftUI

@main
struct PreviewApp: App {
    var body: some Scene {
        WindowGroup {
            Group {
                if let theme = HomeThemePreview.launchMode() {
                    HomeThemePreview(mode: theme.mode, count: theme.count)
                } else if let demo = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--onboarding-demo=") }) {
                    let sceneID = String(demo.dropFirst("--onboarding-demo=".count))
                    OnboardingDemoPreview(sceneID: sceneID, configuration: OnboardingDemoPreview.configuration(sceneID: sceneID))
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
            .environment(
                \.dynamicTypeSize,
                ProcessInfo.processInfo.arguments.contains("--largest-text") ? .accessibility5
                    : ProcessInfo.processInfo.arguments.contains("--large-text") ? .accessibility3 : .large)
        }
    }
}
