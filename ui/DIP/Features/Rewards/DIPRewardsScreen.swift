import DIPCore
import DIPDesignSystem
import SwiftUI

/// Rewards tab: points balance, then gift cards split into "ready to redeem" and "keep earning".
/// Mock-backed (V2-S03 stretch): the catalogue, the balance and redemption are all local and labelled
/// as a preview; no contract, backend or ledger exists yet.
struct DIPRewardsScreen: View {
    enum ContentState: Equatable { case loaded, loading, empty }

    let unreadCount: Int
    let profileAvatar: MediaReference
    private let showsBottomBar: Bool
    let onSelectTab: (DIPHomeTab) -> Void
    let onNotifications: () -> Void
    let onProfile: () -> Void

    @State private var balance = DIPRewardsMock.balance
    @State private var selected: DIPReward?
    private let contentState: ContentState
    private let rewards: [DIPReward]
    private let reviewConfirm: Bool

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
        // `--rewards-state=loading|empty|detail|confirm|locked` is for design review only.
        let review = ProcessInfo.processInfo.arguments.first { $0.hasPrefix("--rewards-state=") }
            .map { String($0.dropFirst("--rewards-state=".count)) }
        let all = DIPRewardsMock.rewards
        self.contentState = review == "loading" ? .loading : review == "empty" ? .empty : .loaded
        self.rewards = all
        self.reviewConfirm = review == "confirm"
        switch review {
        case "detail", "confirm": _selected = State(initialValue: all.first { $0.id == "squishmallow" })
        case "locked": _selected = State(initialValue: all.first { $0.id == "projector" })
        default: break
        }
    }

    private var ink: Color { DIPTokens.Color.textPrimary.swiftUIColor }
    private var ready: [DIPReward] { rewards.filter { $0.isAffordable(balance: balance) } }
    private var locked: [DIPReward] { rewards.filter { !$0.isAffordable(balance: balance) } }

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
                        VStack(alignment: .leading, spacing: 22) {
                            content
                        }
                        .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 120)
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
        .sheet(item: $selected) { reward in
            DIPRewardDetailSheet(reward: reward, balance: balance, startsAtConfirm: reviewConfirm) { redeemed in
                balance = max(0, balance - redeemed.cost)
            }
        }
    }

    @ViewBuilder private var content: some View {
        balanceCard
        switch contentState {
        case .loading:
            loadingGrid
        case .empty:
            DIPEmptyState(
                screen: "rewards", title: "No gifts to claim yet",
                message: "Your organiser adds rewards here. Keep joining events to build up points.",
                actionTitle: "Find an event") { onSelectTab(.home) }
        case .loaded:
            if !ready.isEmpty { section("Ready to redeem", "You have enough points for these.", ready) }
            if !locked.isEmpty { section("Keep earning", "Join events and challenges to unlock these.", locked) }
        }
    }

    // MARK: Balance

    private var balanceCard: some View {
        let goal = DIPRewardsMock.nextGoal(balance: balance, in: rewards)
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Your points")
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
                        .foregroundStyle(.white.opacity(0.75))
                    Text("\(balance)")
                        .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 56, relativeTo: .largeTitle))
                        .foregroundStyle(DIPTokens.Color.notificationAccent.swiftUIColor)
                        .accessibilityIdentifier("rewards.balance")
                }
                Spacer()
                Text("MOCK DATA")
                    .font(DIPReferenceAssets.font("Inter-Medium", size: 11))
                    .foregroundStyle(.white.opacity(0.85)).padding(.horizontal, 10).padding(.vertical, 5)
                    .background(.white.opacity(0.14), in: Capsule())
                    .accessibilityIdentifier("rewards.mock-badge")
            }
            if let goal {
                VStack(alignment: .leading, spacing: 8) {
                    Capsule().fill(.white.opacity(0.18)).frame(height: 10)
                        .overlay(alignment: .leading) {
                            GeometryReader { bar in
                                Capsule().fill(DIPTokens.Color.challengeAccent.swiftUIColor)
                                    .frame(width: max(10, bar.size.width * goal.progress))
                            }
                        }
                    Text("\(goal.reward.pointsShort(balance: balance)) pts to go for \(goal.reward.title)")
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
                        .foregroundStyle(.white)
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DIPTokens.Color.navigationBackground.swiftUIColor, in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
    }

    // MARK: Gift grid

    private let columns = [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)]

    private func section(_ title: String, _ subtitle: String, _ items: [DIPReward]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title.uppercased())
                    .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 24, relativeTo: .title2))
                    .foregroundStyle(ink).accessibilityAddTraits(.isHeader)
                Text(subtitle)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .subheadline))
                    .foregroundStyle(ink.opacity(0.7))
            }
            LazyVGrid(columns: columns, spacing: 14) {
                ForEach(items) { reward in
                    DIPRewardCard(reward: reward, balance: balance) { selected = reward }
                }
            }
        }
    }

    /// Skeleton tiles keep the grid's shape while rewards load; nothing animates.
    private var loadingGrid: some View {
        VStack(alignment: .leading, spacing: 12) {
            RoundedRectangle(cornerRadius: 6).fill(DIPTokens.Color.surfaceMuted.swiftUIColor).frame(width: 150, height: 24)
            LazyVGrid(columns: columns, spacing: 14) {
                ForEach(0..<4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous)
                        .fill(DIPTokens.Color.surfaceMuted.swiftUIColor).frame(height: 214)
                }
            }
        }
        .overlay(alignment: .top) { ProgressView().padding(.top, 60) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading rewards")
        .accessibilityIdentifier("rewards.loading")
    }
}

