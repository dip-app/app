import DIPCore
import DIPDesignSystem
import SwiftUI

/// Read-only weekly-theme page, built on the event page layout (Figma 160:6357): window pill,
/// theme illustration on its accent, title, description, goal and reward, and how entries will
/// work. Submitting an entry is F3/V2, so the page shows a quiet "Submissions open soon" note
/// instead of an entry action, and the completed list stays hidden until it exists.
struct DIPChallengeDetailsScreen: View {
    let challenge: DIPChallengeDetail
    let onBack: () -> Void

    var body: some View {
        ZStack(alignment: .top) {
            Color.white
            VStack(spacing: 0) {
                DIPDetailHeader(timing: challenge.timing, widePill: true, identifierPrefix: "challenge", onBack: onBack)
                    .accessibilityElement(children: .contain)
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        hero
                        VStack(alignment: .leading, spacing: 20) {
                            VStack(alignment: .leading, spacing: 10) {
                                Text(challenge.title.uppercased())
                                    .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 40, relativeTo: .largeTitle))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .accessibilityAddTraits(.isHeader)
                                    .accessibilityIdentifier("challenge.title")
                                Text(challenge.description)
                                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                                    .lineSpacing(1.0566566)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .accessibilityIdentifier("challenge.description")
                            }
                            .padding(.top, 10)
                            facts
                            VStack(alignment: .leading, spacing: 8) {
                                Text("How it works")
                                    .font(DIPReferenceAssets.font("Figtree-Regular", size: 18, relativeTo: .headline))
                                    .accessibilityAddTraits(.isHeader)
                                Text(DIPChallengeText.howItWorks)
                                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                                    .fixedSize(horizontal: false, vertical: true)
                                    .accessibilityIdentifier("challenge.how")
                            }
                            Label(DIPChallengeText.submissionsSoon, systemImage: "clock")
                                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                                .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor.opacity(0.65))
                                .accessibilityIdentifier("challenge.submissions")
                        }
                        .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 130)
                }
                .scrollIndicators(.hidden)
            }
            .padding(.bottom, 22)
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var hero: some View {
        if let image = challenge.image {
            DIPDetailHero(image: image, tags: challenge.tags, identifierPrefix: "challenge", artworkBackground: challenge.accent.fill)
                .accessibilityHidden(true)
        } else {
            // Unknown theme: accent only, never a photo or a placeholder face.
            RoundedRectangle(cornerRadius: DIPTokens.Radius.card).fill(challenge.accent.fill)
                .frame(height: 120)
                .accessibilityHidden(true)
                .accessibilityIdentifier("challenge.hero")
        }
    }

    @ViewBuilder private var facts: some View {
        let items = [("Goal", challenge.goalText, "challenge.goal", "target"),
                     ("Reward", challenge.rewardText, "challenge.reward", "star")]
            .compactMap { item in item.1.map { (item.0, $0, item.2, item.3) } }
        if !items.isEmpty {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { ForEach(items, id: \.2) { fact($0) } }
                VStack(alignment: .leading, spacing: 10) { ForEach(items, id: \.2) { fact($0) } }
            }
        }
    }

    /// Goal and Reward are informational, so they use the shared pill in its outline (non-pressable) style.
    private func fact(_ item: (String, String, String, String)) -> some View {
        DIPActionPill(title: "\(item.0): \(item.1)", color: DIPTokens.Color.actionPrimary.swiftUIColor, style: .outline) {
            Image(systemName: item.3).resizable().scaledToFit().accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.0): \(item.1)")
        .accessibilityIdentifier(item.2)
    }
}
