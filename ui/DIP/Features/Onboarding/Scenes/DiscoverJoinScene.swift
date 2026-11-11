import DIPCore
import DIPDesignSystem
import SwiftUI

/// B1 Discover & Join (spec v3 §3 B1): a feed of company events develops out of the Stage colour, the
/// ghost opens Pasta Night, taps the bar's one Join action, and the page shows you've joined.
///
/// Built from the shipping components (`DIPPhotoEventCard`, `DIPDetailHero`, `DIPDetailPeopleRow`,
/// `DIPDetailActionRow(joinInRow: false)`, `DIPFloatingNavigation`) with fixture values and no-op closures.
/// The joined bar comes from `EventBarAction.forEvent`, the same resolver the app shell uses.
struct DiscoverJoinScene: DemoScene {
    static let id = "discover"

    /// Initials or name for the "You" avatar that joins the people row.
    var you = OnboardingYou.preview

    var script: DemoScript<DiscoverJoinState> { DiscoverJoinTimeline.script }

    func applyContinuous(_ state: inout DiscoverJoinState, at t: Duration) {
        DiscoverJoinTimeline.continuous(&state, at: t)
    }

    let description = "Example: a feed of company events, from board games to a hike. Opening Pasta Night and tapping Join the Activity once adds you to Who's Attending, and the bar changes to show you've joined."
    let hostFace = CrewMember.purple
    var stageFill: Color { OnboardingTheme.accent }
    let accessibilityRows = [
        DemoAccessibilityRow(systemImage: "calendar", text: "Browse company events"),
        DemoAccessibilityRow(systemImage: "hand.tap", text: "Join with one tap"),
        DemoAccessibilityRow(systemImage: "checkmark.circle", text: "Joined events appear in My Events"),
    ]

    func prepare() {
        for member in CrewMember.allCases {
            _ = CrewAvatarImages.reference(member)
            _ = CrewAvatarImages.reference(member, size: 22)
        }
    }

    func canvas(_ state: DiscoverJoinState) -> some View {
        DiscoverJoinCanvas(state: state, you: you, stageFill: stageFill)
    }
}

/// B1's timeline (spec v3 B1 storyboard), kept apart from the view so it is pure and `Sendable`.
enum DiscoverJoinTimeline {
    static let script = DemoScript(
        initial: DiscoverJoinState(), duration: Timing.end, beats: beats,
        stills: [Timing.browse, Timing.eventStill, Timing.end],
        reduce: reduce, continuous: { state, t in continuous(&state, at: t) })


    enum Timing {
        static let develop = Duration.zero
        static let cardStagger = 0.05
        /// The fifth card starts its scale 4 × 50 ms after the first.
        static let lastCard = Duration.milliseconds(200)
        static let browse = Duration.milliseconds(1_100)
        static let browseOut = 0.9
        static let browseBack = 0.6
        static let choose = Duration.milliseconds(2_600)
        static let choosePress = Duration.milliseconds(2_800)
        static let eventPage = Duration.milliseconds(2_900)
        static let rowStagger = 0.06
        static let lastRow = Duration.milliseconds(3_020)
        /// Spec v3: 2.90 + `expand` settle 0.85 = 3.75, with headroom.
        static let tapJoin = Duration.milliseconds(3_800)
        static let joinPress = Duration.milliseconds(4_250)
        static let joined = Duration.milliseconds(4_300)
        static let ringDuration = 0.5
        static let callout = Duration.milliseconds(4_600)
        static let end = Duration.milliseconds(6_400)
        /// The event page at rest before the second ghost appears (hero 3.75, rows 3.87).
        static let eventStill = Duration.milliseconds(3_790)
    }

    enum Action: Equatable, Sendable {
        /// Beats whose motion is continuous (mask, scale, offsets, ghost) only mark the timeline.
        case mark
        case openEvent
        case showJoinAction
        case join
        case showCallout
    }

    /// Element names from the spec table; `moves` / `targets` feed `script.validate()`.
    enum Element {
        static let canvasMask = "canvasMask", feedCards = "feedCards", feedRow = "feedRow"
        static let pastaCard = "card.pasta", hero = "hero", eventTitle = "eventTitle"
        static let peopleRow = "peopleRow", actionRow = "actionRow", actionSlot = "actionRow.slot"
        static let miniBar = "miniBar", barIcon = "barIcon", avatar4 = "avatar4", joinRing = "joinRing"
        static let capacityText = "capacityText", callout = "callout", ghost = "ghost"
    }

