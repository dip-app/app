import DIPCore
import DIPDesignSystem
import SwiftUI

/// B2 People & Invites (spec §3 B2): opens on B1's joined Pasta Night page, zooms into Who's Attending,
/// opens the participant list, and with F4 invites Priya, flips to her phone where she accepts, and the
/// count rolls 6 → 7. The timeline is `PeopleInviteTimeline` (DIPCore).
struct PeopleInviteScene: DemoScene {
    static let id = "people"

    var features: OnboardingFeatures = .shipping
    var you = OnboardingYou.preview

    var script: DemoScript<PeopleInviteState> { PeopleInviteTimeline.script(features: features) }

    func applyContinuous(_ state: inout PeopleInviteState, at t: Duration) {
        PeopleInviteTimeline.continuous(&state, at: t)
    }

    var description: String {
        features.contains(.invites)
            ? "Example: Who's Attending opens a list of coworkers by name and team. Theo invites Priya; on her phone she accepts and the count goes up."
            : "Example: Who's Attending opens a list of coworkers by name and team."
    }
    let hostFace = CrewMember.yellow
    var stageFill: Color { OnboardingTheme.muted }
    var accessibilityRows: [DemoAccessibilityRow] {
        var rows = [
            DemoAccessibilityRow(systemImage: "person.2", text: "See who's going before you join"),
            DemoAccessibilityRow(systemImage: "list.bullet", text: "Open the list for names and teams"),
        ]
        if features.contains(.invites) {
            rows.append(DemoAccessibilityRow(systemImage: "envelope", text: "Invite a coworker from your company"))
        }
        return rows
    }

    func prepare() { DemoPeople.prepare() }

    func canvas(_ state: PeopleInviteState) -> some View {
        PeopleInviteCanvas(state: state, you: you)
    }
}

struct PeopleInviteCanvas: View {
    let state: PeopleInviteState
    let you: OnboardingYou

