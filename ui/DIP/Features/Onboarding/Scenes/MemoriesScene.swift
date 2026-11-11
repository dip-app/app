import DIPCore
import DIPMockData
import DIPDesignSystem
import SwiftUI

/// B4 Memories (spec §3 B4): My Events by name, "Past events", a past event's shared album and adding a photo
/// (the mock album until F5). The timeline is `MemoriesTimeline` (DIPCore).
///
/// Owner revision (Nov 10): every page is the app's real screen (`DIPMyEventsScreen`, `DIPEventDetailsScreen`,
/// `DIPAlbumScreen`) fed by the bundled mock fixtures, and the bar comes from `EventBarAction.resolve`.
struct MemoriesScene: DemoScene {
    static let id = "memories"

    var script: DemoScript<MemoriesState> { MemoriesTimeline.script }

    func applyContinuous(_ state: inout MemoriesState, at t: Duration) {
        MemoriesTimeline.continuous(&state, at: t)
    }

    let description = "Example: the My Events tab holds your upcoming and past events. A past event opens its photo album, where you can add your own photos."
    let hostFace = CrewMember.gray
    var stageFill: Color { OnboardingTheme.notification }
    let accessibilityRows = [
        DemoAccessibilityRow(systemImage: "square.grid.2x2", text: "My Events holds upcoming and past events"),
        DemoAccessibilityRow(systemImage: "clock.arrow.circlepath", text: "Past events keep their photo album"),
        DemoAccessibilityRow(systemImage: "photo.badge.plus", text: "Add your own photos"),
    ]

    func prepare() { DemoPeople.prepare(youName: OnboardingDemoFixtures.youPlaceholderName) }

    func canvas(_ state: MemoriesState) -> some View {
        MemoriesCanvas(state: state)
    }
}

/// The fixtures B4 shows: the app's mock snapshot (fictional, bundled).
enum MemoriesDemoFixtures {
    static let snapshot = DIPMockFixtures.reference
    static let lists = DIPEventLists(snapshot: snapshot, now: Date())
    static var pastEventID: String { lists.past.first?.id ?? "kayaking-memory" }
    static let newPhoto = DIPPhoto(id: "onboarding.new-photo", image: .asset("album_Rectangle937"))
}

struct MemoriesCanvas: View {
    let state: MemoriesState
    private typealias Fixtures = MemoriesDemoFixtures

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.white
            switch state.page {
            case .myEvents: myEvents.transition(.opacity)
            case .pastEvent:
                pastPage.transition(.scale(scale: 0.5, anchor: UnitPoint(x: 0.5, y: 196 / 540)).combined(with: .opacity))
            case .album: album.transition(.opacity)
            }
            DemoMiniBar(selected: state.selectedTab == .events ? .events : .home, action: barAction)
            if state.callout == .myEvents || state.myEventsCallout > 0 {
                DemoCallout(text: "My Events", tail: .bottom, appearance: state.myEventsCallout)
                    .fixedSize()
                    .position(x: 195, y: 418)
            }
            if state.callout == .past || state.pastCallout > 0 {
                DemoCallout(text: "Past events", tail: .bottom, appearance: state.pastCallout)
                    .fixedSize()
                    .position(x: MemoriesTimeline.Point.pastCard.x, y: MemoriesTimeline.Point.pastCard.y - 70)
            }
            if let upload = state.upload, !state.thumbSettled { uploadingThumb(upload) }
            if let ghost = state.ghost { GhostTouch(ghost: GhostState(ghost)) }
        }
        .frame(width: DemoCanvas.size.width, height: DemoCanvas.size.height, alignment: .topLeading)
        .clipped()
    }

    /// The app's own resolver for each page: tabs on My Events, "View Album" on a past event, "Add Photos" in
    /// its album. B4 opens on B3's entry action (a placeholder until F3).
    private var barAction: DIPBottomBarAction? {
        switch state.bar {
        case .entry: DIPBottomBarAction(title: "Add Your Entry", identifier: "onboarding.demo.entry")
        case .tabs: nil
        case .viewAlbum:
            EventBarAction.resolve(route: .event(Fixtures.pastEventID), snapshot: Fixtures.snapshot, isLoading: false)
        case .addPhotos:
            EventBarAction.resolve(route: .album(Fixtures.pastEventID), snapshot: Fixtures.snapshot, isLoading: false)
        }
    }

    // MARK: Real screens

    private var myEvents: some View {
        DemoPhoneScreen {
            DIPMyEventsScreen(
                activeEvents: Fixtures.lists.upcoming, memories: Fixtures.lists.past, unreadCount: 0,
                profileAvatar: Fixtures.snapshot.home.profileAvatar, initialMemories: state.pastSection,
                showsBottomBar: false, onSelectTab: { _ in }, onEvent: { _ in }, onAlbum: { _ in },
                onNotifications: {}, onProfile: {})
        }
        // The section is the screen's own state; the demo switches it by re-creating the screen.
        .id(state.pastSection)
        .transition(.opacity)
        .blur(radius: 6 * (1 - state.listDevelop))
        .opacity(state.listDevelop)
    }

    private var pastPage: some View {
        let id = Fixtures.pastEventID
        return DemoPhoneScreen {
            if let event = Fixtures.snapshot.eventDetails[id] {
                DIPEventDetailsScreen(
                    event: event, joined: event.isJoined, showsBottomBar: false, onJoin: {}, onBack: {},
                    onAttendees: {}, onChat: {}, photos: Fixtures.snapshot.albums[id]?.photos ?? [],
                    onAlbum: {}, onLeave: {})
            }
        }
    }

    /// The past event's album, with the new photo in slot 1 once it settles.
    private var albumModel: DIPAlbum? {
        guard var album = Fixtures.snapshot.albums[Fixtures.pastEventID] else { return nil }
        if state.thumbSettled { album.photos.insert(Fixtures.newPhoto, at: 0) }
        return album
    }

    private var album: some View {
        let develop = state.albumDevelop.last ?? 1
        return DemoPhoneScreen {
            if let album = albumModel {
                DIPAlbumScreen(
                    album: album, commentsByPhoto: [:], currentUser: Fixtures.snapshot.profile, showsBottomBar: false,
                    onBack: {}, onAddPhotos: { _ in }, onAddComment: { _, _, _ in })
            }
        }
        .blur(radius: 6 * (1 - min(1, develop)))
        .opacity(min(1, develop))
    }

    private func uploadingThumb(_ progress: Double) -> some View {
        let size = 20 + 60 * progress
        return ZStack {
            DIPMedia(Fixtures.newPhoto.image).resizable().scaledToFill()
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            Circle().trim(from: 0, to: progress)
                .stroke(.white, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .frame(width: 28, height: 28)
        }
        .position(x: 195, y: 479 - 70 * progress)
    }
}
