import DIPDesignSystem
import SwiftUI

// Feature-local copies of the shared UI-foundations look (PR #3, `feature/ui-foundations`):
// `OnboardingButton` mirrors `DIPButton`, `OnboardingTitlePill` mirrors `DIPHeader`'s title
// pill, and `OnboardingStatusView` mirrors `DIPStateView`'s states. They use only shared
// tokens. When PR #3 merges, swap them for the shared components; call sites keep their shape.

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
    /// Vertical padding of the title pill, copied from `DIPHeader`.
    static let pillVerticalInset: CGFloat = 14
    /// Gap between the header pill and the first content block.
    static let headerGap: CGFloat = DIPTokens.Spacing.sectionGap * 2
}

extension Color {
    init(token: RGBColor) {
        self.init(.sRGB, red: token.red, green: token.green, blue: token.blue, opacity: 1)
    }
}

/// Mirrors `DIPButton(_:emphasis:isLoading:isEnabled:action:)`.
struct OnboardingButton: View {
    enum Emphasis { case primary, secondary }
    private let title: String
    private let emphasis: Emphasis
    private let isLoading: Bool
    private let isEnabled: Bool
    private let action: () -> Void

    init(
        _ title: String, emphasis: Emphasis = .primary, isLoading: Bool = false, isEnabled: Bool = true,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.emphasis = emphasis
        self.isLoading = isLoading
        self.isEnabled = isEnabled
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: DIPTokens.Spacing.related) {
                if isLoading { ProgressView().tint(OnboardingTheme.onAccent).accessibilityHidden(true) }
                Text(title).font(.body.weight(.semibold)).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, minHeight: DIPTokens.Spacing.minimumTouchTarget)
            .padding(.horizontal, DIPTokens.Spacing.contentInset)
            .padding(.vertical, DIPTokens.Spacing.compact)
            .contentShape(Capsule())
        }
        .buttonStyle(PillStyle(
            background: emphasis == .primary ? OnboardingTheme.accent : OnboardingTheme.muted,
            foreground: OnboardingTheme.onAccent))
        .disabled(!isEnabled || isLoading)
        .accessibilityLabel(Text(title))
        .accessibilityValue(Text(isLoading ? "In progress" : (!isEnabled ? "Unavailable" : "")))
    }

    private struct PillStyle: ButtonStyle {
        @Environment(\.isEnabled) private var isEnabled
        let background: Color
        let foreground: Color
        func makeBody(configuration: Configuration) -> some View {
            configuration.label.foregroundStyle(foreground)
                .background(background, in: Capsule())
                .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.55)
        }
    }
}

/// Mirrors the title pill in `DIPHeader`.
struct OnboardingTitlePill: View {
    let title: String
    var body: some View {
        Text(title).font(.title3.weight(.medium)).fixedSize(horizontal: false, vertical: true)
            .foregroundStyle(OnboardingTheme.onAccent)
            .padding(.horizontal, DIPTokens.Spacing.contentInset)
            .padding(.vertical, OnboardingMetrics.pillVerticalInset)
            .background(OnboardingTheme.accent, in: Capsule())
            .accessibilityAddTraits(.isHeader)
    }
}

/// Onboarding layout: title pill, content directly below it, actions pinned to the bottom.
/// Scrolls when Dynamic Type makes it taller than the screen.
struct OnboardingScreen<Content: View, Actions: View>: View {
    let pill: String
    @ViewBuilder let content: () -> Content
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    OnboardingTitlePill(title: pill)
                    content().padding(.top, OnboardingMetrics.headerGap)
                    Spacer(minLength: DIPTokens.Spacing.sectionGap)
                    VStack(spacing: DIPTokens.Spacing.related) { actions() }
                }
                .padding(DIPTokens.Spacing.contentInset)
                .frame(maxWidth: OnboardingMetrics.readingWidth, minHeight: proxy.size.height, alignment: .topLeading)
                .frame(maxWidth: .infinity)
            }
        }
        .background(OnboardingTheme.surface.ignoresSafeArea())
        .foregroundStyle(OnboardingTheme.ink)
        .tint(OnboardingTheme.ink)
    }
}

/// Screen title in the app's display style: a condensed system stand-in for the 40 pt
/// Fjalla One reference (not bundled on this branch), scaled with Dynamic Type.
struct OnboardingTitle: View {
    let text: String
    @ScaledMetric(relativeTo: .largeTitle) private var size: CGFloat = 40
    var body: some View {
        Text(text)
            .font(.system(size: size, weight: .bold).width(.condensed))
            .textCase(.uppercase)
            .lineLimit(nil)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Mirrors `DIPStateView.State` (`loading`, `empty`, `failure`) with the onboarding illustration.
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
                ProgressView { Text(message).font(.title3.weight(.medium)).multilineTextAlignment(.leading) }
                    .tint(OnboardingTheme.ink)
                    .accessibilityLabel(Text(message))
            case .empty(let title, let message, let face, let cardFill),
                 .failure(let title, let message, let face, let cardFill):
                if !dynamicTypeSize.isAccessibilitySize { OnboardingFaceCard(face: face, fill: cardFill) }
                VStack(alignment: .leading, spacing: DIPTokens.Spacing.related) {
                    OnboardingTitle(text: title)
                    Text(message).font(.body).fixedSize(horizontal: false, vertical: true)
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
