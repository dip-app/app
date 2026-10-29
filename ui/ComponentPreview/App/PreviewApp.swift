import SwiftUI

@main
struct PreviewApp: App {
    var body: some Scene {
        WindowGroup {
            DIPFoundationGallery()
                .environment(
                    \.dynamicTypeSize,
                    ProcessInfo.processInfo.arguments.contains("--large-text") ? .accessibility3 : .large)
        }
    }
}
