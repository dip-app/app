import CoreGraphics
import DIPDesignSystem

// The sign-in states A0–A4 are one composition: one Stage, one Crew, one Bar whose parameters
// change per route. This file is the pure mapping (route → scene); `AccountsStageView` renders it.

/// How A0 (`authenticationPending`) looks depends on how it was entered.
enum PendingLook: Equatable, Sendable {
    /// First launch: the Stage alone, the Bar waiting.
    case cold
    /// From A4 "Try again" (`restart`): the A2 search look, so A0 → A2 is one continuous search.
    case retry
    /// On the way back to Welcome after signing out: the Welcome group, copy gone.
    case signingOut
}

/// The Stage's colour story (spec §4.3). No notice shares pink with A2.
enum StageTone: Equatable, Sendable {
    case welcome, blocked, notFound, offline, problem

    var fill: StageColor {
        switch self {
        case .welcome: .challenge
        case .blocked, .problem: .accent
        case .notFound: .notification
        case .offline: .muted
        }
    }

    init(_ tone: AccountsNotice.Tone) {
        switch tone {
        case .blocked: self = .blocked
        case .notFound: self = .notFound
        case .offline: self = .offline
        case .problem: self = .problem
        }
    }
}

/// Where one Crew member stands on the Stage. `x` is from the Stage's horizontal centre, `y` from
/// its top edge, both in points. Hidden members shrink into the Stage colour where they stand.
struct CrewSlot: Equatable, Sendable {
    var member: CrewMember
    var fill: StageColor
    var size: CGFloat
    var x: CGFloat
    var y: CGFloat
    var opacity: Double = 1
    var isShown: Bool = true
    var rig: FaceRig
    var zIndex: Double = 0
}

/// One pose of the whole Crew. Always four slots in `CrewMember` order, so SwiftUI keeps each
/// face's identity and animates between formations instead of replacing faces.
struct CrewFormation: Equatable, Sendable {
    var slots: [CrewSlot]
    /// Offline: a dashed 2 pt line links the two small faces through the centre face.
    var showsLink: Bool = false

    subscript(_ member: CrewMember) -> CrewSlot { slots[member.rawValue] }

    static let stageHeight: CGFloat = 225
    static let groupSize: CGFloat = 88
    static let groupY: CGFloat = 136          // y 196 on screen with the Stage at y 60
    static let groupOverlap: CGFloat = 19
    static let leadSize: CGFloat = 120
    static let leadY: CGFloat = 112           // y 172 on screen
    static let stepBack: CGFloat = 28
    static let sideSize: CGFloat = 64
    static let sideX: CGFloat = 141
    static let dimmed = 0.35

    /// Centre x of each member in the overlapping welcome group.
    static func groupX(_ member: CrewMember) -> CGFloat {
        let step = groupSize - groupOverlap
        return (CGFloat(member.rawValue) - 1.5) * step
    }

    private static func group(shown: Bool) -> [CrewSlot] {
        CrewMember.allCases.map { member in
            CrewSlot(member: member, fill: member.fill, size: groupSize, x: groupX(member), y: groupY,
                     isShown: shown, rig: member.welcomeRig, zIndex: Double(CrewMember.allCases.count - member.rawValue))
        }
    }

    /// A1 Welcome, A0 after sign-out, and A2's resting pose.
    static let welcome = CrewFormation(slots: group(shown: true))
    /// A0 cold launch: nobody yet; they grow out of the Stage colour on Welcome.
    static let empty = CrewFormation(slots: group(shown: false))
    /// A2 and the A0 retry look: the welcome group, everyone calm-happy and searching.
    static let looking: CrewFormation = {
        var slots = group(shown: true)
        slots[CrewMember.yellow.rawValue].rig = .happy
        return CrewFormation(slots: slots)
    }()

    /// Blocked: the yellow square face steps forward, worried; the others step back and fade.
    static let blocked: CrewFormation = {
        var slots = group(shown: true)
        for index in slots.indices {
            let member = slots[index].member
            if member == .yellow {
                slots[index] = CrewSlot(member: member, fill: .notification, size: leadSize, x: 0, y: leadY,
                                        rig: .worried, zIndex: 10)
            } else {
                let outward: CGFloat = slots[index].x < 0 ? -stepBack : stepBack
                slots[index].x += outward
                slots[index].y = leadY
                slots[index].opacity = dimmed
                slots[index].rig = .calm
                slots[index].zIndex = Double(member.rawValue)
            }
        }
        return CrewFormation(slots: slots)
    }()

