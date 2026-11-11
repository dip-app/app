import DIPCore
import DIPDesignSystem
import DIPMockData
import XCTest
@testable import DIP

/// `EventBarAction.resolve` must equal the switch it replaced in `DIPPrototypeApp.bottomAction`.
/// `legacyBottomAction` is that switch copied verbatim (route, snapshot and loading flag as inputs).
final class EventBarActionTests: XCTestCase {
    private typealias Route = EventBarAction.Route
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func legacyBottomAction(_ route: Route?, _ snapshot: DIPAppSnapshot?, isLoading: Bool) -> DIPBottomBarAction? {
        switch route {
        case .event(let id):
            guard let event = snapshot?.eventDetails[id] else {
                return DIPBottomBarAction(
                    title: isLoading ? "Loading…" : "Activity unavailable",
                    style: .complete, identifier: "event.primary")
            }
            if event.isPast { return DIPBottomBarAction(title: "View Album", identifier: "event.primary") }
            let joined = event.isJoined
            if let metadata = event.metadata {
                switch metadata.state(now: now, attendeeCount: event.attendeeCount, isJoined: joined) {
                case .cancelled: return DIPBottomBarAction(title: "Activity cancelled", style: .complete, identifier: "event.primary")
                case .full: return DIPBottomBarAction(title: "Activity full", style: .complete, identifier: "event.primary")
                case .started where !joined: return DIPBottomBarAction(title: "Activity started", style: .complete, identifier: "event.primary")
                default: break
                }
            }
            return DIPBottomBarAction(
                title: joined ? "Activity Chat" : "Join the Activity",
                style: joined ? .accent : .standard,
                identifier: "event.primary", value: joined ? "Joined" : "Not joined",
                icon: joined ? "event_HeroiconsOutlineChatBubbleOvalLeft" : nil,
                kind: joined ? .navigate : .commit)  // Nov 10: haptic kind added on purpose; looks unchanged.
        case .participants(let id) where snapshot?.eventDetails[id]?.isPast == true:
            return DIPBottomBarAction(title: "View Album", identifier: "participants.album")
        case .participants(let id):
            let joined = snapshot?.eventDetails[id]?.isJoined == true
            return DIPBottomBarAction(title: joined ? "Activity Chat" : "Join the Activity",
                style: joined ? .accent : .standard,
                identifier: joined ? "participants.chat" : "participants.join",
                icon: joined ? "event_HeroiconsOutlineChatBubbleOvalLeft" : nil,
                kind: joined ? .navigate : .commit)
        // Stream B (live albums): Add Photos only where the member may upload; the full limit shows a complete pill.
        case .album(let id):
            guard let album = snapshot?.albums[id], album.isLoaded, album.canAddPhotos else { return nil }
            if album.remainingUploads == 0 {
                return DIPBottomBarAction(title: "Photo limit reached", style: .complete, identifier: "album.add-photos")
            }
            return DIPBottomBarAction(title: "Add Photos", identifier: "album.add-photos")
        case .challenge, nil: return nil
        }
    }

    private func metadata(startIn start: TimeInterval, endIn end: TimeInterval, capacity: Int = 10,
                          status: DIPEventStatus = .scheduled) -> DIPEventMetadata {
        DIPEventMetadata(startTime: now.addingTimeInterval(start), endTime: now.addingTimeInterval(end),
                         venueName: "Hall", address: "1 Main St", locality: "Town", costCents: 0,
                         capacity: capacity, status: status)
    }

