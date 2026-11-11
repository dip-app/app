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
    /// When "Finding your company" appeared; nil when it isn't showing.
    @State private var resolvingSince: Date?
    /// While true the Stage keeps showing "Finding your company" although the session already moved on.
    @State private var holdingResolving = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let route = AccountsRoute(session.state)
        Group {
            // One long-lived Stage for every non-member route, so A0–A4 morph instead of swapping views.
            if case .member(let context) = route, !holdingResolving {
                memberContent(context)
            } else {
                AccountsStageView(session: session, heldRoute: holdingResolving ? .resolving : nil)
            }
        }
        .onChange(of: route, initial: true) { _, route in
            holdResolvingIfNeeded(leaving: route)
            switch route {
            case .resolving: sawResolving = true
            case .member where sawResolving:
                sawResolving = false
                DIPHaptics.success()
            default: break
            }
        }
    }

    /// Pads "Finding your company" to `AccountsStage.minimumResolvingDuration` (owner request: the animation
    /// should be seen). Only pads: a slower resolution adds nothing. Members, notices and problems are all held
    /// the same way, then shown as usual.
    private func holdResolvingIfNeeded(leaving route: AccountsRoute) {
        if route == .resolving {
            if resolvingSince == nil { resolvingSince = Date() }
            return
        }
        guard let since = resolvingSince else { return }
        resolvingSince = nil
        let remaining = AccountsStage.remainingResolvingHold(elapsed: Date().timeIntervalSince(since),
                                                             reduceMotion: reduceMotion)
        guard remaining > 0 else { return }
        holdingResolving = true
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(remaining))
            holdingResolving = false
        }
    }
}

/// Tunables for the sign-in Stage.
enum AccountsStage {
    /// The least time "Finding your company" stays up, from when it appears (owner request, Nov 11).
    /// Rounded up to whole turns of the Bar's face wheel so it ends on a clean beat. `--no-resolving-delay`
    /// sets it to 0 for UI tests.
    static let minimumResolvingDuration: Double = ProcessInfo.processInfo.arguments.contains("--no-resolving-delay") ? 0 : 2.0
    /// Reduce Motion: a shorter hold with the static indicator.
    static let reducedMotionMinimumResolvingDuration: Double = ProcessInfo.processInfo.arguments.contains("--no-resolving-delay") ? 0 : 0.8
    /// One turn of the progress wheel (`DIPProgressWheel.turn`).
    static let wheelTurn = 0.55

    /// Seconds still to hold after `elapsed` seconds of "Finding your company". 0 when no padding is needed.
    static func remainingResolvingHold(elapsed: Double, reduceMotion: Bool) -> Double {
        let minimum = reduceMotion ? reducedMotionMinimumResolvingDuration : minimumResolvingDuration
        guard minimum > 0, elapsed < minimum else { return 0 }
        // Finish on a whole wheel turn: 2.0 s rounds to 4 turns (2.2 s). Reduce Motion has no wheel to finish.
        let target = reduceMotion ? minimum : (minimum / wheelTurn).rounded(.up) * wheelTurn
        return max(0, target - elapsed)
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
