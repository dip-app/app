import DIPAccounts
import DIPDesignSystem
import SwiftUI

/// Signed-out entry uses the same fixed action state as the signed-in navigation bar.
struct WelcomeView: View {
    let session: AccountsSession
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        GeometryReader { _ in
            ScrollView {
                VStack(alignment: .leading, spacing: DIPTokens.Spacing.sectionGap) {
                    if !dynamicTypeSize.isAccessibilitySize { heroCard }
                    VStack(alignment: .leading, spacing: DIPTokens.Spacing.related) {
                        OnboardingTitle(text: "Meet your team outside work")
                        Text("Find company events, see who's going, and join in one tap.")
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 16, relativeTo: .body))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, 20)
                .frame(maxWidth: OnboardingMetrics.readingWidth, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) { loginFooter }
        }
        .ignoresSafeArea(.container)
        .background(OnboardingTheme.surface.ignoresSafeArea())
        .foregroundStyle(OnboardingTheme.ink)
        .preferredColorScheme(.light)
    }

    private var loginFooter: some View {
        VStack(spacing: 12) {
            Text("Use your work Google account. We match you to your company by your email's domain.")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 8)
                .accessibilityIdentifier("onboarding.work-account-guidance")
            DIPFloatingNavigation(
                action: DIPBottomBarAction(
                    title: session.isSubmitting ? "Connecting…" : "Continue with Google",
                    identifier: "onboarding.google",
                    value: session.isSubmitting ? "In progress" : nil),
                showsTabs: false,
                onSelect: { _ in },
                onAction: { Task { await session.signInWithGoogle() } }
            )
            .disabled(session.isSubmitting)
        }
        .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 21)
        .frame(maxWidth: OnboardingMetrics.readingWidth)
        .frame(maxWidth: .infinity)
        .background(OnboardingTheme.surface)
    }

    private var heroCard: some View {
        OnboardingFaceCard(face: OnboardingFaceGroup(size: 88), fill: OnboardingTheme.challenge, height: 225)
    }
}