    /// Every event variant the switch distinguishes, keyed by id.
    private var snapshot: DIPAppSnapshot {
        var snapshot = DIPMockFixtures.reference
        func event(_ id: String, joined: Bool = false, past: Bool = false, count: Int = 3, metadata: DIPEventMetadata? = nil) -> DIPEventDetail {
            DIPEventDetail(id: id, title: id, image: .asset("cover_games"), timing: "", description: "", tags: [],
                           isJoined: joined, attendeeCount: count, attendeeAvatars: [], isPast: past, metadata: metadata)
        }
        let soon = metadata(startIn: 3_600, endIn: 7_200)
        let events = [
            event("plain"), event("plain-joined", joined: true), event("past", past: true),
            event("past-joined", joined: true, past: true),
            event("available", metadata: soon), event("joined", joined: true, metadata: soon),
            event("full", count: 10, metadata: soon), event("full-joined", joined: true, count: 10, metadata: soon),
            event("cancelled", metadata: metadata(startIn: 3_600, endIn: 7_200, status: .cancelled)),
            event("cancelled-joined", joined: true, metadata: metadata(startIn: 3_600, endIn: 7_200, status: .cancelled)),
            event("started", metadata: metadata(startIn: -600, endIn: 3_600)),
            event("started-joined", joined: true, metadata: metadata(startIn: -600, endIn: 3_600)),
            event("ended-metadata", metadata: metadata(startIn: -7_200, endIn: -3_600)),
        ]
        for event in events { snapshot.eventDetails[event.id] = event }
        return snapshot
    }

    func testResolveMatchesTheLegacySwitchForEveryRouteAndState() {
        let snapshot = self.snapshot
        let ids = Array(snapshot.eventDetails.keys) + ["missing"]
        var routes: [Route?] = [nil]
        for id in ids {
            routes += [.event(id), .participants(id), .album(id), .challenge(id)]
        }
        var compared = 0
        for route in routes {
            for candidate in [snapshot, nil] as [DIPAppSnapshot?] {
                for isLoading in [false, true] {
                    XCTAssertEqual(
                        EventBarAction.resolve(route: route, snapshot: candidate, isLoading: isLoading, now: now),
                        legacyBottomAction(route, candidate, isLoading: isLoading),
                        "\(String(describing: route)) snapshot: \(candidate != nil) loading: \(isLoading)")
                    compared += 1
                }
            }
        }
        XCTAssertGreaterThan(compared, 100)
    }

    func testRepresentativeCases() {
        let snapshot = self.snapshot
        func resolve(_ route: Route?, loading: Bool = false) -> DIPBottomBarAction? {
            EventBarAction.resolve(route: route, snapshot: snapshot, isLoading: loading, now: now)
        }
        XCTAssertNil(resolve(nil))
        XCTAssertEqual(resolve(.event("available"))?.title, "Join the Activity")
        XCTAssertEqual(resolve(.event("available"))?.style, .standard)
        XCTAssertEqual(resolve(.event("available"))?.kind, .commit, "Join changes something: a slight haptic")
        let joined = resolve(.event("joined"))
        XCTAssertEqual(joined?.title, "Activity Chat")
        XCTAssertEqual(joined?.style, .accent)
        XCTAssertEqual(joined?.icon, "event_HeroiconsOutlineChatBubbleOvalLeft")
        XCTAssertEqual(joined?.value, "Joined")
        XCTAssertEqual(joined?.kind, .navigate, "opening chat is navigation: silent")
        XCTAssertEqual(resolve(.event("full"))?.title, "Activity full")
        XCTAssertEqual(resolve(.event("full-joined"))?.title, "Activity Chat", "joined beats full")
        XCTAssertEqual(resolve(.event("cancelled-joined"))?.title, "Activity cancelled")
        XCTAssertEqual(resolve(.event("started"))?.title, "Activity started")
        XCTAssertEqual(resolve(.event("started-joined"))?.title, "Activity Chat")
        XCTAssertEqual(resolve(.event("past"))?.title, "View Album")
        XCTAssertEqual(resolve(.event("missing"))?.title, "Activity unavailable")
        XCTAssertEqual(resolve(.event("missing"), loading: true)?.title, "Loading…")
        XCTAssertEqual(resolve(.participants("joined"))?.identifier, "participants.chat")
        XCTAssertEqual(resolve(.participants("past"))?.identifier, "participants.album")
        XCTAssertEqual(resolve(.album("kayaking-memory"))?.title, "Add Photos")
        XCTAssertNil(resolve(.album("x")), "no album, no upload action")
        XCTAssertNil(resolve(.challenge("x")))
    }

    func testForEventMatchesTheEventRoute() {
        let snapshot = self.snapshot
        for (id, event) in snapshot.eventDetails {
            XCTAssertEqual(EventBarAction.forEvent(event, isLoading: false, now: now),
                           EventBarAction.resolve(route: .event(id), snapshot: snapshot, isLoading: false, now: now))
        }
    }
}
