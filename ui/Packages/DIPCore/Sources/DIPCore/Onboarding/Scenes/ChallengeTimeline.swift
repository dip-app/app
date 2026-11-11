import Foundation

/// B3 Challenges & Points (spec §3 B3 storyboard): one `DemoBeat` per table row.
///
/// The challenge card is revealed by a whitening layer, opens into its details (steps, deadline,
/// reward, "How to submit"), the entry form grows from the bar (an F3 placeholder), the entry waits
/// for organizer approval, and with F2 (`.points`) the +50 arcs into the balance. Without `.points`
/// the arc and balance beats are dropped, `approved` reads "Approved · +50 points" and the demo ends at 8.80.
public enum ChallengeTimeline {
    public enum Action: Equatable, Sendable {
        case mark
        case details
        case entryAction
        case callout(Bool)
        case form
        case progress(Int)
        case photo
        case status(ChallengeState.Status)
        case dim(Bool)
        case balance(Int)
    }

    public enum Element {
        public static let canvasWhite = "canvasWhite", challengeCard = "challengeCard", cardContent = "cardContent"
        public static let detailHeader = "detailHeader", reqLines = "reqLines", deadline = "deadline", reward = "reward"
        public static let callout = "callout.submit", miniBar = "miniBar", entryForm = "entryForm"
        public static let sendEntry = "sendEntry", progressValue = "progressValue", caption = "caption"
        public static let photoThumb = "photoThumb", statusPill = "statusPill", dim = "dim", laterChip = "laterChip"
        public static let pointsToken = "pointsToken", pointsPill = "pointsPill", ghost = "ghost"
    }

    public enum Point {
        public static let card = DemoCoordinate(195, 132)
        public static let bar = DemoCoordinate(195, 479)
        public static let send = DemoCoordinate(195, 383)
        /// The status pill grows from the Send button's frame.
        public static let statusPill = DemoCoordinate(195, 383)
        public static let pointsPill = DemoCoordinate(318, 44)
    }

    public static let caption = "Met Jun from Design"
    public static let startingBalance = 120
    public static let reward = 50
    public static let endWithPoints = Duration.milliseconds(9_800)
    public static let endWithoutPoints = Duration.milliseconds(8_800)

    public static func script(features: OnboardingFeatures) -> DemoScript<ChallengeState> {
        let points = features.contains(.points)
        let beats = points ? allBeats : allBeats.filter { !["b3.arc", "b3.balance"].contains($0.label) }
        let end = points ? endWithPoints : endWithoutPoints
        return DemoScript(
            initial: ChallengeState(pointsEnabled: points), duration: end, beats: beats,
            stills: [.milliseconds(3_200), .milliseconds(6_300), .milliseconds(7_380), end],
            reduce: reduce, continuous: { state, t in continuous(&state, at: t) })
    }

