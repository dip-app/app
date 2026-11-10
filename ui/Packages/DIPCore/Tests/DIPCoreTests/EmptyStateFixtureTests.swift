import DIPCore
import DIPMockData
import Foundation
import XCTest

/// Each empty-state review fixture empties exactly the list its screen reads, through the same
/// projection the app uses, and leaves the reference fixture itself untouched.
final class EmptyStateFixtureTests: XCTestCase {
    private let now = Date()

    func testHomeEventsEmptiesDiscoveryAndActiveButKeepsMemories() {
        let reference = DIPEventLists(snapshot: DIPMockFixtures.reference, now: now)
        let lists = DIPEventLists(snapshot: DIPMockFixtures.emptyStateReview(.homeEvents), now: now)
        XCTAssertFalse(reference.discovery.isEmpty)
        XCTAssertTrue(lists.discovery.isEmpty)
        XCTAssertTrue(lists.upcoming.isEmpty)
        XCTAssertEqual(lists.past, reference.past)
    }

    func testMyEventsEmptiesBothSectionsButKeepsDiscovery() {
        let lists = DIPEventLists(snapshot: DIPMockFixtures.emptyStateReview(.myEvents), now: now)
        XCTAssertTrue(lists.upcoming.isEmpty)
        XCTAssertTrue(lists.past.isEmpty)
        XCTAssertFalse(lists.discovery.isEmpty)
    }

    func testSingleSurfaceFixtures() throws {
        let recents = DIPMockFixtures.emptyStateReview(.homeRecents)
        XCTAssertTrue(recents.home.recentAttendeeAvatars.isEmpty)
        XCTAssertEqual(recents.home.events, DIPMockFixtures.reference.home.events)

        let attendees = DIPMockFixtures.emptyStateReview(.attendees)
        let event = try XCTUnwrap(attendees.eventDetails["puppy-yoga"])
        XCTAssertEqual(event.attendeeCount, 0)
        XCTAssertTrue(event.attendeeAvatars.isEmpty)
        XCTAssertEqual(attendees.participants["puppy-yoga"], [])

        let album = DIPMockFixtures.emptyStateReview(.album)
        XCTAssertEqual(album.albums["kayaking-memory"]?.photos.isEmpty, true)
        XCTAssertFalse(DIPMockFixtures.reference.albums["kayaking-memory"]?.photos.isEmpty ?? true)
    }

    func testEveryFixtureNamesAPreviewScreen() {
        let screens = Set(["home", "event", "events", "album"])
        for fixture in DIPEmptyStateFixture.allCases {
            XCTAssertTrue(screens.contains(fixture.screen), fixture.rawValue)
            XCTAssertEqual(DIPEmptyStateFixture(rawValue: fixture.rawValue), fixture)
        }
    }
}
