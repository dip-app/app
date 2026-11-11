import Foundation

/// B4 Memories (spec §3 B4 storyboard): one `DemoBeat` per table row.
///
/// The mini bar's action dissolves into tabs and the marker moves to My Events, which is labelled by a
/// callout. The section switches to "Past events", a past event opens, "View Album" shows its photos and
/// "Add Photos" adds a new one (the mock album; F5 makes it live).
public enum MemoriesTimeline {
    public enum Action: Equatable, Sendable {
        case mark
        case tabs
        case myEvents
        case callout(MemoriesState.Callout?)
        case pastSection
        case pastPage
        case bar(MemoriesState.Bar)
        case album
        case thumbSettled
    }

    public enum Element {
        public static let miniBar = "miniBar", tabMarker = "tabMarker", myEventsList = "myEventsList"
        public static let calloutMyEvents = "callout.myEvents", sectionMarker = "sectionMarker"
        public static let sectionContent = "sectionContent", calloutPast = "callout.past", pastCard = "pastCard"
        public static let pastPage = "pastPage", albumGrid = "albumGrid", newThumb = "newThumb"
        public static let uploadRing = "uploadRing", ghost = "ghost"
    }

    public enum Point {
        /// The My Events icon: 3rd of the bar's 4 tabs (20 + 40 + 270 / 3 × 2); the app asserts this against
        /// `DIPFloatingNavigation.tabCenterX` (`DemoMiniBarTests`).
        public static let myEventsTab = DemoCoordinate(240, 479)
        public static let pastCard = DemoCoordinate(195, 196)
        public static let bar = DemoCoordinate(195, 479)
    }

    public static let end = Duration.milliseconds(9_500)
    /// `DIPMotion.section` (`.smooth(duration: 0.625, extraBounce: 0)`) as a spring.
    public static let section = AnimationSpec.spring(response: 0.625, dampingFraction: 1.0)
    public static let albumCount = 6

    public static var script: DemoScript<MemoriesState> {
        DemoScript(
            initial: MemoriesState(), duration: end, beats: beats,
            stills: [.milliseconds(2_000), .milliseconds(5_700), end],
            reduce: reduce, continuous: { state, t in continuous(&state, at: t) })
    }

    static let beats: [DemoBeat<Action>] = {
        typealias E = Element
        func at(_ ms: Int) -> Duration { .milliseconds(ms) }
        return [
            DemoBeat(at: at(0), action: .tabs, animation: OnboardingAnimation.bar,
                     moves: [E.miniBar], label: "b4.tabs"),
            DemoBeat(at: at(0), action: .myEvents, animation: OnboardingAnimation.marker,
                     moves: [E.tabMarker], label: "b4.marker"),
            DemoBeat(at: at(0), action: .mark, animation: .easeOut(duration: 0.4),
                     moves: [E.myEventsList], label: "b4.develop"),
            DemoBeat(at: at(750), action: .callout(.myEvents), animation: OnboardingAnimation.hop,
                     moves: [E.calloutMyEvents], targets: [E.tabMarker], label: "b4.callout"),
            DemoBeat(at: at(2_400), action: .callout(nil), animation: .easeIn(duration: 0.15),
                     moves: [E.calloutMyEvents], label: "b4.calloutOut"),
            DemoBeat(at: at(2_550), action: .pastSection, animation: section,
                     moves: [E.sectionMarker, E.sectionContent, E.pastCard], label: "b4.section"),
            DemoBeat(at: at(3_600), action: .callout(.past), animation: OnboardingAnimation.hop,
                     moves: [E.calloutPast], targets: [E.sectionMarker], label: "b4.calloutPast"),
            DemoBeat(at: at(3_600), action: .mark, animation: OnboardingAnimation.ghost,
                     moves: [E.ghost], targets: [E.pastCard], label: "b4.ghostPast"),
            DemoBeat(at: at(4_100), action: .mark, animation: .easeInOut(duration: 0.22),
                     moves: [E.ghost], targets: [E.pastCard], label: "b4.pressPast"),
            DemoBeat(at: at(4_580), action: .callout(nil), animation: .easeIn(duration: 0.15),
                     moves: [E.calloutPast], label: "b4.calloutPastOut"),
            DemoBeat(at: at(4_750), action: .pastPage, animation: OnboardingAnimation.expand,
                     moves: [E.pastPage], targets: [E.pastCard, E.calloutPast], label: "b4.pastPage"),
            DemoBeat(at: at(4_750), action: .bar(.viewAlbum), animation: OnboardingAnimation.bar,
                     moves: [E.miniBar], label: "b4.viewAlbum"),
            DemoBeat(at: at(5_650), action: .mark, animation: OnboardingAnimation.ghost,
                     moves: [E.ghost], targets: [E.miniBar, E.pastPage], label: "b4.ghostBar"),
            DemoBeat(at: at(6_100), action: .mark, animation: .easeInOut(duration: 0.22),
                     moves: [E.ghost], targets: [E.miniBar], label: "b4.pressBar"),
            DemoBeat(at: at(6_350), action: .album, animation: OnboardingAnimation.expand,
                     moves: [E.albumGrid], label: "b4.grid"),
            DemoBeat(at: at(6_550), action: .mark, animation: OnboardingAnimation.expand,
                     moves: [E.albumGrid], label: "b4.grid.tail"),
            DemoBeat(at: at(6_350), action: .bar(.addPhotos), animation: OnboardingAnimation.bar,
                     moves: [E.miniBar], label: "b4.addPhotos"),
            DemoBeat(at: at(7_450), action: .mark, animation: .easeInOut(duration: 0.22),
                     moves: [E.ghost], targets: [E.miniBar, E.albumGrid], label: "b4.pressUpload"),
            DemoBeat(at: at(7_700), action: .mark, animation: .linear(duration: 0.8),
                     moves: [E.newThumb, E.uploadRing], label: "b4.thumbGrow"),
            DemoBeat(at: at(8_500), action: .thumbSettled, animation: OnboardingAnimation.stage,
                     moves: [E.newThumb, E.albumGrid], label: "b4.thumbSettle"),
        ]
    }()

