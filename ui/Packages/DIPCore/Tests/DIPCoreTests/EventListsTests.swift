import DIPCore
import DIPMockData
import Foundation
import XCTest

final class EventListsTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func event(_ id: String, start: TimeInterval, end: TimeInterval,
                       joined: Bool = false, cancelled: Bool = false, completed: Bool = false) -> DIPEventDetail {
        var result = DIPMockFixtures.reference.eventDetails["puppy-yoga"]!
        result.id = id
        result.title = "Title without a date"
        result.isJoined = joined
        result.metadata = .init(startTime: now.addingTimeInterval(start), endTime: now.addingTimeInterval(end),
                                venueName: "Studio", address: "123 Example Street", locality: "Pittsburgh",
                                costCents: 0, capacity: 20, status: cancelled ? .cancelled : (completed ? .completed : .scheduled))
        return result
    }

    private func snapshot(_ events: [DIPEventDetail]) -> DIPAppSnapshot {
        var snapshot = DIPMockFixtures.reference
        snapshot.home.events = []
        snapshot.activeEvents = []
        snapshot.memories = []
        snapshot.eventDetails = Dictionary(uniqueKeysWithValues: events.map { ($0.id, $0) })
        return snapshot
    }

    func testClassificationUsesGoingAndEndBoundaryRatherThanDisplayTitle() {
        let input = snapshot([
            event("future-going", start: 10, end: 100, joined: true),
            event("future-not-going", start: 10, end: 100),
            event("ongoing", start: -10, end: 10, joined: true),
            event("ended-now", start: -100, end: 0, joined: true),
            event("past-not-going", start: -100, end: -1)
        ])
        let lists = DIPEventLists(snapshot: input, now: now)
        XCTAssertEqual(lists.discovery.map(\.id), ["future-going", "future-not-going"])
        XCTAssertEqual(lists.upcoming.map(\.id), ["ongoing", "future-going"])
        XCTAssertEqual(lists.past.map(\.eventID), ["ended-now"])
    }

    func testCancelledEventsAreNotDiscoverableOrJoinedHistory() {
        let lists = DIPEventLists(snapshot: snapshot([
            event("cancelled", start: 10, end: 100, joined: true, cancelled: true),
            event("cancelled-past", start: -100, end: -10, joined: true, cancelled: true)
        ]), now: now)
        XCTAssertTrue(lists.discovery.isEmpty)
        XCTAssertTrue(lists.upcoming.isEmpty)
        XCTAssertTrue(lists.past.isEmpty)
    }

    func testCompletedEventsJoinedByTheMemberAppearInPastButNeverDiscoveryOrUpcoming() {
        let lists = DIPEventLists(snapshot: snapshot([
            event("done-joined", start: -100, end: -10, joined: true, completed: true),
            event("done-closed-early", start: 10, end: 100, joined: true, completed: true),
            event("done-not-joined", start: -100, end: -10, completed: true)
        ]), now: now)
        XCTAssertEqual(Set(lists.past.map(\.eventID)), ["done-joined", "done-closed-early"])
        XCTAssertTrue(lists.discovery.isEmpty)
        XCTAssertTrue(lists.upcoming.isEmpty)
    }

    func testCardDateAndPlaceSitOnSeparateLinesWithoutADanglingDot() {
        let lists = DIPEventLists(snapshot: snapshot([event("e", start: 10, end: 100)]), now: now,
                                  locale: Locale(identifier: "en_US"), timeZone: TimeZone(secondsFromGMT: 0)!)
        let label = lists.discovery[0].locality
        XCTAssertFalse(label.contains("·"))
        XCTAssertTrue(label.hasSuffix("\nPittsburgh"))
    }

    func testSortingIsStableAndPastIsMostRecentFirst() {
        let lists = DIPEventLists(snapshot: snapshot([
            event("z", start: 20, end: 100, joined: true),
            event("b", start: 10, end: 100, joined: true),
            event("a", start: 10, end: 100, joined: true),
            event("old", start: -200, end: -100, joined: true),
            event("recent", start: -100, end: -10, joined: true)
        ]), now: now)
        XCTAssertEqual(lists.upcoming.map(\.id), ["a", "b", "z"])
        XCTAssertEqual(lists.past.map(\.id), ["recent", "old"])
    }

    func testLegacyFrameFixturesRetainOriginalLists() {
        let original = DIPMockFixtures.reference
        let lists = DIPEventLists(snapshot: original, now: now)
        XCTAssertEqual(lists.discovery, original.home.events)
        XCTAssertEqual(lists.upcoming, original.activeEvents)
        XCTAssertEqual(lists.past, original.memories)
    }

    func testMetadataOverridesStaleListsAndContainsDateAndLocation() {
        var input = DIPMockFixtures.reference
        let replacement = event("puppy-yoga", start: 10, end: 100)
        input.eventDetails[replacement.id] = replacement
        let lists = DIPEventLists(snapshot: input, now: now,
                                  locale: Locale(identifier: "en_US"), timeZone: TimeZone(secondsFromGMT: 0)!)
        XCTAssertEqual(lists.discovery.filter { $0.id == replacement.id }.count, 1)
        XCTAssertFalse(lists.upcoming.contains { $0.id == replacement.id })
        XCTAssertTrue(lists.discovery.first { $0.id == replacement.id }!.locality.contains("Pittsburgh"))
        XCTAssertTrue(lists.discovery.first { $0.id == replacement.id }!.locality.contains("2027"))
    }

    func testV1FixturesHaveStructuredDatesAndConsistentJoinedLists() {
        let fixtures = DIPMockFixtures.v1Events(now: now)
        XCTAssertTrue(fixtures.eventDetails.values.allSatisfy { $0.metadata != nil })
        XCTAssertTrue(fixtures.activeEvents.allSatisfy { fixtures.eventDetails[$0.id]?.isJoined == true })
        XCTAssertTrue(fixtures.memories.allSatisfy { fixtures.eventDetails[$0.eventID]?.isJoined == true })
        XCTAssertEqual(DIPEventLists(snapshot: fixtures, now: now).upcoming, fixtures.activeEvents)
        XCTAssertNil(DIPMockFixtures.reference.eventDetails["puppy-yoga"]?.metadata)
    }
}