/// One gift: tinted tile with the illustration, title and a points pill. Locked gifts are dimmed with
/// a lock and the points still needed.
struct DIPRewardCard: View {
    let reward: DIPReward
    let balance: Int
    let onSelect: () -> Void

    private var ink: Color { DIPTokens.Color.textPrimary.swiftUIColor }
    private var affordable: Bool { reward.isAffordable(balance: balance) }

    var body: some View {
        Button(action: onSelect) {
            VStack(spacing: 10) {
                ZStack(alignment: .topTrailing) {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(reward.style.box.tileTint.opacity(affordable ? 0.18 : 0.08))
                    DIPGiftIllustration(style: reward.style, size: 108, dimmed: !affordable)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    if !affordable {
                        Image(systemName: "lock.fill").font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.white).frame(width: 28, height: 28)
                            .background(ink.opacity(0.75), in: Circle()).padding(8)
                    }
                }
                .frame(height: 128)
                VStack(alignment: .leading, spacing: 6) {
                    Text(reward.title.uppercased())
                        .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 18, relativeTo: .headline))
                        .foregroundStyle(ink).lineLimit(1).minimumScaleFactor(0.8)
                    pill
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4)
            }
            .padding(8).padding(.bottom, 4)
            .background(DIPTokens.Color.surfaceDefault.swiftUIColor, in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous).strokeBorder(ink.opacity(0.1), lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(reward.title), \(reward.cost) points, \(affordable ? "ready to redeem" : "\(reward.pointsShort(balance: balance)) more points needed")")
        .accessibilityIdentifier("rewards.card.\(reward.id)")
    }

    @ViewBuilder private var pill: some View {
        if affordable {
            Label("\(reward.cost) pts", systemImage: "star.fill")
                .font(DIPReferenceAssets.font("Figtree-Bold", size: 14)).foregroundStyle(ink)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(DIPTokens.Color.notificationAccent.swiftUIColor, in: Capsule())
        } else {
            VStack(alignment: .leading, spacing: 2) {
                Label("\(reward.cost) pts", systemImage: "star.fill")
                    .font(DIPReferenceAssets.font("Figtree-Bold", size: 14)).foregroundStyle(ink.opacity(0.6))
                Text("\(reward.pointsShort(balance: balance)) more to unlock")
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 12)).foregroundStyle(ink.opacity(0.6))
            }
            .padding(.vertical, 2)
        }
    }
}
