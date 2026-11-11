import Foundation

/// B2 People & Invites (spec §3 B2 storyboard): one `DemoBeat` per table row.
///
/// The canvas opens on B1's joined event page. "+ 2 More" opens the participant panel; with F4
/// (`.invites`) the ghost invites Priya, the canvas flips to her phone where she accepts, and the
/// count rolls 6 → 7. Without F4 the rows from `b2.ghostChip` onward are dropped and the demo ends at 3.30.
public enum PeopleInviteTimeline {
    public enum Action: Equatable, Sendable {
        case mark
        case zoom(Bool)
        case panel(Bool)
        case sheet(Bool)
        case checkPriya
        case inviteSent
        case toast(Bool)
        case priyaView(Bool)
        case collapseCard
        case countAccepted
    }

    /// Element names from the spec table; `moves` / `targets` feed `validate()`.
    public enum Element {
        public static let canvasZoom = "canvasZoom", peopleRow = "peopleRow", moreCapsule = "moreCapsule"
        public static let participantPanel = "participantPanel", inviteChip = "inviteChip"
        public static let inviteSheet = "inviteSheet", priyaRow = "sheetRow.priya", priyaCheck = "priyaCheck"
        public static let sendInvite = "sendInvite", toast = "toast", canvasFlip = "canvasFlip"
        public static let inviteCard = "inviteCard", acceptButton = "acceptButton", capacityText = "capacityText"
        public static let pulseRing = "pulseRing", ghost = "ghost"
    }

    /// Canvas points the ghost aims at (390 × 540; the page sits 40 pt higher than in B1 so the invite
    /// chip fits above the mini bar).
    public enum Point {
        public static let moreCapsule = DemoCoordinate(295, 276)
        public static let inviteChip = DemoCoordinate(195, 401)
        public static let priyaRow = DemoCoordinate(195, 266)
        public static let sendInvite = DemoCoordinate(195, 499)
        public static let accept = DemoCoordinate(107, 355)
    }

    public static let endWithInvites = Duration.milliseconds(10_200)
    public static let endWithoutInvites = Duration.milliseconds(3_300)

    public static func script(features: OnboardingFeatures) -> DemoScript<PeopleInviteState> {
        let invites = features.contains(.invites)
        let beats = invites ? allBeats : allBeats.filter { $0.at < .milliseconds(3_250) }
        let stills: [Duration] = invites
            ? [.milliseconds(960), .milliseconds(2_100), .milliseconds(6_000), .milliseconds(7_500), endWithInvites]
            : [.milliseconds(960), .milliseconds(2_100), endWithoutInvites]
        return DemoScript(
            initial: PeopleInviteState(invitesEnabled: invites),
            duration: invites ? endWithInvites : endWithoutInvites,
            beats: beats, stills: stills, reduce: reduce,
            continuous: { state, t in continuous(&state, at: t) })
    }

    static let allBeats: [DemoBeat<Action>] = {
        typealias E = Element
        let zoomMoves: Set<String> = [E.canvasZoom, E.peopleRow, E.moreCapsule, E.inviteChip]
        let sheetMoves: Set<String> = [E.inviteSheet, E.priyaRow, E.sendInvite]
        func at(_ ms: Int) -> Duration { .milliseconds(ms) }
        return [
            DemoBeat(at: at(0), action: .zoom(true), animation: OnboardingAnimation.stage,
                     moves: zoomMoves, targets: [E.peopleRow], label: "b2.zoom"),
            DemoBeat(at: at(960), action: .mark, animation: .easeOut(duration: 0.15),
                     moves: [E.ghost], targets: [E.moreCapsule], label: "b2.ghostMore"),
            DemoBeat(at: at(1_000), action: .mark, animation: .easeInOut(duration: 0.22),
                     moves: [E.ghost], targets: [E.moreCapsule], label: "b2.pressMore"),
            DemoBeat(at: at(1_150), action: .panel(true), animation: OnboardingAnimation.expand,
                     moves: [E.participantPanel], targets: [E.moreCapsule], label: "b2.panel"),
            DemoBeat(at: at(1_150), action: .zoom(false), animation: OnboardingAnimation.stage,
                     moves: zoomMoves, label: "b2.unzoom"),
            DemoBeat(at: at(2_700), action: .panel(false), animation: .easeIn(duration: 0.5),
                     moves: [E.participantPanel], targets: [E.moreCapsule], label: "b2.panelBack"),
            // F4 only from here.
            DemoBeat(at: at(3_250), action: .mark, animation: OnboardingAnimation.ghost,
                     moves: [E.ghost], targets: [E.inviteChip], label: "b2.ghostChip"),
            DemoBeat(at: at(3_700), action: .mark, animation: .easeInOut(duration: 0.22),
                     moves: [E.ghost], targets: [E.inviteChip], label: "b2.pressChip"),
            DemoBeat(at: at(3_800), action: .sheet(true), animation: OnboardingAnimation.stage,
                     moves: sheetMoves, targets: [E.inviteChip], label: "b2.sheet"),
            DemoBeat(at: at(4_800), action: .mark, animation: .easeInOut(duration: 0.22),
                     moves: [E.ghost], targets: [E.priyaRow], label: "b2.pressPriya"),
            DemoBeat(at: at(4_950), action: .checkPriya, animation: OnboardingAnimation.hop,
                     moves: [E.priyaCheck], targets: [E.priyaRow], label: "b2.check"),
            DemoBeat(at: at(5_300), action: .mark, animation: .easeInOut(duration: 0.22),
                     moves: [E.ghost], targets: [E.sendInvite], label: "b2.pressSend"),
            DemoBeat(at: at(5_550), action: .sheet(false), animation: OnboardingAnimation.stage,
                     moves: sheetMoves, targets: [E.inviteChip], label: "b2.sheetClose"),
            DemoBeat(at: at(5_550), action: .inviteSent, animation: OnboardingAnimation.bar,
                     moves: [E.inviteChip], label: "b2.chipSent"),
            DemoBeat(at: at(5_750), action: .toast(true), animation: OnboardingAnimation.hop,
                     moves: [E.toast], label: "b2.toast"),
            DemoBeat(at: at(6_750), action: .toast(false), animation: .easeIn(duration: 0.15),
                     moves: [E.toast], label: "b2.toastOut"),
            DemoBeat(at: at(6_900), action: .mark, animation: .easeIn(duration: 0.26),
                     moves: [E.canvasFlip], label: "b2.flipOut"),
            DemoBeat(at: at(7_160), action: .priyaView(true), animation: .easeOut(duration: 0.30),
                     moves: [E.canvasFlip, E.inviteCard, E.acceptButton], label: "b2.flipIn"),
            DemoBeat(at: at(7_500), action: .mark, animation: .easeInOut(duration: 0.22),
                     moves: [E.ghost], targets: [E.acceptButton], label: "b2.pressAccept"),
            DemoBeat(at: at(7_800), action: .collapseCard, animation: OnboardingAnimation.stage,
                     moves: [E.inviteCard], label: "b2.cardCollapse"),
            DemoBeat(at: at(8_800), action: .mark, animation: .easeIn(duration: 0.26),
                     moves: [E.canvasFlip], targets: [E.inviteCard], label: "b2.flipBackOut"),
            DemoBeat(at: at(9_060), action: .priyaView(false), animation: .easeOut(duration: 0.30),
                     moves: [E.canvasFlip], label: "b2.flipBackIn"),
            DemoBeat(at: at(9_400), action: .countAccepted, animation: OnboardingAnimation.bar,
                     moves: [E.capacityText, E.moreCapsule], label: "b2.counts"),
            DemoBeat(at: at(9_400), action: .mark, animation: .linear(duration: 0.5),
                     moves: [E.pulseRing], label: "b2.pulse"),
        ]
    }()