    /// Not found: a purple pill face alone, calm.
    static let notFound: CrewFormation = solo(.white, fill: .accent, rig: .calm)

    /// Problem: a pink round face alone, worried (the face the notice screen drew before).
    static let problem: CrewFormation = solo(.purple, fill: .challenge, rig: .worried)

    /// Offline: a white round face, with gray and purple faces at the sides linked by a line.
    static let offline: CrewFormation = {
        var slots = group(shown: false)
        slots[CrewMember.white.rawValue] = CrewSlot(member: .white, fill: .inverse, size: leadSize, x: 0, y: leadY,
                                                    rig: .calm, zIndex: 10)
        slots[CrewMember.gray.rawValue] = CrewSlot(member: .gray, fill: .muted, size: sideSize, x: -sideX, y: leadY,
                                                   opacity: dimmed, rig: .calm, zIndex: 1)
        slots[CrewMember.purple.rawValue] = CrewSlot(member: .purple, fill: .accent, size: sideSize, x: sideX, y: leadY,
                                                     opacity: dimmed, rig: .happy, zIndex: 1)
        return CrewFormation(slots: slots, showsLink: true)
    }()

    private static func solo(_ lead: CrewMember, fill: StageColor, rig: FaceRig) -> CrewFormation {
        var slots = group(shown: false)
        slots[lead.rawValue] = CrewSlot(member: lead, fill: fill, size: leadSize, x: 0, y: leadY, rig: rig, zIndex: 10)
        return CrewFormation(slots: slots)
    }

    static func notice(_ tone: StageTone) -> CrewFormation {
        switch tone {
        case .welcome: .welcome
        case .blocked: .blocked
        case .notFound: .notFound
        case .offline: .offline
        case .problem: .problem
        }
    }
}

/// Text below the Stage. Its `key` decides when copy leaves and a new entrance plays.
enum StageCopy: Equatable, Sendable {
    case welcome(dimmed: Bool)
    case notice(title: String, message: String)

    static let welcomeTitle = "Meet your team outside work"
    static let welcomeBody = "Board games, cooking nights, hikes and more. See which coworkers are going and join in one tap."

    var title: String {
        switch self {
        case .welcome: Self.welcomeTitle
        case .notice(let title, _): title
        }
    }

    var body: String {
        switch self {
        case .welcome: Self.welcomeBody
        case .notice(_, let message): message
        }
    }

    /// Welcome copy stays across A1 ↔ A2 (only the body dims); every notice is its own entrance.
    var key: String {
        switch self {
        case .welcome: "welcome"
        case .notice(let title, let message): "notice:\(title):\(message)"
        }
    }

    var isDimmed: Bool { if case .welcome(true) = self { true } else { false } }

    /// Welcome copy rises from behind the Stage edge; notice copy drops out of it.
    var entrance: Entrance { if case .notice = self { .drop } else { .rise } }

    enum Entrance: Equatable, Sendable {
        case rise, drop
        /// Starting offset under the Stage-edge clip.
        var offset: CGFloat { self == .rise ? -36 : -24 }
        /// Title delay after the state arrives, and the extra delay for the body.
        var titleDelay: Double { self == .rise ? 0 : 0.32 }
        var bodyDelay: Double { self == .rise ? 0.09 : 0.12 }
    }
}

/// What the activity pill on the Stage shows.
enum StagePill: Equatable, Sendable {
    /// A1: the activity reel.
    case reel
    /// A2 and the A0 retry look.
    case looking

    static let lookingText = "Looking for your team…"
    /// Localizable reel, in order. The reel rests on the first entry.
    static let entries = ["Board game lunch", "Pasta night", "Trivia after work", "Sunset hike", "Coffee walk"]
    static let reelInterval = 2.4
    static let reducedReelInterval = 4.0
    static let reelCycles = 3
}

/// What tapping the Bar or the secondary text action does.
enum StageIntent: Equatable, Sendable {
    case none
    case signIn
    case notice(AccountsNotice.Action)
}

