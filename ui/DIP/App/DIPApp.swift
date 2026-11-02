import DIPDesignSystem
import SwiftUI

@main
struct DIPApp: App {
    init() { FirebaseBootstrap.configureIfAvailable() }

    var body: some Scene {
        WindowGroup {
            launchContent
                .onOpenURL { url in _ = FirebaseBootstrap.handle(url: url) }
        }
    }

    @ViewBuilder private var launchContent: some View {
        #if DEBUG
        if FirebaseBootstrap.status == .notConfigured {
            DIPHomeFixturePreview()
        } else {
            accountHandoff
        }
        #else
        accountHandoff
        #endif
    }

    private var accountHandoff: some View {
        DIPStateView(.empty(
            title: "Welcome to DIP",
            message: "Sign-in is unavailable in this build."))
    }
}
