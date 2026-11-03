import DIPAccounts
import SwiftUI

/// Test-only account entry host. Never selects or configures a real Firebase project.
struct OnboardingPreview: View {
    @State private var session: AccountsSession
    private let repository: PreviewAccountsRepository
    init(account: String) {
        let email: String? = switch account {
        case "personal": "pat@gmail.com"
        case "unmapped": "pat@unknown.test"
        case "unconfigured": nil
        default: "new@example.invalid"
        }
        let repository = PreviewAccountsRepository(googleAccount: email, delay: .milliseconds(300))
        self.repository = repository
        _session = State(initialValue: AccountsSession(repository: repository))
    }
    var body: some View {
        AccountsRootView(session: session) { context in
            DIPMemberHome(context: context, repository: repository, onSignOut: { await session.signOut() }).id(context.uid)
        }
            .task { session.start() }
            .onDisappear { session.stop() }
    }
}
