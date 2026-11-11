import DIPDesignSystem
import SwiftUI

/// Gift detail with a two-step mock redemption: review, then an explicit confirm. Nothing is sent
/// anywhere; confirming only updates the screen's local mock balance.
struct DIPRewardDetailSheet: View {
    private enum Step { case review, confirm, done }

    let reward: DIPReward
    let balance: Int
    let onRedeem: (DIPReward) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var step: Step

    init(reward: DIPReward, balance: Int, startsAtConfirm: Bool = false, onRedeem: @escaping (DIPReward) -> Void) {
        self.reward = reward
        self.balance = balance
        self.onRedeem = onRedeem
        _step = State(initialValue: startsAtConfirm ? .confirm : .review)
    }

    private var ink: Color { DIPTokens.Color.textPrimary.swiftUIColor }
    private var affordable: Bool { reward.isAffordable(balance: balance) }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 18) {
                    hero
                    VStack(spacing: 8) {
                        Text(reward.title.uppercased())
                            .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 32, relativeTo: .largeTitle))
                            .foregroundStyle(ink)
                        Text(step == .done ? "Redeemed in this preview. No real gift is ordered." : reward.detail)
                            .font(DIPReferenceAssets.font("Inter-Regular", size: 15, relativeTo: .body))
                            .foregroundStyle(ink.opacity(0.75)).multilineTextAlignment(.center)
                    }
                    summary
                    mockNotice
                }
                .padding(.horizontal, 20).padding(.top, 26).padding(.bottom, 12)
            }
            .scrollIndicators(.hidden)
            actions.padding(.horizontal, 20).padding(.bottom, 24).padding(.top, 8)
        }
        .background(DIPTokens.Color.surfaceDefault.swiftUIColor)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(DIPTokens.Radius.navigation)
        .accessibilityIdentifier("rewards.detail")
    }

    private var hero: some View {
        ZStack {
            RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous)
                .fill(reward.style.box.tileTint.opacity(0.18))
            DIPGiftIllustration(style: reward.style, size: 150, dimmed: !affordable && step == .review)
            if step == .done {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 34))
                    .foregroundStyle(.white, DIPTokens.Color.actionPrimary.swiftUIColor)
                    .offset(x: 62, y: -58)
            }
        }
        .frame(height: 200)
    }

    private var summary: some View {
        VStack(spacing: 0) {
            row("Cost", "\(reward.cost) pts")
            Divider()
            if step == .done {
                row("New balance", "\(balance) pts")
            } else {
                row("Your balance", "\(balance) pts")
                Divider()
            }
            if step == .done {
                EmptyView()
            } else if affordable {
                row("Balance after", "\(balance - reward.cost) pts")
            } else {
                row("You need", "\(reward.pointsShort(balance: balance)) more pts")
            }
        }
        .padding(.horizontal, 18)
        .background(DIPTokens.Color.surfaceMuted.swiftUIColor, in: RoundedRectangle(cornerRadius: DIPTokens.Radius.card, style: .continuous))
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(DIPReferenceAssets.font("Inter-Regular", size: 14))
            Spacer()
            Text(value).font(DIPReferenceAssets.font("Figtree-Bold", size: 17))
        }
        .foregroundStyle(ink).frame(minHeight: 48)
    }

    private var mockNotice: some View {
        Label("Mock preview. Nothing is redeemed or deducted from a real balance.", systemImage: "info.circle")
            .font(DIPReferenceAssets.font("Inter-Regular", size: 12))
            .foregroundStyle(ink.opacity(0.6)).multilineTextAlignment(.leading)
            .accessibilityIdentifier("rewards.mock-notice")
    }

    @ViewBuilder private var actions: some View {
        switch step {
        case .review:
            DIPButton(affordable ? "Redeem for \(reward.cost) pts" : "Need \(reward.pointsShort(balance: balance)) more pts", isEnabled: affordable) {
                withAnimation(.snappy) { step = .confirm }
            }
            .accessibilityIdentifier("rewards.redeem")
        case .confirm:
            VStack(spacing: 10) {
                Text("Spend \(reward.cost) pts on \(reward.title)?")
                    .font(DIPReferenceAssets.font("Figtree-Bold", size: 17)).foregroundStyle(ink)
                DIPButton("Confirm redemption") {
                    onRedeem(reward)
                    withAnimation(.snappy) { step = .done }
                }
                .accessibilityIdentifier("rewards.confirm")
                DIPButton("Cancel", emphasis: .secondary) { withAnimation(.snappy) { step = .review } }
            }
        case .done:
            DIPButton("Done") { dismiss() }.accessibilityIdentifier("rewards.done")
        }
    }
}
