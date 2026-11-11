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

    let description = "Example: a challenge lists its steps, its deadline and its reward before you start. You send your count, a caption and a photo; it waits for organizer approval, then 50 points are added."
    let hostFace = CrewMember.white
    var stageFill: Color { OnboardingTheme.challenge }
    let accessibilityRows = [
        DemoAccessibilityRow(systemImage: "list.number", text: "Each challenge lists what to do"),
        DemoAccessibilityRow(systemImage: "calendar", text: "It shows when it ends and the points you'll get"),
        DemoAccessibilityRow(systemImage: "square.and.arrow.up", text: "Send progress, a caption and an optional photo"),
        DemoAccessibilityRow(systemImage: "checkmark.seal", text: "Your organizer approves, then points are added"),
    ]

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
                DemoCallout(text: "How to submit", tail: .top, appearance: state.calloutAppearance)
                    .fixedSize()
                    .position(x: 195, y: 318)
            }
            if state.formShown { entryForm.transition(.scale(scale: 0.2, anchor: .bottom).combined(with: .opacity)) }
            if state.later > 0 {
                Text("Later")
                    .font(DIPReferenceAssets.font("Inter-Medium", size: 14))
                    .foregroundStyle(OnboardingTheme.ink)
                    .padding(.horizontal, 14).frame(height: 32)
                    .background(OnboardingTheme.muted, in: Capsule())
                    .opacity(state.later)
                    .position(x: 195, y: 150)
            }
            DemoMiniBar(action: state.barShowsEntry
                        ? DIPBottomBarAction(title: "Add Your Entry", identifier: "onboarding.demo.entry") : nil)
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
            category: "COFFEE WITH 3", participationText: "+ 12 others participating",
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
        .background(.white)
        .overlay(alignment: .topLeading) {
            if state.pointsEnabled {
                // F2 placeholder: the member's balance.
                Text("\(state.balance) points")
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
            id: "onboarding.coffee-with-3", title: "Coffee with 3", image: nil, timing: "Ends Friday",
            description: "Have coffee with 3 coworkers you haven’t met. Send your count, a caption and a photo if you like; your organizer approves it.",
            tags: ["Social"], completedCount: 12,
            completedAvatars: [CrewMember.purple, .yellow, .gray].map { CrewAvatarImages.reference($0) },
            goalText: "3 coffees", rewardText: "+\(ChallengeTimeline.reward) points")
    }

    // MARK: Entry form (F3 placeholder)

    private var entryForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            DemoPlaceholderTag(feature: "Challenge entries")
            HStack {
                Text("Coffees").font(DIPReferenceAssets.font("Figtree-Bold", size: 16))
                Spacer()
                Text("\(state.progress) / 3")
                    .font(DIPReferenceAssets.font("Figtree-Bold", size: 20))
                    .contentTransition(.numericText(value: Double(state.progress)))
            }
            HStack(alignment: .top, spacing: 12) {
                Text(state.captionTyped.isEmpty ? "Add a caption" : state.captionTyped)
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
            }
            ZStack {
                DIPButton("Send") {}.frame(height: 50)
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