    static let beats: [DemoBeat<Action>] = {
        typealias E = Element
        return [
            DemoBeat(at: Timing.develop, action: .mark, animation: OnboardingAnimation.stage,
                     moves: [E.canvasMask], label: "develop"),
            // Staggered move: listed at its last element's start, as the v3 timing rule requires.
            DemoBeat(at: Timing.lastCard, action: .mark, animation: OnboardingAnimation.expand,
                     moves: [E.feedCards], label: "develop cards"),
            DemoBeat(at: Timing.browse, action: .mark,
                     animation: .easeInOut(duration: Timing.browseOut + Timing.browseBack),
                     moves: [E.feedRow, E.pastaCard], targets: [E.feedCards], label: "browse"),
            DemoBeat(at: Timing.choose, action: .mark, animation: OnboardingAnimation.ghost,
                     moves: [E.ghost], targets: [E.pastaCard], label: "choose"),
            DemoBeat(at: Timing.eventPage, action: .openEvent, animation: OnboardingAnimation.expand,
                     moves: [E.hero], targets: [E.pastaCard], label: "event page"),
            DemoBeat(at: Timing.eventPage, action: .showJoinAction, animation: OnboardingAnimation.bar,
                     moves: [E.miniBar], label: "join action"),
            DemoBeat(at: Timing.lastRow, action: .mark, animation: OnboardingAnimation.expand,
                     moves: [E.eventTitle, E.peopleRow, E.actionRow], label: "rows"),
            DemoBeat(at: Timing.tapJoin, action: .mark, animation: OnboardingAnimation.ghost,
                     moves: [E.ghost], targets: [E.miniBar, E.hero], label: "tap join"),
            DemoBeat(at: Timing.joined, action: .join, animation: OnboardingAnimation.bar,
                     moves: [E.miniBar, E.avatar4, E.capacityText, E.actionSlot, E.joinRing],
                     targets: [E.miniBar], label: "joined"),
            DemoBeat(at: Timing.joined, action: .mark, animation: OnboardingAnimation.affordance,
                     moves: [E.barIcon], label: "bar icon"),
            DemoBeat(at: Timing.callout, action: .showCallout, animation: OnboardingAnimation.hop,
                     moves: [E.callout], targets: [E.actionRow], label: "callout"),
        ]
    }()

    @Sendable static func reduce(_ state: inout DiscoverJoinState, _ action: Action) {
        switch action {
        case .mark: break
        case .openEvent: state.page = .event
        case .showJoinAction: state.bar = .join
        case .join: state.bar = .joined; state.joined = true
        case .showCallout: state.calloutShown = true
        }
    }

    // MARK: Continuous parameters (pure functions of t, so every beat scrubs)

    /// Pasta Night's centre in the feed, and the mini bar's title centre, in canvas points.
    static let pastaCentre = DemoPoint(20 + 163 + 10 + 163 / 2, 102 + 205 / 2)
    static let barTarget = DemoPoint(195, Double(DemoCanvas.barCenterY))
    static let revealRadius = 340.0
    static let browseDistance = 180.0

    static func continuous(_ state: inout DiscoverJoinState, at time: Duration) {
        let t = time.secondsValue
        // Beat 1 develop: radial mask and staggered card scale.
        state.revealRadius = revealRadius * OnboardingAnimation.stage.progress(seconds: t)
        state.cardScales = (0..<DiscoverJoinState.cardCount).map { index in
            0.94 + 0.06 * OnboardingAnimation.expand.progress(seconds: t - Timing.cardStagger * Double(index))
        }
        // Beat 2 browse: an exact offset, out then back.
        let browse = Timing.browse.secondsValue
        let out = AnimationSpec.easeInOut(duration: Timing.browseOut)
        let back = AnimationSpec.easeInOut(duration: Timing.browseBack)
        if t <= browse + Timing.browseOut {
            state.feedOffset = -browseDistance * out.progress(seconds: t - browse)
        } else {
            state.feedOffset = -browseDistance * (1 - back.progress(seconds: t - browse - Timing.browseOut))
        }
        // Beat 3 choose: the press also presses the card (scale 0.97).
        let choosePress = Timing.choosePress.secondsValue
        state.pastaPress = GhostMotion.pressScale(t - choosePress, depth: 0.03)
        // Beat 4: rows grow out of the hero's bottom edge, 60 ms apart.
        let eventPage = Timing.eventPage.secondsValue
        state.rowReveal = (0..<3).map { index in
            OnboardingAnimation.expand.progress(seconds: t - eventPage - Timing.rowStagger * Double(index))
        }
        state.ghost = ghost(at: t)
        // Beat 6: ring pulse over the fourth slot.
        let sinceJoin = t - Timing.joined.secondsValue
        state.ringProgress = sinceJoin >= 0 && sinceJoin < Timing.ringDuration ? sinceJoin / Timing.ringDuration : nil
        // Beat 7: callout hop.
        state.calloutAppearance = DemoCallout.appearance(t - Timing.callout.secondsValue)
    }

