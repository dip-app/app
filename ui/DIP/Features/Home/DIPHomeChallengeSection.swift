import DIPCore
import DIPDesignSystem
import SwiftUI

extension DIPThemeAccent {
    /// Semantic token behind each catalog accent.
    var fill: Color {
        switch self {
        case .challenge: DIPTokens.Color.challengeAccent.swiftUIColor
        case .neutral: DIPTokens.Color.surfaceMuted.swiftUIColor
        }
    }
    var title: Color {
        switch self {
        case .challenge: DIPTokens.Color.textInverse.swiftUIColor
        case .neutral: DIPTokens.Color.textPrimary.swiftUIColor
        }
    }
}

/// "This Week's Challenge" on Home, for every card state. The loaded card keeps the reference
/// geometry; the skeleton and failure card share its 225 pt footprint so nothing below moves.
/// "No theme this week" is a smaller designed card (decision recorded in the session log).
struct DIPHomeChallengeSection: View {
    static let cardHeight: CGFloat = 225
    let state: DIPChallengeCardState
    let onOpen: (String) -> Void
    let onRetry: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 8) {
                Text("This Week’s Challenge").font(DIPReferenceAssets.font("Figtree-Regular", size: 18))
                    .foregroundStyle(.black).frame(height: 22, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
                if state.isStale {
                    Spacer(minLength: 4)
                    Label(DIPChallengeText.stale, systemImage: "wifi.slash")
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 12, relativeTo: .caption))
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.7))
                        .lineLimit(1).minimumScaleFactor(0.8)
                        .accessibilityLabel("Offline. Showing the last update.")
                        .accessibilityIdentifier("home.challenge.stale")
                }
            }
            content
        }
    }

    @ViewBuilder private var content: some View {
        switch state {
        case .loading: DIPChallengeCardSkeleton()
        case .current(let summary, _):
            DIPChallengeCard(
                category: summary.category, participationText: summary.participationText,
                accessibilityLabel: summary.accessibilityLabel, accent: summary.accent.fill, titleColor: summary.accent.title,
                artwork: summary.artwork.map { DIPMedia($0) },
                avatarStack: summary.avatars.isEmpty ? nil : AnyView(DIPMediaStack(summary.avatars))
            ) { onOpen(summary.id) }
            .transition(.opacity)
        case .none: DIPChallengeEmptyCard()
        case .failed(let message): DIPChallengeFailureCard(message: message, onRetry: onRetry)
        }
    }
}

/// Card-shaped placeholder with the loaded card's footprint. Pulses only without Reduce Motion.
struct DIPChallengeCardSkeleton: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dimmed = false
    private var bar: Color { DIPTokens.Color.surfaceDefault.swiftUIColor.opacity(0.75) }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: DIPTokens.Radius.card).fill(DIPTokens.Color.surfaceMuted.swiftUIColor)
            VStack(alignment: .leading, spacing: 10) {
                Capsule().fill(bar).frame(width: 140, height: 34).padding(.leading, 10)
                HStack {
                    Capsule().fill(bar).frame(width: 210, height: 30)
                    Spacer(minLength: 0)
                    Circle().fill(bar).frame(width: 30, height: 30)
                }
            }
            .padding(5)
        }
        .frame(height: DIPHomeChallengeSection.cardHeight)
        .opacity(dimmed ? 0.55 : 1)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dimmed = true }
        }
        .onChange(of: reduceMotion) { _, reduced in if reduced { dimmed = false } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading this week’s challenge")
        .accessibilityIdentifier("home.challenge.loading")
    }
}

/// No weekly theme in the current window: a quiet card with the app's character faces.
struct DIPChallengeEmptyCard: View {
    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            HStack(spacing: -10) {
                ForEach(["AvatarTeal", "AvatarRed", "AvatarPink"], id: \.self) { name in
                    DIPReferenceAssets.image(name).resizable().frame(width: 40, height: 40)
                        .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                }
            }
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(DIPChallengeText.noneTitle)
                    .font(DIPReferenceAssets.font("Figtree-Regular", size: 17, relativeTo: .headline))
                Text(DIPChallengeText.noneBody)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
                    .opacity(0.75)
            }
            .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 96, alignment: .leading)
        .background(DIPTokens.Color.challengeAccent.swiftUIColor.opacity(0.16),
                    in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("home.challenge.empty")
    }
}

/// Read failed with nothing cached: retry in place; the rest of Home stays usable.
struct DIPChallengeFailureCard: View {
    let message: String
    let onRetry: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark").font(.title2).accessibilityHidden(true)
            Text(message)
                .font(DIPReferenceAssets.font("Inter-Regular", size: 15, relativeTo: .body))
                .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("home.challenge.error.message")
            if let onRetry {
                Button(action: onRetry) {
                    Text("Try again")
                        .font(DIPReferenceAssets.font("Inter-Medium", size: 15, relativeTo: .body))
                        .foregroundStyle(.white).padding(.horizontal, 22).frame(minHeight: 44)
                        .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Reloads this week’s challenge")
                .accessibilityIdentifier("home.challenge.retry")
            }
        }
        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
        .padding(20)
        .frame(maxWidth: .infinity, minHeight: DIPHomeChallengeSection.cardHeight)
        .background(DIPTokens.Color.surfaceMuted.swiftUIColor, in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("home.challenge.error")
    }
}
