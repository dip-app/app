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
    /// Injected so previews and tests control "now" (phase and calendar eligibility depend on it).
    var now: Date = Date()
    @Environment(\.eventCalendarAdder) private var calendarAdder
    @State private var calendarResult: DIPCalendarAddResult?

    var body: some View {
        ZStack(alignment: .top) {
            Color.white
            VStack(spacing: 0) {
                DIPDetailHeader(
                    timing: challenge.timing, widePill: true, identifierPrefix: "challenge", onBack: onBack,
                    // Pressable (solid) only while the window can still be added; otherwise the informational outline pill.
                    calendarLabel: challenge.canAddToCalendar(now: now) ? challenge.timing : nil,
                    calendarAdded: calendarResult == .added,
                    onCalendar: {
                        guard let fields = challenge.calendarFields() else { return }
                        Task { calendarResult = await calendarAdder.add(fields) }
                    },
                    showsCalendarIcon: challenge.startDate != nil)
                    .accessibilityElement(children: .contain)
                    .alert("Couldn’t add to calendar", isPresented: Binding(
                        get: { if case .failed = calendarResult { return true } else { return false } },
                        set: { if !$0 { calendarResult = nil } })) {
                        Button("OK", role: .cancel) {}
                    } message: {
                        if case .failed(let message) = calendarResult { Text(message) }
                    }
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
                            infoCard
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

    /// Same tinted card as the event page: how entries work and where the theme stands right now.
    private var infoCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "info.circle").foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
                    .frame(width: 24).padding(.top, 2).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text("How it works").font(DIPReferenceAssets.font("Figtree-Bold", size: 16, relativeTo: .headline))
                        .accessibilityAddTraits(.isHeader)
                    Text(DIPChallengeText.howItWorks)
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("challenge.how")
                }
            }
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "clock").foregroundStyle(DIPTokens.Color.actionPrimary.swiftUIColor)
                    .frame(width: 24).accessibilityHidden(true)
                Text(challenge.statusNote(now: now))
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14, relativeTo: .body))
                    .foregroundStyle(DIPTokens.Color.textPrimary.swiftUIColor)
                    .accessibilityIdentifier("challenge.submissions")
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DIPTokens.Color.actionPrimary.swiftUIColor.opacity(0.07), in: RoundedRectangle(cornerRadius: 20))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("challenge.info")
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
                     ("Reward", challenge.rewardText, "challenge.reward", "gift")]
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
        // Icon on the left and only the value as text; VoiceOver still hears "Goal: 3 workouts".
        DIPActionPill(title: item.1, color: DIPTokens.Color.actionPrimary.swiftUIColor, style: .outline, iconLeading: true) {
            Group {
                if item.3 == "gift" {
                    DIPReferenceAssets.image("HeroiconsOutlineGift").renderingMode(.template).resizable().scaledToFit()
                } else {
                    Image(systemName: item.3).resizable().scaledToFit()
                }
            }
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.0): \(item.1)")
        .accessibilityIdentifier(item.2)
    }
}
