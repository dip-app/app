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

    private static let lines = [
        "Have coffee with 3 coworkers you haven’t met",
        "Send your count, a caption and a photo if you like",
        "Your organizer approves it",
    ]

    var body: some View {
        ZStack(alignment: .topLeading) {
            stageFill
            // The white layer grows upward behind the card; the card is revealed by the whitening.
            Color.white
                .frame(width: DemoCanvas.size.width, height: state.whiteHeight)
                .frame(width: DemoCanvas.size.width, height: DemoCanvas.size.height, alignment: .bottom)
            card
            requirements
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
        .clipped()
    }

    // MARK: Card → details band

    private var card: some View {
        ZStack(alignment: .topLeading) {
            if state.detailsOpen {
                detailsBand.transition(.opacity)
            } else {
                DIPChallengeCard(
                    category: "COFFEE WITH 3", participationText: "+ 12 others participating",
                    accessibilityLabel: "", accent: stageFill, titleColor: .white,
                    artwork: CrewMember.white.face(size: 150, mood: .happy), avatarStack: nil, onSelect: {})
                    .frame(width: 350, height: 225)
                    .opacity(state.contentOpacity)
                    .transition(.opacity)
            }
        }
        .frame(width: 350, height: state.detailsOpen ? 140 : 225, alignment: .topLeading)
        .background(stageFill, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .offset(x: 20, y: 20)
    }

    private var detailsBand: some View {
        ZStack(alignment: .topLeading) {
            CrewMember.white.face(size: 96).offset(x: 236, y: 34)
            VStack(alignment: .leading, spacing: 6) {
                DemoPlaceholderTag(feature: "Challenges").foregroundStyle(.white)
                Text("COFFEE WITH 3")
                    .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 34))
                    .foregroundStyle(.white)
            }
            .padding(.leading, 18).padding(.top, 50)
            if state.pointsEnabled {
                Text("\(state.balance) points")
                    .font(DIPReferenceAssets.font("Inter-Medium", size: 13))
                    .foregroundStyle(OnboardingTheme.ink)
                    .contentTransition(.numericText(value: Double(state.balance)))
                    .padding(.horizontal, 10).frame(height: 28)
                    .background(.white, in: Capsule())
                    .position(x: ChallengeTimeline.Point.pointsPill.x - 20, y: ChallengeTimeline.Point.pointsPill.y - 20)
            }
        }
        .frame(width: 350, height: 140, alignment: .topLeading)
    }

    // MARK: Requirements, deadline, reward

    private var requirements: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(Self.lines.enumerated()), id: \.offset) { index, line in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("\(index + 1)")
                        .font(DIPReferenceAssets.font("Figtree-Bold", size: 15))
                        .frame(width: 22, height: 22)
                        .background(OnboardingTheme.muted, in: Circle())
                    Text(line)
                        .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                        .lineLimit(1).minimumScaleFactor(0.8)
                }
                .demoWipe(state.lineReveal[index])
            }
            HStack(spacing: 16) {
                Label("Ends Friday", systemImage: "calendar").demoWipe(state.lineReveal[3])
                Label("+\(ChallengeTimeline.reward) points", systemImage: "star.fill").demoWipe(state.lineReveal[4])
            }
            .font(DIPReferenceAssets.font("Inter-Medium", size: 14))
            .padding(.top, 4)
        }
        .foregroundStyle(OnboardingTheme.ink)
        .frame(width: 350, alignment: .leading)
        .offset(x: 20, y: 176)
        .opacity(state.detailsOpen ? 1 : 0)
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