    /// The ghost: appears over Pasta Night and presses, lifts off, then travels to the bar, presses and lifts off.
    static func ghost(at t: Double) -> GhostState? {
        let choose = Timing.choose.secondsValue, choosePress = Timing.choosePress.secondsValue
        let firstLift = choosePress + GhostMotion.pressDuration
        let tap = Timing.tapJoin.secondsValue, joinPress = Timing.joinPress.secondsValue
        let secondLift = joinPress + GhostMotion.pressDuration
        if t >= choose, t < firstLift + GhostMotion.fadeDuration {
            let opacity = t < firstLift ? GhostMotion.fadeIn(t - choose) : GhostMotion.fadeOut(t - firstLift)
            return GhostState(position: pastaCentre, scale: GhostMotion.pressScale(t - choosePress), opacity: opacity)
        }
        if t >= tap, t < secondLift + GhostMotion.fadeDuration {
            let opacity = t < secondLift ? GhostMotion.fadeIn(t - tap) : GhostMotion.fadeOut(t - secondLift)
            return GhostState(
                position: GhostMotion.travelPoint(from: pastaCentre, to: barTarget, elapsed: t - tap),
                scale: GhostMotion.pressScale(t - joinPress), opacity: opacity)
        }
        return nil
    }
}

struct DiscoverJoinState: Equatable, Sendable {
    enum Page: Sendable { case feed, event }
    enum Bar: Sendable { case tabs, join, joined }
    static let cardCount = 5

    // Discrete (beats).
    var page = Page.feed
    var bar = Bar.tabs
    var joined = false
    var calloutShown = false

    // Continuous (functions of t).
    var revealRadius = 0.0
    var cardScales = Array(repeating: 0.94, count: cardCount)
    var feedOffset = 0.0
    var pastaPress = 1.0
    var rowReveal = [0.0, 0.0, 0.0]
    var ghost: GhostState?
    var ringProgress: Double?
    var calloutAppearance = 0.0

    var attendeeCount: Int { joined ? 6 : 5 }
}

/// The B1 canvas, laid out in 390 × 540 canvas points.
struct DiscoverJoinCanvas: View {
    let state: DiscoverJoinState
    let you: OnboardingYou
    let stageFill: Color
    @Namespace private var namespace

