import DIPAccounts
import DIPDesignSystem
import SwiftUI

/// Signed-out entry: Google is the only V1 sign-in (ADR 0007).
struct WelcomeView: View {
    let session: AccountsSession
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        OnboardingScreen(pill: "DIP") {
            VStack(alignment: .leading, spacing: DIPTokens.Spacing.sectionGap) {
                if !dynamicTypeSize.isAccessibilitySize { heroCard }
                VStack(alignment: .leading, spacing: DIPTokens.Spacing.related) {
                    OnboardingTitle(text: "Meet your team outside work")
                    Text("Find company events, see who's going, and join in one tap.")
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 16, relativeTo: .body))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        } actions: {
            OnboardingButton("Continue with Google", isLoading: session.isSubmitting) {
                Task { await session.signInWithGoogle() }
            }
            .accessibilityIdentifier("onboarding.google")
            Text("Use your work Google account. We match you to your company by your email's domain.")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 13, relativeTo: .footnote))
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// Echoes the Home challenge card: token colour, card radius, decorative only.
    private var heroCard: some View {
        OnboardingFaceCard(face: OnboardingFaceGroup(size: 88), fill: OnboardingTheme.challenge, height: 225)
    }
}
