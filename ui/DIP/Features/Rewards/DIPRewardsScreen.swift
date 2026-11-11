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
    /// The points pill: the member's real balance, or the design's mock 520 for fixture profiles.
    private let pointsDisplay: DIPPointsDisplay

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var notice: DIPRewardEntry?
    private let isEmpty: Bool

    init(
        unreadCount: Int, profileAvatar: MediaReference, showsBottomBar: Bool = true,
        onSelectTab: @escaping (DIPHomeTab) -> Void, onNotifications: @escaping () -> Void, onProfile: @escaping () -> Void,
        pointsDisplay: DIPPointsDisplay = .balance(520)
    ) {
        self.pointsDisplay = pointsDisplay
        self.unreadCount = unreadCount
        self.profileAvatar = profileAvatar
        self.showsBottomBar = showsBottomBar
        self.onSelectTab = onSelectTab
        self.onNotifications = onNotifications
        self.onProfile = onProfile
        // `--rewards-state=empty` is for design review only.
        isEmpty = ProcessInfo.processInfo.arguments.contains("--rewards-state=empty")
    }

    /// "Your points" with the balance as an outlined (informational, not pressable) pill on the right. The
    /// page is mock-backed, so fixture profiles without a real balance show the design's 520. While loading the
    /// pill is a skeleton of the same size; unavailable shows a dash; a cached value offline carries a wifi.slash.
    private var balancePill: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Text("Your points")
                    .font(DIPReferenceAssets.font("Figtree-Regular", size: Metrics.subtitle))
                    .foregroundStyle(ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                pillContent
                    .animation(reduceMotion ? nil : .smooth, value: pointsDisplay)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(pointsDisplay.accessibilityLabel())
            .accessibilityIdentifier("rewards.balance")
            if pointsDisplay.showsZeroNudge { zeroNudge }
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.3), value: pointsDisplay.showsZeroNudge)
    }

    @ViewBuilder private var pillContent: some View {
        switch pointsDisplay {
        case .loading:
            DIPSkeleton(cornerRadius: -1).frame(width: 92, height: 36)
        case .unavailable:
            pill { Text("—").font(DIPReferenceAssets.font("Figtree-Regular", size: 16)) }
        case .balance(let balance):
            pill { balanceLabel(balance) }
        case .stale(let balance):
            pill {
                Image(systemName: "wifi.slash").font(.system(size: 12)).accessibilityHidden(true)
                balanceLabel(balance)
            }
        }
    }

    private func balanceLabel(_ balance: Int) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "star.fill").font(.system(size: 13)).accessibilityHidden(true)
            Text(DIPPointsFormat.balance(balance))
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 16))
                .contentTransition(.numericText(value: Double(balance)))
        }
    }

    private func pill<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        HStack(spacing: 6) { content() }
            .foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
            .padding(.horizontal, 14).frame(height: 36)
            .overlay(Capsule().strokeBorder(DIPTokens.Color.actionPrimary.swiftUIColor, lineWidth: 2))
    }

    /// A confirmed zero balance: one line on how to earn the first points and the one pressable way there.
    private var zeroNudge: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Join an event to earn your first points.")
                .font(DIPReferenceAssets.font("Inter-Regular", size: Metrics.body, relativeTo: .subheadline))
                .foregroundStyle(ink.opacity(0.7))
                .fixedSize(horizontal: false, vertical: true)
            DIPButton("Find an event") { DIPHaptics.select(); onSelectTab(.home) }
                .accessibilityIdentifier("rewards.zero.action")
        }
        .padding(16)
        .background(DIPTokens.Color.surfaceMuted.swiftUIColor, in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("rewards.zero")
        .transition(.opacity)
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
                            balancePill.padding(.bottom, 16)
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
