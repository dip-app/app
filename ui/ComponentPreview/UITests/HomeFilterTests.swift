import XCTest

/// Home's interest filter and the Rewards points balance, on the fixture member (see HomeFilterPreview).
final class HomeFilterTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor private func launch(_ mode: String, scope: String? = "matching", extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--home-filter=\(mode)"] + (scope.map { ["-dip.home.scope.elissa-woode", $0] } ?? []) + extra
        app.launch()
        return app
    }

    @MainActor private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    @MainActor func testMatchingScopeListsOnlyTaggedEventsAndAllEventsRestoresThem() {
        let app = launch("match")
        XCTAssertTrue(app.buttons["home.event.EventCard1"].waitForExistence(timeout: 10), "kayaking is tagged outdoors")
        XCTAssertTrue(app.buttons["home.event.EventCard2"].exists, "hike is tagged outdoors and fitness")
        XCTAssertFalse(app.buttons["home.event.EventCard"].exists, "puppy yoga is tagged animals only")
        XCTAssertEqual(element(app, "home.filter.count").label, "Showing 2 of 3 events")
        app.buttons["home.filter.all"].tap()
        XCTAssertTrue(app.buttons["home.event.EventCard"].waitForExistence(timeout: 5))
        XCTAssertFalse(element(app, "home.filter.count").exists, "the count and chips belong to the matching scope")
    }

    @MainActor func testNoMatchShowsTheDesignedEmptyStateWithAWayOut() {
        let app = launch("nomatch")
        XCTAssertTrue(element(app, "empty.home-filter").waitForExistence(timeout: 10))
        XCTAssertFalse(element(app, "home.filter.count").exists, "no count pill next to the empty state")
        app.buttons["empty.home-filter.action"].tap()
        XCTAssertTrue(app.buttons["home.event.EventCard"].waitForExistence(timeout: 5))
        XCTAssertFalse(element(app, "empty.home-filter").exists)
    }

    @MainActor func testFilteredEventOpensAndBackKeepsTheScope() {
        let app = launch("match")
        let kayaking = app.buttons["home.event.EventCard1"]
        XCTAssertTrue(kayaking.waitForExistence(timeout: 10))
        kayaking.tap()
        XCTAssertTrue(app.buttons["event.back"].waitForExistence(timeout: 5))
        app.buttons["event.back"].tap()
        XCTAssertTrue(element(app, "home.filter.count").waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["home.event.EventCard"].exists, "still filtered after returning")
    }

    @MainActor func testMemberWithoutKnownInterestsSeesNoFilterControl() {
        let app = launch("unknown", scope: nil)
        XCTAssertTrue(app.buttons["home.event.EventCard"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["home.filter.matching"].exists)
    }

    @MainActor func testRewardsShowsTheRealBalanceOrTheMockWhenThereIsNone() {
        let real = launch("match", scope: nil, extra: ["--screen=rewards", "--points=1234"])
        XCTAssertEqual(element(real, "rewards.balance").label, "Your balance: 1,234 points")
        real.terminate()
        let mock = XCUIApplication()
        mock.launchArguments = ["--screen=rewards"]
        mock.launch()
        XCTAssertEqual(element(mock, "rewards.balance").label, "Your balance: 520 points")
    }

    // MARK: Toggle style, motion and layout

    @MainActor func testToggleIsTheMyEventsToggleAndStaysPutWhileContentSwaps() {
        let app = launch("match")
        let matching = app.buttons["home.filter.matching"]
        XCTAssertTrue(matching.waitForExistence(timeout: 10))
        XCTAssertTrue(matching.isSelected, "selected trait on the active segment")
        XCTAssertFalse(app.buttons["home.filter.all"].isSelected)
        XCTAssertGreaterThanOrEqual(matching.frame.height, 44, "44pt minimum touch target")
        XCTAssertEqual(matching.frame.height, 50, accuracy: 1, "the shared 50pt toggle, not a smaller variant")
        let before = app.buttons["home.filter.all"].frame
        app.buttons["home.filter.all"].tap()
        XCTAssertTrue(app.buttons["home.event.EventCard"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["home.filter.all"].isSelected)
        XCTAssertFalse(matching.isSelected)
        XCTAssertEqual(app.buttons["home.filter.all"].frame, before, "the toggle does not move when the list changes")
    }

    @MainActor func testTwoMatchingCardsShareTheRowInEqualColumns() {
        let app = launch("match")
        let first = app.buttons["home.event.EventCard1"], second = app.buttons["home.event.EventCard2"]
        XCTAssertTrue(first.waitForExistence(timeout: 10))
        XCTAssertTrue(second.exists)
        XCTAssertEqual(first.frame.width, second.frame.width, accuracy: 1)
        XCTAssertEqual(first.frame.minX, 20, accuracy: 1)
        XCTAssertEqual(second.frame.maxX, app.frame.width - 20, accuracy: 1)
    }

    // MARK: Loading, failure, offline

    @MainActor func testLoadingShowsASkeletonNotTheEmptyState() {
        let app = launch("match", scope: nil, extra: ["--home-events-state=loading"])
        XCTAssertTrue(element(app, "home.events.loading").waitForExistence(timeout: 10))
        XCTAssertFalse(element(app, "empty.home-events").exists)
        XCTAssertFalse(app.buttons["home.event.EventCard"].exists)
    }

    @MainActor func testFailedShowsAnInlineRetryAndKeepsTheToggle() {
        let app = launch("match", scope: nil, extra: ["--home-events-state=failed"])
        XCTAssertTrue(element(app, "home.events.failure").waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["home.filter.all"].exists, "the rest of Home stays usable")
    }

    @MainActor func testOfflineKeepsTheCachedListWithAnOfflineLabel() {
        let app = launch("match", extra: ["--home-events-state=offline"])
        XCTAssertTrue(app.buttons["home.event.EventCard1"].waitForExistence(timeout: 10))
        XCTAssertEqual(element(app, "home.events.stale").label, "Offline. Showing the last update.")
    }

    // MARK: Rewards points

    @MainActor func testZeroPointsShowsTheNudgeWithAWayToEarn() {
        let app = launch("match", scope: nil, extra: ["--screen=rewards", "--points=0"])
        XCTAssertTrue(element(app, "rewards.zero").waitForExistence(timeout: 10))
        XCTAssertEqual(element(app, "rewards.balance").label, "Your balance: 0 points")
        XCTAssertTrue(app.buttons["rewards.zero.action"].exists)
        app.terminate()
        let some = launch("match", scope: nil, extra: ["--screen=rewards", "--points=5"])
        XCTAssertTrue(element(some, "rewards.balance").waitForExistence(timeout: 10))
        XCTAssertFalse(element(some, "rewards.zero").exists)
    }

    @MainActor func testPointsPillLoadingUnavailableAndOfflineVariants() {
        let loading = launch("match", scope: nil, extra: ["--screen=rewards", "--points-state=loading"])
        XCTAssertEqual(element(loading, "rewards.balance").label, "Loading your points")
        loading.terminate()
        let unavailable = launch("match", scope: nil, extra: ["--screen=rewards", "--points-state=unavailable"])
        XCTAssertTrue(element(unavailable, "rewards.balance").waitForExistence(timeout: 10))
        XCTAssertTrue(element(unavailable, "rewards.balance").label.contains("unavailable"))
        XCTAssertFalse(element(unavailable, "rewards.zero").exists)
        unavailable.terminate()
        let stale = launch("match", scope: nil, extra: ["--screen=rewards", "--points-state=stale", "--points=40"])
        XCTAssertTrue(element(stale, "rewards.balance").waitForExistence(timeout: 10))
        XCTAssertTrue(element(stale, "rewards.balance").label.contains("Offline"))
    }
}