    @Sendable static func reduce(_ state: inout PeopleInviteState, _ action: Action) {
        switch action {
        case .mark: break
        case .zoom(let on): state.zoomed = on
        case .panel(let on): state.panelShown = on
        case .sheet(let on): state.sheetShown = on
        case .checkPriya: state.priyaChecked = true
        case .inviteSent: state.inviteSent = true
        case .toast(let on): state.toastShown = on
        case .priyaView(let on): state.priyaView = on
        case .collapseCard: state.cardCollapsed = true
        case .countAccepted: state.attendees = 7
        }
    }

    // MARK: Continuous parameters

    static let visits: [DemoGhostVisit] = [
        DemoGhostVisit(appearAt: 0.96, target: Point.moreCapsule, pressAt: 1.00),
        DemoGhostVisit(appearAt: 3.25, from: Point.moreCapsule, target: Point.inviteChip, pressAt: 3.70),
        DemoGhostVisit(appearAt: 4.80, target: Point.priyaRow, pressAt: 4.80),
        DemoGhostVisit(appearAt: 5.30, target: Point.sendInvite, pressAt: 5.30),
        DemoGhostVisit(appearAt: 7.50, target: Point.accept, pressAt: 7.50),
    ]

    public static func continuous(_ state: inout PeopleInviteState, at time: Duration) {
        let t = time.secondsValue
        state.ghost = DemoGhost.state(at: t, visits: state.invitesEnabled ? visits : Array(visits.prefix(1)))
        guard state.invitesEnabled else { state.flipAngle = 0; state.pulse = nil; return }
        state.flipAngle = flipAngle(at: t)
        let sincePulse = t - 9.40
        state.pulse = sincePulse >= 0 && sincePulse < 0.5 ? sincePulse / 0.5 : nil
    }

    /// The canvas's `rotation3DEffect` angle in degrees: 0 → 90 (easeIn 0.26), swap, −90 → 0 (easeOut 0.30), twice.
    public static func flipAngle(at t: Double) -> Double {
        func half(_ start: Double, out: Bool) -> Double? {
            let duration = out ? 0.26 : 0.30
            guard t >= start, t < start + duration else { return nil }
            let p = DemoProgress.clamped(out ? .easeIn(duration: duration) : .easeOut(duration: duration), t, from: start)
            return out ? 90 * p : -90 * (1 - p)
        }
        return half(6.90, out: true) ?? half(7.16, out: false) ?? half(8.80, out: true) ?? half(9.06, out: false) ?? 0
    }
}

public struct PeopleInviteState: Equatable, Sendable {
    public var invitesEnabled: Bool
    // Discrete (beats).
    public var zoomed = false
    public var panelShown = false
    public var sheetShown = false
    public var priyaChecked = false
    public var inviteSent = false
    public var toastShown = false
    public var priyaView = false
    public var cardCollapsed = false
    /// Who's Attending total: 6 after B1's join, 7 once Priya accepts.
    public var attendees = 6
    // Continuous.
    public var flipAngle = 0.0
    public var ghost: DemoGhostState?
    public var pulse: Double?

    public init(invitesEnabled: Bool) { self.invitesEnabled = invitesEnabled }

    /// "+ n More" next to the four avatars.
    public var moreCount: Int { max(0, attendees - 4) }
}
