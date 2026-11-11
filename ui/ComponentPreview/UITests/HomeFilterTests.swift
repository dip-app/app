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
}
