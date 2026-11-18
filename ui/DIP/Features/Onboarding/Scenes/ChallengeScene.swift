import DIPCore
import DIPDesignSystem
import SwiftUI

/// B3 Challenges & Points (spec §3 B3). The timeline is `ChallengeTimeline` (DIPCore). The details band,
/// entry form and balance are placeholders until F3/F2 ship (marked "PREVIEW").
struct ChallengeScene: DemoScene {
    static let id = "challenges"

    var features: OnboardingFeatures = [.challenges]

    var script: DemoScript<ChallengeState> { ChallengeTimeline.script(features: features) }

    func applyContinuous(_ state: inout ChallengeState, at t: Duration) {
        ChallengeTimeline.continuous(&state, at: t)
    }

    var description: String {
        String(localized: "onboarding.challenges.demo.description",
               defaultValue: "Example: a challenge lists its steps, its deadline and its reward before you start. You send your count, a caption and a photo; it waits for organizer approval, then 50 points are added.",
               comment: "VoiceOver description of the challenges onboarding demo")
    }
    let hostFace = CrewMember.white
    var stageFill: Color { OnboardingTheme.challenge }
    var accessibilityRows: [DemoAccessibilityRow] {
        [
            DemoAccessibilityRow(systemImage: "list.number", text: String(localized: "onboarding.challenges.demo.row1", defaultValue: "Each challenge lists what to do", comment: "Challenges onboarding demo text row shown at accessibility text sizes")),
            DemoAccessibilityRow(systemImage: "calendar", text: String(localized: "onboarding.challenges.demo.row2", defaultValue: "It shows when it ends and the points you'll get", comment: "Challenges onboarding demo text row shown at accessibility text sizes")),
            DemoAccessibilityRow(systemImage: "square.and.arrow.up", text: String(localized: "onboarding.challenges.demo.row3", defaultValue: "Send progress, a caption and an optional photo", comment: "Challenges onboarding demo text row shown at accessibility text sizes")),
            DemoAccessibilityRow(systemImage: "checkmark.seal", text: String(localized: "onboarding.challenges.demo.row4", defaultValue: "Your organizer approves, then points are added", comment: "Challenges onboarding demo text row shown at accessibility text sizes")),
        ]
    }

    func canvas(_ state: ChallengeState) -> some View {
        ChallengeCanvas(state: state, stageFill: stageFill)
    }
}

struct ChallengeCanvas: View {
    let state: ChallengeState
    let stageFill: Color


