import DIPAccounts
import DIPDesignSystem
import SwiftUI

/// Entry point for account onboarding on top of `AccountsSession`.
/// Shows the right screen for the session state and renders `memberContent`
/// only for an observed member. The owner of the session (app composition)
/// calls `start()`/`stop()`; this view never starts or stops it.
struct AccountsRootView<MemberContent: View>: View {
    let session: AccountsSession
    @ViewBuilder let memberContent: (MembershipContext) -> MemberContent

    var body: some View {
        switch AccountsRoute(session.state) {
        case .loading:
            ProgressView("Loading your account…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .auth(let failure):
            AuthView(session: session, failure: failure)
        case .verifyEmail:
            VerifyEmailView(session: session)
        case .joinCompany:
            JoinCompanyView(session: session)
        case .problem(let failure):
            AccountProblemView(session: session, failure: failure)
        case .member(let context):
            memberContent(context)
        }
    }
}

/// A failure outside the sign-in form (listener ended, profile unreadable,
/// offline). Never guesses a company; offers retry or sign-out.
struct AccountProblemView: View {
    let session: AccountsSession
    let failure: AccountsFailure

    var body: some View {
        AccountsScreen(title: "Something's not right", subtitle: failure.message) {
            AccountsPrimaryButton(title: "Try again", isWorking: session.isSubmitting) {
                session.start()
            }
            AccountsSecondaryButton(title: "Sign out") {
                Task { await session.signOut() }
            }
            .disabled(session.isSubmitting)
        }
    }
}

#if DEBUG
private struct MemberPlaceholder: View {
    let context: MembershipContext
    let session: AccountsSession

    var body: some View {
        AccountsScreen(title: "You're in!", subtitle: "Company: \(context.companyID) · Role: \(context.role)") {
            AccountsSecondaryButton(title: "Sign out") {
                Task { await session.signOut() }
            }
        }
    }
}

/// Owns a preview session the way app composition will: start on appear.
private struct AccountsPreview: View {
    @State private var session: AccountsSession

    init(signedInEmail: String? = nil) {
        _session = State(initialValue: AccountsSession(repository: PreviewAccountsRepository(signedInEmail: signedInEmail)))
    }

    var body: some View {
        AccountsRootView(session: session) { MemberPlaceholder(context: $0, session: session) }
            .task { session.start() }
    }
}

// Demo accounts (password "password"): member@ (already a member), new@ (verified,
// no company), unverified@ (tap "I've verified" twice: the preview verifies on the
// second check). Company code: DEMO-2026.
#Preview("Signed out") { AccountsPreview() }
#Preview("Verify email") { AccountsPreview(signedInEmail: "unverified@example.invalid") }
#Preview("Join company") { AccountsPreview(signedInEmail: "new@example.invalid") }
#Preview("Member") { AccountsPreview(signedInEmail: "member@example.invalid") }
#endif