    static let allBeats: [DemoBeat<Action>] = {
        typealias E = Element
        func at(_ ms: Int) -> Duration { .milliseconds(ms) }
        return [
            DemoBeat(at: at(0), action: .mark, animation: OnboardingAnimation.stage,
                     moves: [E.canvasWhite], label: "b3.white"),
            DemoBeat(at: at(300), action: .mark, animation: .easeOut(duration: 0.25),
                     moves: [E.cardContent], label: "b3.content"),
            DemoBeat(at: at(950), action: .mark, animation: .easeOut(duration: 0.15),
                     moves: [E.ghost], targets: [E.challengeCard], label: "b3.ghostCard"),
            DemoBeat(at: at(1_000), action: .mark, animation: .easeInOut(duration: 0.22),
                     moves: [E.ghost], targets: [E.challengeCard], label: "b3.pressCard"),
            DemoBeat(at: at(1_150), action: .details, animation: OnboardingAnimation.expand,
                     moves: [E.challengeCard, E.detailHeader], targets: [E.challengeCard], label: "b3.details"),
            // The mini bar shows the challenge page's entry action once the details are open.
            DemoBeat(at: at(1_150), action: .entryAction, animation: OnboardingAnimation.bar,
                     moves: [E.miniBar], label: "b3.entryAction"),
            DemoBeat(at: at(1_400), action: .mark, animation: .easeOut(duration: 0.3),
                     moves: [E.reqLines], label: "b3.line1"),
            DemoBeat(at: at(1_520), action: .mark, animation: .easeOut(duration: 0.3),
                     moves: [E.reqLines], label: "b3.line2"),
            DemoBeat(at: at(1_640), action: .mark, animation: .easeOut(duration: 0.3),
                     moves: [E.reqLines], label: "b3.line3"),
            DemoBeat(at: at(1_760), action: .mark, animation: .easeOut(duration: 0.3),
                     moves: [E.deadline], label: "b3.deadline"),
            DemoBeat(at: at(1_880), action: .mark, animation: .easeOut(duration: 0.3),
                     moves: [E.reward], label: "b3.reward"),
            DemoBeat(at: at(2_200), action: .callout(true), animation: OnboardingAnimation.hop,
                     moves: [E.callout], targets: [E.reqLines, E.detailHeader], label: "b3.callout"),
            DemoBeat(at: at(3_300), action: .mark, animation: OnboardingAnimation.ghost,
                     moves: [E.ghost], targets: [E.miniBar], label: "b3.ghostBar"),
            DemoBeat(at: at(3_600), action: .callout(false), animation: .easeIn(duration: 0.15),
                     moves: [E.callout], label: "b3.calloutOut"),
            DemoBeat(at: at(3_750), action: .mark, animation: .easeInOut(duration: 0.22),
                     moves: [E.ghost], targets: [E.miniBar], label: "b3.pressBar"),
            DemoBeat(at: at(3_800), action: .form, animation: OnboardingAnimation.expand,
                     moves: [E.entryForm, E.sendEntry], targets: [E.miniBar, E.callout], label: "b3.form"),
            DemoBeat(at: at(4_720), action: .progress(1), animation: .easeOut(duration: 0.2),
                     moves: [E.progressValue], targets: [E.entryForm], label: "b3.progress1"),
            DemoBeat(at: at(4_900), action: .progress(2), animation: .easeOut(duration: 0.2),
                     moves: [E.progressValue], targets: [E.entryForm], label: "b3.progress2"),
            DemoBeat(at: at(5_080), action: .progress(3), animation: .easeOut(duration: 0.2),
                     moves: [E.progressValue], targets: [E.entryForm], label: "b3.progress3"),
            DemoBeat(at: at(5_220), action: .mark, animation: .linear(duration: 0.67),
                     moves: [E.caption], targets: [E.entryForm], label: "b3.caption"),
            DemoBeat(at: at(5_970), action: .photo, animation: OnboardingAnimation.hop,
                     moves: [E.photoThumb], targets: [E.entryForm], label: "b3.photo"),
            DemoBeat(at: at(6_400), action: .mark, animation: .easeInOut(duration: 0.22),
                     moves: [E.ghost], targets: [E.sendEntry], label: "b3.pressSend"),
            DemoBeat(at: at(6_500), action: .status(.waiting), animation: OnboardingAnimation.hop,
                     moves: [E.statusPill], targets: [E.sendEntry], label: "b3.pill"),
            DemoBeat(at: at(7_400), action: .dim(true), animation: .easeIn(duration: 0.15),
                     moves: [E.dim], targets: [E.statusPill], label: "b3.dim"),
            DemoBeat(at: at(7_400), action: .mark, animation: .easeInOut(duration: 0.6),
                     moves: [E.laterChip], label: "b3.later"),
            DemoBeat(at: at(8_000), action: .dim(false), animation: .easeOut(duration: 0.15),
                     moves: [E.dim], label: "b3.undim"),
            DemoBeat(at: at(8_100), action: .status(.approved), animation: OnboardingAnimation.bar,
                     moves: [E.statusPill], targets: [E.statusPill], label: "b3.approved"),
            DemoBeat(at: at(8_500), action: .mark, animation: .linear(duration: 0.55),
                     moves: [E.pointsToken], targets: [E.pointsPill], label: "b3.arc"),
            DemoBeat(at: at(9_100), action: .balance(startingBalance + reward), animation: .easeOut(duration: 0.4),
                     moves: [E.pointsPill], label: "b3.balance"),
        ]
    }()

    @Sendable static func reduce(_ state: inout ChallengeState, _ action: Action) {
        switch action {
        case .mark: break
        case .details: state.detailsOpen = true
        case .entryAction: state.barShowsEntry = true
        case .callout(let on): state.calloutShown = on
        case .form: state.formShown = true
        case .progress(let value): state.progress = value
        case .photo: state.photoAdded = true
        case .status(let status): state.status = status
        case .dim(let on): state.dimmed = on
        case .balance(let value): state.balance = value
        }
    }

