import DIPCore
import DIPDesignSystem
import SwiftUI

/// Rewards tab, following the Figma Rewards frame (76:7200): the raffle entry (progress built into it), then
/// "Discounted Experiences". The ticket-shaped cards are replaced by solid gift-box cards with a small
/// bow. Mock-backed (V2-S03 stretch): entries are local and selecting one only shows a notice.
struct DIPRewardsScreen: View {
    let unreadCount: Int
    let profileAvatar: MediaReference
    private let showsBottomBar: Bool
    let onSelectTab: (DIPHomeTab) -> Void
    let onNotifications: () -> Void
    let onProfile: () -> Void

    @State private var notice: DIPRewardEntry?
    private let isEmpty: Bool

    init(
        unreadCount: Int, profileAvatar: MediaReference, showsBottomBar: Bool = true,
        onSelectTab: @escaping (DIPHomeTab) -> Void, onNotifications: @escaping () -> Void, onProfile: @escaping () -> Void
    ) {
        self.unreadCount = unreadCount
        self.profileAvatar = profileAvatar
        self.showsBottomBar = showsBottomBar
        self.onSelectTab = onSelectTab
        self.onNotifications = onNotifications
        self.onProfile = onProfile
        // `--rewards-state=empty` is for design review only.
        isEmpty = ProcessInfo.processInfo.arguments.contains("--rewards-state=empty")
    }

    /// Type sizes from the Rewards frame.
    private enum Metrics {
        static let title: CGFloat = 26, subtitle: CGFloat = 18, body: CGFloat = 14, inset: CGFloat = 20
    }

    private var ink: Color { DIPTokens.Color.textPrimary.swiftUIColor }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                DIPTokens.Color.surfaceDefault.swiftUIColor
                VStack(spacing: 0) {
                    DIPHomeHeader(
                        title: "Rewards", unreadCount: unreadCount,
                        profileAvatar: { DIPMedia(profileAvatar) },
                        onNotifications: onNotifications, onProfile: onProfile
                    )
                    .padding(.horizontal, 20).padding(.top, 60).padding(.bottom, 10)
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            if isEmpty {
                                DIPEmptyState(
                                    screen: "rewards", title: "No rewards yet",
                                    message: "Rewards and discounts will show up here.",
                                    actionTitle: "Find an event") { onSelectTab(.home) }
                                    .frame(maxWidth: .infinity, minHeight: max(0, geometry.size.height - 360), alignment: .center)
                            } else {
                                raffleSection
                                discountSection
                            }
                        }
                        .padding(.horizontal, 20).padding(.top, 14).padding(.bottom, 120)
                    }
                    .scrollIndicators(.hidden)
                    .accessibilityIdentifier("rewards.content")
                }
                if showsBottomBar {
                    DIPFloatingNavigation(selected: .rewards, onSelect: onSelectTab)
                        .padding(.horizontal, 20)
                        .position(x: geometry.size.width / 2, y: geometry.size.height - 61)
                }
            }
            .clipped()
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
        .alert(notice?.title ?? "Rewards", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button("OK") { notice = nil }
        } message: {
            Text("This is a mock preview. Entering and redeeming are not connected yet.")
        }
    }

    // MARK: Raffle

    private var raffleSection: some View {
        entryCard(DIPRewardsMock.raffle, progress: true).padding(.top, 26)
    }

    // MARK: Discounts

    private var discountSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(spacing: 36) {
                ForEach(DIPRewardsMock.discounts) { entryCard($0) }
            }
        }
        .padding(.top, 40)
    }

    /// Same content geometry as the ticket (38 pt text inset, 20 pt title, bold subtitle, 14 pt body),
    /// on a gift-box card instead of the notched ticket shape.
    private func entryCard(_ entry: DIPRewardEntry, progress: Bool = false) -> some View {
        let dark = entry.style.usesDarkText
        return Button { notice = entry } label: {
            DIPGiftBoxCard(style: entry.style, tag: entry.badge) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(entry.title.uppercased())
                        .font(DIPReferenceAssets.font("FjallaOne-Regular", size: Metrics.title, relativeTo: .title))
                        .tracking(0.3)
                        .foregroundStyle(dark ? ink : .white)
                    Text(entry.subtitle)
                        .font(DIPReferenceAssets.font("Figtree-Bold", size: Metrics.subtitle, relativeTo: .headline))
                        .foregroundStyle(dark ? ink : .white)
                        .padding(.top, 6)
                    Text(entry.body)
                        .font(DIPReferenceAssets.font("Inter-Regular", size: Metrics.body, relativeTo: .subheadline))
                        .lineSpacing(6)
                        .foregroundStyle(dark ? ink.opacity(0.7) : .white.opacity(0.9))
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 12)
                    if progress { raffleMeter.padding(.top, 16) }
                }
                .multilineTextAlignment(.leading)
                .padding(.horizontal, Metrics.inset).padding(.top, DIPGiftBoxCard<EmptyView>.lidHeight + 12).padding(.bottom, 20)
                .frame(maxWidth: .infinity, minHeight: progress ? 190 : 168, alignment: .topLeading)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(DIPGiftPressStyle())
        .accessibilityLabel("\(entry.title). \(entry.subtitle). \(entry.body)")
        .accessibilityIdentifier("rewards.entry.\(entry.id)")
    }

    /// Raffle progress built into the card: three segments and one short line.
    private var raffleMeter: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 3) {
                ForEach(0..<DIPRewardsMock.raffleNeeded, id: \.self) { index in
                    Capsule().fill(ink.opacity(index < DIPRewardsMock.raffleAttended ? 1 : 0.15)).frame(height: 8)
                }
            }
            Text(DIPRewardsMock.raffleRemainingText)
                .font(DIPReferenceAssets.font("Figtree-Regular", size: Metrics.body, relativeTo: .subheadline).weight(.semibold))
                .foregroundStyle(ink)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(DIPRewardsMock.raffleAttended) of \(DIPRewardsMock.raffleNeeded) events attended. \(DIPRewardsMock.raffleRemainingText)")
    }
}

/// Subtle press feedback for the gift cards.
private struct DIPGiftPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.8), value: configuration.isPressed)
    }
}
