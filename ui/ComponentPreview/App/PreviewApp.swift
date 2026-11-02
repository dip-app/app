import SwiftUI

@main
struct PreviewApp: App {
    var body: some Scene {
        WindowGroup {
            Group {
                if ProcessInfo.processInfo.arguments.contains("--gallery") {
                    DIPFoundationGallery()
                } else {
                    DIPHomeFixturePreview()
                }
            }
            .environment(
                \.dynamicTypeSize,
                ProcessInfo.processInfo.arguments.contains("--large-text") ? .accessibility3 : .large)
        }
    }
}