    // MARK: Continuous parameters

    static let visits: [DemoGhostVisit] = [
        DemoGhostVisit(appearAt: 0.95, target: Point.card, pressAt: 1.00),
        DemoGhostVisit(appearAt: 3.30, from: Point.card, target: Point.bar, pressAt: 3.75),
        DemoGhostVisit(appearAt: 6.40, target: Point.send, pressAt: 6.40),
    ]

    public static func continuous(_ state: inout ChallengeState, at time: Duration) {
        let t = time.secondsValue
        state.whiteHeight = 540 * DemoProgress.monotone(OnboardingAnimation.stage, t, from: 0)
        state.contentOpacity = DemoProgress.clamped(.easeOut(duration: 0.25), t, from: 0.30)
        state.lineReveal = [1.40, 1.52, 1.64, 1.76, 1.88].map { DemoProgress.clamped(.easeOut(duration: 0.3), t, from: $0) }
        state.calloutAppearance = DemoProgress.callout(t, enter: 2.20, exit: 3.60)
        // 35 ms per grapheme cluster from 5.22 (the caption has 19 characters, so it ends at 5.885).
        let typed = t < 5.22 ? 0 : min(caption.count, Int(((t - 5.22) / 0.035).rounded(.down)) + 1)
        state.captionTyped = String(caption.prefix(typed))
        state.later = t >= 7.40 && t < 8.00 ? sin(Double.pi * DemoProgress.clamped(.easeInOut(duration: 0.6), t, from: 7.40)) : 0
        state.ghost = DemoGhost.state(at: t, visits: visits)
        state.token = state.pointsEnabled ? arcPoint(at: t) : nil
    }

    /// The "+50" token's arc (spec §3 B3 "Arc"): out (+24, −12) at 0.20 s, apex (+60, −60) at 0.35 s,
    /// the points pill centre at 0.55 s, sampled from t so it scrubs. Nil outside 8.50…9.05.
    public static func arcPoint(at t: Double) -> DemoCoordinate? {
        let elapsed = t - 8.50
        guard elapsed >= 0, elapsed < 0.55 else { return nil }
        let start = Point.statusPill
        let keys: [(Double, DemoCoordinate)] = [
            (0, start),
            (0.20, DemoCoordinate(start.x + 24, start.y - 12)),
            (0.35, DemoCoordinate(start.x + 60, start.y - 60)),
            (0.55, Point.pointsPill),
        ]
        for (index, key) in keys.enumerated().dropFirst() where elapsed <= key.0 {
            let previous = keys[index - 1]
            let u = (elapsed - previous.0) / (key.0 - previous.0)
            // Smoothstep between keyframes: continuous position, eased velocity at each key.
            return previous.1.lerp(key.1, u * u * (3 - 2 * u))
        }
        return Point.pointsPill
    }
}

public struct ChallengeState: Equatable, Sendable {
    public enum Status: Equatable, Sendable { case none, waiting, approved }

    public var pointsEnabled: Bool
    // Discrete.
    public var detailsOpen = false
    public var barShowsEntry = false
    public var calloutShown = false
    public var formShown = false
    public var progress = 0
    public var photoAdded = false
    public var status = Status.none
    public var dimmed = false
    public var balance = ChallengeTimeline.startingBalance
    // Continuous.
    public var whiteHeight = 0.0
    public var contentOpacity = 0.0
    /// Requirement lines 1–3, deadline, reward (wipe progress).
    public var lineReveal = [0.0, 0.0, 0.0, 0.0, 0.0]
    public var calloutAppearance = 0.0
    public var captionTyped = ""
    public var later = 0.0
    public var ghost: DemoGhostState?
    public var token: DemoCoordinate?

    public init(pointsEnabled: Bool) { self.pointsEnabled = pointsEnabled }

    /// The status pill's label.
    public var statusTitle: String? {
        switch status {
        case .none: nil
        case .waiting: "Waiting for approval"
        case .approved: pointsEnabled ? "Approved" : "Approved · +\(ChallengeTimeline.reward) points"
        }
    }
}