    private enum Metrics {
        static let side: CGFloat = 20
        static let heroTop: CGFloat = -120
        static let width: CGFloat = 350
        static let peopleTop: CGFloat = 224
        static let actionTop: CGFloat = 316
        static let chip = CGRect(x: 95, y: 376, width: 200, height: 50)
        static let sheet = CGRect(x: 0, y: 213, width: 390, height: 327)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.white
            if state.priyaView { priyaPhone } else { organizerPhone }
            if let ghost = state.ghost { GhostTouch(ghost: GhostState(ghost)) }
        }
        .frame(width: DemoCanvas.size.width, height: DemoCanvas.size.height, alignment: .topLeading)
        .rotation3DEffect(.degrees(state.flipAngle), axis: (x: 0, y: 1, z: 0), perspective: 0.6)
    }

    // MARK: Theo's phone (the event page)

    private var organizerPhone: some View {
        ZStack(alignment: .topLeading) {
            // Owner fix (Nov 11): the page renders at the phone's true width. The spec's 1.35× zoom on Who's
            // Attending cropped the page at both sides ("ASTA NIGHT"), so `b2.zoom` no longer scales anything;
            // the beat stays in the table so the timing is unchanged.
            eventPage
            participantPanel
            DemoMiniBar(action: EventBarAction.resolve(
                route: state.panelShown ? .participants(OnboardingDemoFixtures.pastaNight.id) : .event(OnboardingDemoFixtures.pastaNight.id),
                snapshot: OnboardingDemoFixtures.pastaSnapshot(joined: true), isLoading: false))
            inviteSheet
            if state.toastShown {
                DemoToast(text: "Invite sent to Priya")
                    .position(x: 195, y: 92)
                    .transition(.scale(scale: 0.8).combined(with: .opacity))
            }
        }
        .frame(width: DemoCanvas.size.width, height: DemoCanvas.size.height, alignment: .topLeading)
    }

    private var eventPage: some View {
        ZStack(alignment: .topLeading) {
            VStack(alignment: .leading, spacing: 0) {
                DIPDetailHero(image: .asset(OnboardingDemoFixtures.pastaNight.cover), tags: [],
                              identifierPrefix: "onboarding.demo")
                    .frame(width: Metrics.width, height: 264)
                Text(OnboardingDemoFixtures.pastaNight.title.uppercased())
                    .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 40))
                    .foregroundStyle(.black)
                    .frame(height: 50, alignment: .leading)
                    .padding(.top, 10)
                DIPDetailPeopleRow(
                    title: "Who’s Attending", avatars: avatars, total: state.attendees, emptyText: "",
                    capacity: OnboardingDemoFixtures.pastaCapacity, identifierPrefix: "onboarding.demo", onMore: {})
                    .contentTransition(.numericText())
                    .padding(.top, Metrics.peopleTop - (Metrics.heroTop + 264) - 60)
                DIPDetailActionRow(
                    joinInRow: false, directionsURL: OnboardingDemoFixtures.directionsURL,
                    isParticipating: true, canChange: true, joinTitle: "Join Activity", leaveTitle: "Leave Activity",
                    shareItem: OnboardingDemoFixtures.pastaNight.title, shareTitle: "Share Event",
                    identifierPrefix: "onboarding.demo", onJoin: {}, onLeave: {})
                    .padding(.top, 20)
            }
            .frame(width: Metrics.width, alignment: .leading)
            .offset(x: Metrics.side, y: Metrics.heroTop)
            if state.invitesEnabled { inviteChip }
            if let pulse = state.pulse {
                Capsule().stroke(OnboardingTheme.accent, lineWidth: 2)
                    .frame(width: 150, height: 40)
                    .scaleEffect(1 + 0.3 * pulse)
                    .opacity(1 - pulse)
                    .position(x: 295, y: 276)
            }
        }
        .frame(width: DemoCanvas.size.width, height: DemoCanvas.size.height, alignment: .topLeading)
    }

    private var avatars: [MediaReference] {
        [CrewMember.purple, .yellow, .gray].map { CrewAvatarImages.reference($0) } + [you.photo]
    }

    /// The F4 placeholder for the invite control (spec: `DemoInviteChip`, until `InviteEntryPoint` ships).
    private var inviteChip: some View {
        Text(state.inviteSent ? "Invite sent" : "Invite a coworker")
            .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
            .foregroundStyle(state.inviteSent ? OnboardingTheme.ink : .white)
            .frame(width: Metrics.chip.width, height: Metrics.chip.height)
            .background(state.inviteSent ? Color(token: DIPTokens.Color.actionComplete) : OnboardingTheme.accent,
                        in: Capsule())
            .contentTransition(.opacity)
            .position(x: Metrics.chip.midX, y: Metrics.chip.midY)
    }

    /// "+ 2 More" pushes the app's real Participants screen, as `DIPPrototypeApp` does (`.participants` route);
    /// `b2.panelBack` pops it. The joined bar ("Activity Chat") stays, as on that route in the app.
    private var participantPanel: some View {
        let people = DemoPeople.attendees(you: you)
        return DemoPhoneScreen {
            DIPParticipantsScreen(people: people, participantCount: people.count, showsBottomBar: false,
                                  onBack: {}, onChat: {})
        }
        .background(.white)
        .shadow(color: .black.opacity(state.panelShown ? 0.12 : 0), radius: 12, x: -4)
        .offset(x: state.panelShown ? 0 : DemoCanvas.size.width + 12)
    }

    private var inviteSheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            DemoParticipantList(people: DemoPeople.coworkers) { person in
                AnyView(Image(systemName: person.id == "priya" && state.priyaChecked ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 24))
                    .foregroundStyle(person.id == "priya" && state.priyaChecked ? OnboardingTheme.accent : OnboardingTheme.ink.opacity(0.3))
                    .scaleEffect(person.id == "priya" && state.priyaChecked ? 1 : 0.9))
            }
            DIPButton("Send invite") {}
                .frame(height: 50)
        }
        .padding(16)
        .frame(width: Metrics.sheet.width, height: Metrics.sheet.height, alignment: .top)
        .background(.white, in: UnevenRoundedRectangle(topLeadingRadius: 20, topTrailingRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.14), radius: 18, y: -4)
        .scaleEffect(state.sheetShown ? 1 : 0.2,
                     anchor: UnitPoint(x: 0.5, y: (Metrics.chip.midY - Metrics.sheet.minY) / Metrics.sheet.height))
        .opacity(state.sheetShown ? 1 : 0)
        .position(x: Metrics.sheet.midX, y: Metrics.sheet.midY)
    }

    // MARK: Priya's phone

    private var priyaPhone: some View {
        ZStack(alignment: .topLeading) {
            Text("PRIYA’S VIEW")
                .font(DIPReferenceAssets.font("Inter-Medium", size: 12))
                .tracking(0.6)
                .foregroundStyle(OnboardingTheme.ink)
                .padding(.horizontal, 12).frame(height: 28)
                .background(OnboardingTheme.muted, in: Capsule())
                .position(x: 195, y: 40)
            inviteCard
                .frame(width: 350)
                .scaleEffect(state.cardCollapsed ? 0.4 : 1, anchor: .top)
                .opacity(state.cardCollapsed ? 0 : 1)
                .position(x: 195, y: 260)
            if state.cardCollapsed {
                DemoToast(text: "You’re going to Pasta Night")
                    .position(x: 195, y: 150)
                    .transition(.scale(scale: 0.8).combined(with: .opacity))
            }
            DemoMiniBar(action: nil)
        }
        .frame(width: DemoCanvas.size.width, height: DemoCanvas.size.height, alignment: .topLeading)
    }

    /// The F4 placeholder invitation card.
    private var inviteCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            DemoPlaceholderTag(feature: "Invitations")
            HStack(spacing: 12) {
                CrewMember.white.face(size: 44)
                Text("Theo invited you to Pasta Night")
                    .font(DIPReferenceAssets.font("Figtree-Bold", size: 18))
                    .foregroundStyle(.black)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Label("Thu · 6:30 PM", systemImage: "calendar")
                .font(DIPReferenceAssets.font("Inter-Regular", size: 14))
                .foregroundStyle(OnboardingTheme.ink)
            HStack(spacing: 10) {
                DIPButton("Accept") {}
                DIPButton("Decline", emphasis: .secondary) {}
            }
        }
        .padding(18)
        .background(.white, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(OnboardingTheme.muted, lineWidth: 2))
    }
}