    private enum Metrics {
        static let side: CGFloat = 20
        static let feedTitleY: CGFloat = 70
        static let cardsY: CGFloat = 102
        static let heroTop: CGFloat = -80
        static let heroWidth: CGFloat = 350
        static let heroHeight: CGFloat = 264
        static let titleHeight: CGFloat = 50
        static let peopleTop: CGFloat = 264
        static let actionTop: CGFloat = 356
        static let rowRise: CGFloat = 16
        /// The fourth avatar slot's centre: x 20 + 3 × 50 + 20, y people top + header 22 + 10 + 20.
        static let fourthSlot = CGPoint(x: 170, y: 316)
        /// The callout hangs under Leave Activity, its tail on the action row's bottom edge (y 406).
        static let calloutAnchor = CGPoint(x: 105, y: 406)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            stageFill
            content
                .mask {
                    Circle()
                        .frame(width: max(0, state.revealRadius * 2), height: max(0, state.revealRadius * 2))
                        .position(x: DemoCanvas.size.width / 2, y: DemoCanvas.size.height / 2)
                }
        }
        .frame(width: DemoCanvas.size.width, height: DemoCanvas.size.height, alignment: .topLeading)
    }

    private var content: some View {
        ZStack(alignment: .topLeading) {
            Color.white
            if state.page == .feed {
                feed.transition(.opacity)
            } else {
                eventPage.transition(.opacity)
            }
            miniBar
            if let ring = state.ringProgress {
                Circle()
                    .stroke(OnboardingTheme.accent, lineWidth: 2)
                    .frame(width: 40, height: 40)
                    .scaleEffect(1 + 0.5 * ring)
                    .opacity(1 - ring)
                    .position(Metrics.fourthSlot)
            }
            if state.calloutShown {
                DemoCallout(text: "Joined. That's it.", tail: .top, appearance: state.calloutAppearance)
                    .fixedSize()
                    .alignmentGuide(.leading) { $0.width / 2 - Metrics.calloutAnchor.x }
                    .alignmentGuide(.top) { _ in -Metrics.calloutAnchor.y }
            }
            if let ghost = state.ghost { GhostTouch(ghost: ghost) }
        }
        .frame(width: DemoCanvas.size.width, height: DemoCanvas.size.height, alignment: .topLeading)
    }

    // MARK: Feed

    private var feed: some View {
        ZStack(alignment: .topLeading) {
            Text("Upcoming events")
                .font(DIPReferenceAssets.font("Figtree-Regular", size: 18))
                .foregroundStyle(.black)
                .offset(x: Metrics.side, y: Metrics.feedTitleY)
            HStack(spacing: 10) {
                ForEach(Array(OnboardingDemoFixtures.feed.enumerated()), id: \.element.id) { index, event in
                    card(event, index: index)
                }
            }
            .fixedSize()
            .offset(x: Metrics.side + state.feedOffset, y: Metrics.cardsY)
        }
    }

    @ViewBuilder private func card(_ event: DemoEvent, index: Int) -> some View {
        let isPasta = event.id == OnboardingDemoFixtures.pastaNight.id
        let photoCard = DIPPhotoEventCard(
            title: event.title, locality: event.locality, identifier: "onboarding.demo.\(event.id)",
            attendeeCount: event.attendeeCount,
            artwork: { DIPReferenceAssets.image(event.cover).resizable().scaledToFill() },
            avatarStack: { DIPMediaStack(event.crew.map { CrewAvatarImages.reference($0, size: 22) }) },
            onSelect: {})
        let scale = state.cardScales[index] * (isPasta ? state.pastaPress : 1)
        if isPasta {
            photoCard
                .matchedGeometryEffect(id: "cover.pasta", in: namespace)
                .scaleEffect(scale)
        } else {
            photoCard.scaleEffect(scale)
        }
    }

    // MARK: Event page

    private var eventPage: some View {
        VStack(alignment: .leading, spacing: 0) {
            DIPDetailHero(image: .asset(OnboardingDemoFixtures.pastaNight.cover), tags: [],
                          identifierPrefix: "onboarding.demo")
                .frame(width: Metrics.heroWidth, height: Metrics.heroHeight)
                .matchedGeometryEffect(id: "cover.pasta", in: namespace)
            // Everything under the hero grows out of its bottom edge: clipped there, offset −16 → 0.
            VStack(alignment: .leading, spacing: 0) {
                Text(OnboardingDemoFixtures.pastaNight.title.uppercased())
                    .font(DIPReferenceAssets.font("FjallaOne-Regular", size: 40, relativeTo: .largeTitle))
                    .foregroundStyle(.black)
                    .frame(height: Metrics.titleHeight, alignment: .leading)
                    .padding(.top, 10)
                    .rising(state.rowReveal[0], by: Metrics.rowRise)
                peopleRow
                    .padding(.top, Metrics.peopleTop - (Metrics.heroTop + Metrics.heroHeight) - 10 - Metrics.titleHeight)
                    .rising(state.rowReveal[1], by: Metrics.rowRise)
                actionRow
                    .padding(.top, 20)
                    .rising(state.rowReveal[2], by: Metrics.rowRise)
            }
            .frame(width: Metrics.heroWidth, alignment: .leading)
            .clipped()
        }
        .offset(x: Metrics.side, y: Metrics.heroTop)
    }

    private var people: [MediaReference] {
        let crew = [CrewMember.purple, .yellow, .gray].map { CrewAvatarImages.reference($0) }
        return state.joined ? crew + [you.photo] : crew
    }

    private var peopleRow: some View {
        DIPDetailPeopleRow(
            title: "Who’s Attending", avatars: people, total: state.attendeeCount, emptyText: "",
            capacity: OnboardingDemoFixtures.pastaCapacity, identifierPrefix: "onboarding.demo", onMore: {})
            .contentTransition(.numericText())
    }

    private var actionRow: some View {
        DIPDetailActionRow(
            joinInRow: false, directionsURL: OnboardingDemoFixtures.directionsURL,
            isParticipating: state.joined, canChange: true,
            joinTitle: "Join Activity", leaveTitle: "Leave Activity",
            shareItem: OnboardingDemoFixtures.pastaNight.title, shareTitle: "Share Event",
            identifierPrefix: "onboarding.demo", onJoin: {}, onLeave: {})
    }

    // MARK: Mini bar

    private var barAction: DIPBottomBarAction? {
        switch state.bar {
        case .tabs: nil
        case .join, .joined:
            EventBarAction.forEvent(
                OnboardingDemoFixtures.pastaDetail(joined: state.bar == .joined, avatars: []), isLoading: false)
        }
    }

    private var miniBar: some View {
        DIPFloatingNavigation(
            selected: .home, action: barAction, showsTabs: barAction == nil, onSelect: { _ in })
            .padding(.horizontal, 20)
            .frame(width: DemoCanvas.size.width)
            .position(x: DemoCanvas.size.width / 2, y: DemoCanvas.barCenterY)
    }
}

private extension View {
    /// Grows out of the edge above: offset −rise → 0 and opacity 0 → 1 with `progress`.
    func rising(_ progress: Double, by rise: CGFloat) -> some View {
        offset(y: -rise * (1 - min(1, progress))).opacity(min(1, max(0, progress)))
    }
}