/// One sign-in state as the Stage, Crew, copy and Bar should show it.
struct AccountsStageScene: Equatable {
    var tone: StageTone
    var formation: CrewFormation
    var pill: StagePill?
    var copy: StageCopy?
    var footnote: String?
    var bar: DIPBottomBarAction
    var barIntent: StageIntent
    var barEnabled: Bool
    var secondary: (title: String, intent: StageIntent)?
    var secondaryEnabled: Bool
    /// Crew look around (gaze loop) while the company resolves.
    var isSearching: Bool
    var notice: AccountsNotice?

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.tone == rhs.tone && lhs.formation == rhs.formation && lhs.pill == rhs.pill && lhs.copy == rhs.copy
            && lhs.footnote == rhs.footnote && lhs.bar == rhs.bar && lhs.barIntent == rhs.barIntent
            && lhs.barEnabled == rhs.barEnabled && lhs.secondary?.title == rhs.secondary?.title
            && lhs.secondary?.intent == rhs.secondary?.intent && lhs.secondaryEnabled == rhs.secondaryEnabled
            && lhs.isSearching == rhs.isSearching && lhs.notice == rhs.notice
    }

    static let footnoteText = "Use your work Google account. We find your company from your email."
    static let pendingTitle = "Just a moment…"
    static let resolvingTitle = "Finding your company…"
    static let signInTitle = "Continue with Google"
    static let connectingTitle = "Connecting…"
    static let inProgress = "In progress"
    /// Spoken when A2 begins.
    static let resolvingAnnouncement = "Finding your company"

    private static func progressBar(_ title: String) -> DIPBottomBarAction {
        DIPBottomBarAction(title: title, identifier: "onboarding.progress", value: inProgress, showsProgress: true)
    }

    /// `nil` for a member: the member content replaces the Stage.
    static func make(route: AccountsRoute, isSubmitting: Bool = false, pendingLook: PendingLook = .cold) -> Self? {
        switch route {
        case .member:
            return nil
        case .pending:
            let searching = pendingLook == .retry
            let formation: CrewFormation = switch pendingLook {
            case .cold: .empty
            case .retry: .looking
            case .signingOut: .welcome
            }
            return Self(
                tone: .welcome,
                formation: formation,
                pill: searching ? .looking : nil,
                copy: searching ? .welcome(dimmed: true) : nil,
                footnote: pendingLook == .cold ? nil : footnoteText,
                bar: progressBar(pendingTitle), barIntent: .none, barEnabled: false,
                secondary: nil, secondaryEnabled: false, isSearching: searching, notice: nil)
        case .welcome:
            return Self(
                tone: .welcome, formation: .welcome, pill: .reel, copy: .welcome(dimmed: false), footnote: footnoteText,
                bar: DIPBottomBarAction(
                    title: isSubmitting ? connectingTitle : signInTitle, identifier: "onboarding.google",
                    value: isSubmitting ? inProgress : nil),
                barIntent: .signIn, barEnabled: !isSubmitting,
                secondary: nil, secondaryEnabled: false, isSearching: false, notice: nil)
        case .resolving:
            return Self(
                tone: .welcome, formation: .looking, pill: .looking, copy: .welcome(dimmed: true), footnote: footnoteText,
                bar: progressBar(resolvingTitle), barIntent: .none, barEnabled: false,
                secondary: nil, secondaryEnabled: false, isSearching: true, notice: nil)
        case .noCompany(let reason):
            return notice(.noCompany(reason), isSubmitting: isSubmitting)
        case .problem(let failure):
            return notice(.problem(failure), isSubmitting: isSubmitting)
        }
    }

    private static func notice(_ notice: AccountsNotice, isSubmitting: Bool) -> Self {
        let tone = StageTone(notice.tone)
        return Self(
            tone: tone, formation: .notice(tone), pill: nil,
            copy: .notice(title: notice.title, message: notice.message), footnote: nil,
            bar: DIPBottomBarAction(
                title: notice.primary.title, identifier: "onboarding.primary",
                value: isSubmitting ? inProgress : nil, showsProgress: isSubmitting),
            barIntent: .notice(notice.primary.action), barEnabled: !isSubmitting,
            secondary: notice.secondary.map { ($0.title, .notice($0.action)) }, secondaryEnabled: !isSubmitting,
            isSearching: false, notice: notice)
    }

    /// Blocked arrivals warn once (`.warning`); a repeat of the same notice replays silently.
    static func warnsOnArrival(_ scene: Self, previousNotice: AccountsNotice?) -> Bool {
        scene.tone == .blocked && scene.notice != nil && scene.notice != previousNotice
    }
}

extension PendingLook {
    /// The A0 look that follows a user action taken on a notice.
    init(after action: AccountsNotice.Action) {
        switch action {
        case .restart: self = .retry
        case .signOut: self = .signingOut
        case .retryMembership: self = .retry
        }
    }
}
