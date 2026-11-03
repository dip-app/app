import DIPAccounts
import SwiftUI

/// Test-only account entry host. Never selects or configures a real Firebase project.
struct OnboardingPreview: View {
    @State private var session: AccountsSession
    init(account: String) {
        let email: String? = switch account {
        case "personal": "pat@gmail.com"
        case "unmapped": "pat@unknown.test"
        case "unconfigured": nil
        default: "new@example.invalid"
        }
        _session = State(initialValue: AccountsSession(
            repository: PreviewAccountsRepository(googleAccount: email, delay: .milliseconds(300))))
    }
    var body: some View {
        AccountsRootView(session: session) { _ in DIPHomeFixturePreview(onSignOut: { await session.signOut() }) }
            .task { session.start() }
            .onDisappear { session.stop() }
    }
}
