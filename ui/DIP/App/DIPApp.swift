import SwiftUI

// Attaches to Firebase when local configuration exists (FirebaseBootstrap).
// The onboarding/accounts root view is composed here by the onboarding PR.
@main
struct DIPApp: App {
    init() {
        FirebaseBootstrap.configureIfAvailable()
    }

    var body: some Scene {
        WindowGroup {
            Text("DIP — development setup")
                .onOpenURL { url in _ = FirebaseBootstrap.handle(url: url) }
        }
    }
}