    var body: some View {
        ZStack(alignment: .topLeading) {
            stageFill
            // The white layer grows upward behind the card; the card is revealed by the whitening.
            Color.white
                .frame(width: DemoCanvas.size.width, height: state.whiteHeight)
                .frame(width: DemoCanvas.size.width, height: DemoCanvas.size.height, alignment: .bottom)
            card
            if state.detailsOpen { challengePage.transition(.move(edge: .trailing)) }
            if state.calloutShown || state.calloutAppearance > 0 {
                DemoCallout(text: String(localized: "onboarding.challenges.demo.callout", defaultValue: "How to submit", comment: "Challenges onboarding demo callout pointing at the submit action"), tail: .top, appearance: state.calloutAppearance)
                    .fixedSize()
                    .position(x: 195, y: 318)
            }
            if state.formShown { entryForm.transition(.scale(scale: 0.2, anchor: .bottom).combined(with: .opacity)) }
            if state.later > 0 {
                Text("Later", comment: "Challenges onboarding demo chip: the challenge entry is saved for later")
                    .font(DIPReferenceAssets.font("Inter-Medium", size: 14))
                    .foregroundStyle(OnboardingTheme.ink)
                    .padding(.horizontal, 14).frame(height: 32)
                    .background(OnboardingTheme.muted, in: Capsule())
                    .opacity(state.later)
                    .position(x: 195, y: 150)
            }
            DemoMiniBar(action: state.barShowsEntry
                        ? DIPBottomBarAction(title: String(localized: "onboarding.demo.addEntry", defaultValue: "Add Your Entry", comment: "Onboarding demo bottom bar button for adding a challenge entry"), identifier: "onboarding.demo.entry") : nil)
            if let token = state.token {
                Text("+\(ChallengeTimeline.reward)")
                    .font(DIPReferenceAssets.font("Figtree-Bold", size: 18))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10).frame(height: 30)
                    .background(OnboardingTheme.accent, in: Capsule())
                    .position(token.cgPoint)
            }
            if let ghost = state.ghost { GhostTouch(ghost: GhostState(ghost)) }
        }
        .frame(width: DemoCanvas.size.width, height: DemoCanvas.size.height, alignment: .topLeading)
    }

    // MARK: Card → details band

    private var card: some View {
        DIPChallengeCard(
            category: String(localized: "onboarding.challenges.demo.category", defaultValue: "COFFEE WITH 3", comment: "Challenge card category label in the onboarding demo"),
            participationText: String(localized: "onboarding.challenges.demo.participation", defaultValue: "+ 12 others participating", comment: "Challenge card participation line in the onboarding demo"),
            accessibilityLabel: "", accent: stageFill, titleColor: .white,
            artwork: CrewMember.white.face(size: 150, mood: .happy), avatarStack: nil, onSelect: {})
            .frame(width: 350, height: 225)
            .opacity(state.contentOpacity)
            .background(stageFill, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .offset(x: 20, y: 20)
    }

    /// The app's real challenge page (`DIPChallengeDetailsScreen`, pushed like the `.challenge` route): what to
    /// do, the deadline and the reward, shown before any submit action (spec principle 5).
    private var challengePage: some View {
        DemoPhoneScreen {
            DIPChallengeDetailsScreen(challenge: Self.detail, onBack: {})
        }
        // Headroom for the balance chip: the page sits 64 pt lower so the chip and the Replay button float above the body text.
        .offset(y: 64)
        .background(.white)
        .overlay(alignment: .topLeading) {
            if state.pointsEnabled {
                // F2 placeholder: the member's balance.
                Text("\(state.balance) points", comment: "Onboarding demo points balance chip; %lld = points")
                    .font(DIPReferenceAssets.font("Inter-Medium", size: 13))
                    .foregroundStyle(.white)
                    .contentTransition(.numericText(value: Double(state.balance)))
                    .padding(.horizontal, 10).frame(height: 28)
                    .background(OnboardingTheme.accent, in: Capsule())
                    .position(x: ChallengeTimeline.Point.pointsPill.x, y: ChallengeTimeline.Point.pointsPill.y)
            }
        }
    }

    /// A fictional challenge in the app's own detail projection.
    @MainActor static var detail: DIPChallengeDetail {
        DIPChallengeDetail(
            id: "onboarding.coffee-with-3", title: String(localized: "onboarding.challenges.demo.title", defaultValue: "Coffee with 3", comment: "Challenge title in the onboarding demo"), image: nil,
            timing: String(localized: "onboarding.challenges.demo.timing", defaultValue: "Ends Friday", comment: "Challenge deadline in the onboarding demo"),
            description: String(localized: "onboarding.challenges.demo.detail", defaultValue: "Have coffee with 3 coworkers you haven’t met. Send your count, a caption and a photo if you like; your organizer approves it.", comment: "Challenge description in the onboarding demo"),
            tags: [String(localized: "onboarding.challenges.demo.tag", defaultValue: "Social", comment: "Challenge tag in the onboarding demo")], completedCount: 12,
            completedAvatars: [CrewMember.purple, .yellow, .gray].map { CrewAvatarImages.reference($0) },
            goalText: String(localized: "onboarding.challenges.demo.goal", defaultValue: "3 coffees", comment: "Challenge goal line in the onboarding demo"),
            rewardText: String(localized: "onboarding.challenges.demo.reward", defaultValue: "+\(ChallengeTimeline.reward) points", comment: "Challenge reward line in the onboarding demo; %lld = points"))
    }

    // MARK: Entry form (F3 placeholder)

    private var entryForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            DemoPlaceholderTag(feature: String(localized: "onboarding.challenges.demo.placeholder", defaultValue: "Challenge entries", comment: "Name of the not-yet-shipped feature shown in a PREVIEW tag in the onboarding demo"))
            HStack {
                Text("Coffees", comment: "Onboarding demo entry form label for the coffee count").font(DIPReferenceAssets.font("Figtree-Bold", size: 16))
                Spacer()
                Text("\(state.progress) / 3")
                    .font(DIPReferenceAssets.font("Figtree-Bold", size: 20))
                    .contentTransition(.numericText(value: Double(state.progress)))
            }
            HStack(alignment: .top, spacing: 12) {
                Text(state.captionTyped.isEmpty ? String(localized: "onboarding.challenges.demo.captionPlaceholder", defaultValue: "Add a caption", comment: "Onboarding demo entry form caption placeholder") : state.captionTyped)
                    .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                    .foregroundStyle(state.captionTyped.isEmpty ? OnboardingTheme.ink.opacity(0.4) : OnboardingTheme.ink)
                    .frame(maxWidth: .infinity, minHeight: 64, alignment: .topLeading)
                    .padding(10)
                    .background(OnboardingTheme.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
                ZStack {
                    RoundedRectangle(cornerRadius: 12).fill(OnboardingTheme.challenge)
                    if state.photoAdded {
                        DIPReferenceAssets.image("album_Rectangle931").resizable().scaledToFill()
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .transition(.scale(scale: 0.6).combined(with: .opacity))
                    } else {
                        Image(systemName: "photo.badge.plus").foregroundStyle(.white)
                    }
                }
                .frame(width: 84, height: 84)
                // The filled photo must not spill into the caption's 12 pt gap.
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            ZStack {
                DIPButton(String(localized: "onboarding.challenges.demo.send", defaultValue: "Send", comment: "Onboarding demo entry form send button")) {}.frame(height: 50)
                if let title = state.statusTitle {
                    Text(title)
                        .font(DIPReferenceAssets.font("Inter-Medium", size: 15))
                        .foregroundStyle(state.status == .approved ? .white : OnboardingTheme.ink)
                        .frame(maxWidth: .infinity).frame(height: 50)
                        .background(state.status == .approved ? OnboardingTheme.accent : OnboardingTheme.notification,
                                    in: Capsule())
                        .transition(.scale(scale: 0.6).combined(with: .opacity))
                }
            }
        }
        .foregroundStyle(OnboardingTheme.ink)
        .padding(16)
        .frame(width: 350, height: 264, alignment: .top)
        .background(.white, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(OnboardingTheme.muted, lineWidth: 2))
        .opacity(state.dimmed ? 0.8 : 1)
        .position(x: 195, y: 160 + 132)
    }
}
