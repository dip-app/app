import XCTest

@testable import DIPCore

final class InterestFilterTests: XCTestCase {
    private func event(_ id: String, _ tags: [String]) -> DIPEventSummary {
        DIPEventSummary(id: id, title: id, locality: "", image: .asset("x"), tagIDs: tags)
    }

    private let catalog = [
        DIPInterest(id: "fit", name: "Fitness", sortOrder: 1), DIPInterest(id: "food", name: "Food", sortOrder: 2),
        DIPInterest(id: "art", name: "Arts", sortOrder: 3),
    ]

    func testActiveInterestsKeepStoredOrderDropRetiredUnknownAndRepeats() {
        let active = DIPInterestFilter.activeInterests(storedIDs: ["art", "gone", "fit", "art", "retired"], catalog: catalog)
        XCTAssertEqual(active.map(\.id), ["art", "fit"])
        XCTAssertEqual(DIPInterestFilter.activeInterests(storedIDs: ["fit"], catalog: nil), [], "no catalog, nothing to name")
        XCTAssertEqual(DIPInterestFilter.activeInterests(storedIDs: [], catalog: catalog), [])
    }

    func testMatchingIsAnyMatchAndKeepsTheInputOrder() {
        let events = [event("e1", ["food"]), event("e2", ["fit", "art"]), event("e3", ["music"]), event("e4", ["art"])]
        XCTAssertEqual(DIPInterestFilter.matching(events, interestIDs: ["art", "fit"]).map(\.id), ["e2", "e4"])
        XCTAssertEqual(DIPInterestFilter.matching(events, interestIDs: ["food"]).map(\.id), ["e1"])
    }

    func testEventsWithoutTagsNeverMatchAndUnknownTagIDsAreHarmless() {
        let events = [event("untagged", []), event("odd", ["tag-from-the-future"])]
        XCTAssertEqual(DIPInterestFilter.matching(events, interestIDs: ["fit"]), [])
        XCTAssertEqual(DIPInterestFilter.matching(events, interestIDs: []), [])
    }

    func testManyTagsOnOneEventStillListsItOnce() {
        let many = event("busy", ["a", "b", "c", "fit", "d", "e"])
        let result = DIPInterestFilter.matching([many, event("other", ["z"])], interestIDs: ["fit", "a", "c"])
        XCTAssertEqual(result.map(\.id), ["busy"])
    }

    func testEqualStartOrderIsPreservedBecauseFilteringNeverSorts() {
        let events = ["b", "a", "c"].map { event($0, ["fit"]) }
        XCTAssertEqual(DIPInterestFilter.matching(events, interestIDs: ["fit"]).map(\.id), ["b", "a", "c"])
    }

    func testVisibleEventsAppliesTheFilterOnlyWhenMatchingAndInterestsExist() {
        let events = [event("e1", ["fit"]), event("e2", ["music"])]
        let fit = [catalog[0]]
        let matching = DIPInterestFilter.visibleEvents(events, scope: .matching, activeInterests: fit)
        XCTAssertEqual(matching.events.map(\.id), ["e1"])
        XCTAssertTrue(matching.isFiltering)
        let all = DIPInterestFilter.visibleEvents(events, scope: .all, activeInterests: fit)
        XCTAssertEqual(all.events.count, 2)
        XCTAssertFalse(all.isFiltering)
        let none = DIPInterestFilter.visibleEvents(events, scope: .matching, activeInterests: [])
        XCTAssertEqual(none.events.count, 2, "without active interests the filter cannot apply")
        XCTAssertFalse(none.isFiltering)
        let empty = DIPInterestFilter.visibleEvents([event("e2", ["music"])], scope: .matching, activeInterests: fit)
        XCTAssertEqual(empty.events, [])
        XCTAssertTrue(empty.isFiltering, "nothing matched: an empty result, not the full list")
    }

    func testScopeStorePersistsPerUserAndFallsBackToAll() {
        let suite = "dip.test.scope.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = DIPHomeScopeStore(defaults: defaults)
        XCTAssertEqual(store.scope(uid: "u1"), .all)
        store.save(.matching, uid: "u1")
        XCTAssertEqual(store.scope(uid: "u1"), .matching)
        XCTAssertEqual(store.scope(uid: "u2"), .all, "another member keeps their own choice")
        defaults.set("bogus", forKey: DIPHomeScopeStore.key(uid: "u3"))
        XCTAssertEqual(store.scope(uid: "u3"), .all)
        store.save(.matching, uid: "")
        XCTAssertEqual(store.scope(uid: ""), .all)
    }

    func testEventListsCarryTagIDsIntoSummaries() {
        let metadata = DIPEventMetadata(
            startTime: Date(timeIntervalSince1970: 2_000_000_100), endTime: Date(timeIntervalSince1970: 2_000_003_700),
            venueName: "v", address: "a", locality: "l", costCents: 0, capacity: 10)
        let detail = DIPEventDetail(id: "e", title: "E", image: .asset("x"), timing: "", description: "", tags: ["Fitness"],
                                    attendeeAvatars: [], metadata: metadata, tagIDs: ["fit"])
        let profile = DIPProfile(id: "p", displayName: "P", department: "", city: "", interestTagIDs: [], interestCatalog: [],
                                 photo: .asset("x"), avatar: .asset("x"), favoriteMemories: [])
        let snapshot = DIPAppSnapshot(
            home: DIPHomeSnapshot(unreadCount: 0, profileAvatar: .asset("x"), challenge: nil, events: [], recentAttendeeAvatars: []),
            activeEvents: [], memories: [], profile: profile, eventDetails: ["e": detail], participants: [:], albums: [:], messages: [:])
        let lists = DIPEventLists(snapshot: snapshot, now: Date(timeIntervalSince1970: 2_000_000_000))
        XCTAssertEqual(lists.discovery.map(\.tagIDs), [["fit"]])
    }
}

final class PointsFormatTests: XCTestCase {
    private let us = Locale(identifier: "en_US")

    func testBalanceFormatting() {
        XCTAssertEqual(DIPPointsFormat.balance(0, locale: us), "0 points")
        XCTAssertEqual(DIPPointsFormat.balance(1, locale: us), "1 point")
        XCTAssertEqual(DIPPointsFormat.balance(1_234, locale: us), "1,234 points")
        XCTAssertEqual(DIPPointsFormat.balance(520, locale: us), "520 points")
        XCTAssertEqual(DIPPointsFormat.number(1_234_567, locale: us), "1,234,567")
    }

    func testNegativeBalanceShowsAsZero() {
        XCTAssertEqual(DIPPointsFormat.balance(-5, locale: us), "0 points")
        XCTAssertEqual(DIPPointsFormat.number(-5, locale: us), "0")
    }
}
