import DIPDesignSystem
import SwiftUI

// Account layout and illustrations compose the shared component library.

enum OnboardingTheme {
    static let surface = Color(token: DIPTokens.Color.surfaceDefault)
    static let muted = Color(token: DIPTokens.Color.surfaceMuted)
    static let ink = Color(token: DIPTokens.Color.textPrimary)
    static let inverse = Color(token: DIPTokens.Color.textInverse)
    static let accent = Color(token: DIPTokens.Color.actionPrimary)
    static let onAccent = Color(token: DIPTokens.Color.textOnAccent)
    static let challenge = Color(token: DIPTokens.Color.challengeAccent)
    static let notification = Color(token: DIPTokens.Color.notificationAccent)
}

enum OnboardingMetrics {
    /// Comfortable reading width on large phones/iPad; screens stay full-width below it.
    static let readingWidth: CGFloat = 560
    /// Gap between the header pill and the first content block.
    static let headerGap: CGFloat = DIPTokens.Spacing.sectionGap * 2
}

extension Color {
    init(token: RGBColor) {
        self.init(.sRGB, red: token.red, green: token.green, blue: token.blue, opacity: 1)
    }
}

/// Shared button semantics, loading state and press treatment across account screens.
typealias OnboardingButton = DIPButton

/// Onboarding layout: title pill, content directly below it, actions pinned to the bottom.
/// Scrolls when Dynamic Type makes it taller than the screen.
struct OnboardingScreen<Content: View, Actions: View>: View {
    let pill: String
    @ViewBuilder let content: () -> Content
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                DIPHeader(title: pill)
                content().padding(.top, OnboardingMetrics.headerGap)
            }
            .padding(DIPTokens.Spacing.contentInset)
            .frame(maxWidth: OnboardingMetrics.readingWidth, alignment: .topLeading)
            .frame(maxWidth: .infinity)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: DIPTokens.Spacing.related) { actions() }
                .padding(DIPTokens.Spacing.contentInset)
                .frame(maxWidth: OnboardingMetrics.readingWidth)
                .frame(maxWidth: .infinity)
                .background(OnboardingTheme.surface)
        }
        .background(OnboardingTheme.surface.ignoresSafeArea())
        .foregroundStyle(OnboardingTheme.ink)
        .tint(OnboardingTheme.ink)
        .preferredColorScheme(.light)
    }
}

/// Uses the bundled display face, scaled with Dynamic Type.
struct OnboardingTitle: View {
    let text: String
    var body: some View {
        Text(text)
            .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 40, relativeTo: .largeTitle))
            .textCase(.uppercase)
            .lineLimit(nil)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("onboarding.title")
    }
}

/// Account-specific status composition keeps the established onboarding illustration.
struct OnboardingStatusView: View {
    enum State {
        case loading(message: String)
        case empty(title: String, message: String, face: OnboardingFace, cardFill: Color)
        case failure(title: String, message: String, face: OnboardingFace, cardFill: Color)
    }
    let state: State
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: DIPTokens.Spacing.sectionGap) {
            switch state {
            case .loading(let message):
                if !dynamicTypeSize.isAccessibilitySize { OnboardingFaceGroup(size: 64) }
                ProgressView { Text(message).font(DIPReferenceAssets.font("Figtree-Regular", size: 20, relativeTo: .title3)).multilineTextAlignment(.leading) }
                    .tint(OnboardingTheme.ink)
                    .accessibilityLabel(Text(message))
            case .empty(let title, let message, let face, let cardFill),
                 .failure(let title, let message, let face, let cardFill):
                if !dynamicTypeSize.isAccessibilitySize { OnboardingFaceCard(face: face, fill: cardFill) }
                VStack(alignment: .leading, spacing: DIPTokens.Spacing.related) {
                    OnboardingTitle(text: title)
                    Text(message).font(DIPReferenceAssets.font("Inter-Regular", size: 16, relativeTo: .body)).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .foregroundStyle(OnboardingTheme.ink)
    }
}

/// Decorative illustration card shared by the welcome and status screens; echoes the Home
/// challenge card (card radius token, token fill).
struct OnboardingFaceCard<Face: View>: View {
    let face: Face
    let fill: Color
    /// Same height as the welcome card (the Home challenge card reference).
    var height: CGFloat = 225

    var body: some View {
        face
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .background(fill, in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
            .accessibilityHidden(true)
    }
}
