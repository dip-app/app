import XCTest
@testable import DIPCore

final class HomeEventsPresentationTests: XCTestCase {
    private func resolve(
        _ phase: DIPHomeEventsPhase = .ready, active: Bool = true, scope: DIPHomeEventScope = .matching,
        visible: Int = 0, total: Int = 0, more: Bool = false
    ) -> DIPHomeEventsContent {
        .resolve(phase: phase, filterActive: active, scope: scope, visibleCount: visible, totalCount: total, canLoadMore: more)
    }

    func testVisibleEventsAlwaysWin() {
        XCTAssertEqual(resolve(.loading, visible: 2, total: 3), .list)
        XCTAssertEqual(resolve(.failed("x"), visible: 1, total: 1), .list)
        XCTAssertEqual(resolve(.offline, visible: 1, total: 1), .list, "offline keeps the cached list")
    }

    func testLoadingAndFailureOnlyReplaceAnEmptyList() {
        XCTAssertEqual(resolve(.loading), .skeleton)
        XCTAssertEqual(resolve(.failed("Couldn’t load"), scope: .all), .failure("Couldn’t load"))
    }

    func testEmptyFilteredNeedsAnActiveMatchingFilterWithLoadedEvents() {
        XCTAssertEqual(resolve(total: 3), .emptyFiltered(canLoadMore: false))
        XCTAssertEqual(resolve(total: 3, more: true), .emptyFiltered(canLoadMore: true))
        XCTAssertEqual(resolve(scope: .all, total: 3), .emptyAll)
        XCTAssertEqual(resolve(active: false, total: 3), .emptyAll)
        XCTAssertEqual(resolve(total: 0), .emptyAll, "nothing loaded is not a filter miss")
    }

    func testKeyChangesWhenTheScopeChangesTheList() {
        XCTAssertNotEqual(DIPHomeEventsContent.list.key(scope: .all), DIPHomeEventsContent.list.key(scope: .matching))
        XCTAssertEqual(DIPHomeEventsContent.skeleton.key(scope: .all), "skeleton")
        XCTAssertEqual(DIPHomeEventsContent.emptyFiltered(canLoadMore: true).key(scope: .matching), "empty.filtered")
    }

    func testEqualColumnsOnlyForExactlyTwoCards() {
        XCTAssertEqual(DIPHomeCardLayout.equalColumnWidth(count: 2, available: 353), 171)
        XCTAssertEqual(DIPHomeCardLayout.equalColumnWidth(count: 2, available: 350, spacing: 10), 170)
        XCTAssertNil(DIPHomeCardLayout.equalColumnWidth(count: 1, available: 353))
        XCTAssertNil(DIPHomeCardLayout.equalColumnWidth(count: 3, available: 353))
        XCTAssertNil(DIPHomeCardLayout.equalColumnWidth(count: 2, available: 0))
    }

    func testAnnouncementNamesScopeAndCounts() {
        XCTAssertEqual(DIPHomeFilterAnnouncement.text(scope: .matching, shown: 2, total: 3),
                       "Matching your interests. Showing 2 of 3 events.")
        XCTAssertEqual(DIPHomeFilterAnnouncement.text(scope: .matching, shown: 0, total: 3),
                       "Matching your interests. No events match.")
        XCTAssertEqual(DIPHomeFilterAnnouncement.text(scope: .all, shown: 3, total: 3), "All events. 3 events.")
        XCTAssertEqual(DIPHomeFilterAnnouncement.text(scope: .all, shown: 1, total: 1), "All events. 1 event.")
    }

    func testPointsDisplayLabelsAndZeroNudge() {
        let us = Locale(identifier: "en_US")
        XCTAssertEqual(DIPPointsDisplay.balance(1234).accessibilityLabel(locale: us), "Your balance: 1,234 points")
        XCTAssertEqual(DIPPointsDisplay.loading.accessibilityLabel(locale: us), "Loading your points")
        XCTAssertTrue(DIPPointsDisplay.stale(5).accessibilityLabel(locale: us).contains("Offline"))
        XCTAssertTrue(DIPPointsDisplay.unavailable.accessibilityLabel(locale: us).contains("unavailable"))
        XCTAssertTrue(DIPPointsDisplay.balance(0).showsZeroNudge)
        XCTAssertFalse(DIPPointsDisplay.balance(1).showsZeroNudge)
        XCTAssertFalse(DIPPointsDisplay.stale(0).showsZeroNudge, "an unconfirmed zero is not a nudge")
        XCTAssertFalse(DIPPointsDisplay.loading.showsZeroNudge)
        XCTAssertFalse(DIPPointsDisplay.unavailable.showsZeroNudge)
    }
}
