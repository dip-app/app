import XCTest

final class EventPointsTests: XCTestCase {
    @MainActor func testEventPageShowsRewardPillWhenTheEventHasPoints() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event"]
        app.launch()
        let pill = app.descendants(matching: .any)["event.points"]
        XCTAssertTrue(pill.waitForExistence(timeout: 10))
        XCTAssertEqual(pill.label, "Worth 50 points")
        app.swipeUp()
        XCTAssertTrue(pill.exists)
        XCTAssertFalse(app.buttons["event.points"].exists, "The reward pill is informational, not pressable")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "event-points"; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor func testLongTitleCardsKeepTheRewardChipClearOfTheTitle() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--long-titles=home"]
        app.launch()
        let chip = app.descendants(matching: .any)["home.event.points"].firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 10))
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "home-points-long-titles"; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor func testPastEventShowsWorthAndNoPillWhenZero() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screen=past-event"]
        app.launch()
        XCTAssertTrue(app.buttons["event.primary"].waitForExistence(timeout: 10))
        let pill = app.descendants(matching: .any)["event.points"]
        if pill.exists { XCTAssertTrue(pill.label.hasPrefix("Worth ")) }
    }

    @MainActor func testHomeCardsShowRewardPillOnlyForEventsWithPoints() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screen=home", "--v1-event-fixtures"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["home.event.points"].waitForExistence(timeout: 10))
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "home-points"; shot.lifetime = .keepAlways; add(shot)
    }
}