    @Sendable static func reduce(_ state: inout MemoriesState, _ action: Action) {
        switch action {
        case .mark: break
        case .tabs: state.bar = .tabs
        case .myEvents: state.selectedTab = .events
        case .callout(let callout): state.callout = callout
        case .pastSection: state.pastSection = true
        case .pastPage: state.page = .pastEvent
        case .bar(let bar): state.bar = bar
        case .album: state.page = .album
        case .thumbSettled: state.thumbSettled = true
        }
    }

    // MARK: Continuous parameters

    static let visits: [DemoGhostVisit] = [
        DemoGhostVisit(appearAt: 3.60, from: Point.myEventsTab, target: Point.pastCard, pressAt: 4.10),
        DemoGhostVisit(appearAt: 5.65, from: Point.pastCard, target: Point.bar, pressAt: 6.10),
        DemoGhostVisit(appearAt: 7.45, target: Point.bar, pressAt: 7.45),
    ]

    public static func continuous(_ state: inout MemoriesState, at time: Duration) {
        let t = time.secondsValue
        state.listDevelop = DemoProgress.clamped(.easeOut(duration: 0.4), t, from: 0)
        state.myEventsCallout = DemoProgress.callout(t, enter: 0.75, exit: 2.40)
        state.pastCallout = DemoProgress.callout(t, enter: 3.60, exit: 4.58)
        state.albumDevelop = (0..<albumCount).map {
            DemoProgress.clamped(OnboardingAnimation.expand, t, from: 6.35 + 0.04 * Double($0))
        }
        let grow = t - 7.70
        state.upload = grow >= 0 && grow <= 0.8 ? grow / 0.8 : (grow > 0.8 ? 1 : nil)
        state.ghost = DemoGhost.state(at: t, visits: visits)
    }
}

public struct MemoriesState: Equatable, Sendable {
    public enum Tab: Equatable, Sendable { case home, events }
    public enum Bar: Equatable, Sendable {
        /// B3's challenge action, carried in from the previous step.
        case entry
        case tabs, viewAlbum, addPhotos
    }
    public enum Page: Equatable, Sendable { case myEvents, pastEvent, album }
    public enum Callout: Equatable, Sendable { case myEvents, past }

    // Discrete.
    public var bar = Bar.entry
    public var selectedTab = Tab.home
    public var callout: Callout?
    public var pastSection = false
    public var page = Page.myEvents
    public var thumbSettled = false
    // Continuous.
    public var listDevelop = 0.0
    public var myEventsCallout = 0.0
    public var pastCallout = 0.0
    public var albumDevelop = Array(repeating: 0.0, count: MemoriesTimeline.albumCount)
    /// The new photo's upload: nil before it starts, then 0 → 1.
    public var upload: Double?
    public var ghost: DemoGhostState?

    public init() {}
}
