import DIPAccounts
import DIPDesignSystem
import SwiftUI

/// Account onboarding on top of `AccountsSession`. Renders `memberContent` only for an
/// observed member. The owner of the session (app composition) starts and stops it.
struct AccountsRootView<MemberContent: View>: View {
    let session: AccountsSession
    @ViewBuilder let memberContent: (MembershipContext) -> MemberContent
    /// Set once this session shows "Finding your company", so only a resolution the member watched
    /// plays the success haptic (a restored session on cold launch stays silent).
    @State private var sawResolving = false

    var body: some View {
        let route = AccountsRoute(session.state)
        Group {
            // One long-lived Stage for every non-member route, so A0–A4 morph instead of swapping views.
            if case .member(let context) = route {
                memberContent(context)
            } else {
                AccountsStageView(session: session)
            }
        }
        .onChange(of: route, initial: true) { _, route in
            switch route {
            case .resolving: sawResolving = true
            case .member where sawResolving:
                sawResolving = false
                DIPHaptics.success()
            default: break
            }
        }
    }
}

/// Signed-in stand-in until the events packets provide the home screen.
struct SignedInPlaceholderView: View {
    let session: AccountsSession
    let context: MembershipContext

    private var firstName: String? {
        context.profile.displayName.split(separator: " ").first.map(String.init)
    }

    var body: some View {
        OnboardingScreen(pill: "DIP") {
            OnboardingStatusView(state: .empty(
                title: firstName.map { "You're in, \($0)" } ?? "You're in",
                message: "Your company's events will appear here.",
                face: OnboardingFace(fill: OnboardingTheme.accent, figure: .round, mood: .wink, size: 120),
                cardFill: OnboardingTheme.notification))
        } actions: {
            OnboardingButton("Sign out", emphasis: .secondary) { Task { await session.signOut() } }
        }
    }
}

#if DEBUG
private struct AccountsPreview: View {
    @State private var session: AccountsSession
    init(_ repository: PreviewAccountsRepository) {
        _session = State(initialValue: AccountsSession(repository: repository))
    }
    var body: some View {
        AccountsRootView(session: session) { SignedInPlaceholderView(session: session, context: $0) }
            .task { session.start() }
    }
}

// Continue with Google signs in as `googleAccount`. Demo domains: example.invalid -> Demo
// Company; gmail.com is personal; unknown.test has no company.
#Preview("Welcome → member") { AccountsPreview(PreviewAccountsRepository(googleAccount: "new@example.invalid")) }
#Preview("Personal account") { AccountsPreview(PreviewAccountsRepository(googleAccount: "pat@gmail.com")) }
#Preview("Company not on DIP") { AccountsPreview(PreviewAccountsRepository(googleAccount: "pat@unknown.test")) }
#Preview("Not configured") { AccountsPreview(PreviewAccountsRepository(googleAccount: nil)) }
#Preview("Member") { AccountsPreview(PreviewAccountsRepository(signedInEmail: "member@example.invalid")) }
#endif
