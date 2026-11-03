import XCTest

final class HomeReferenceTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    @MainActor func testHomeReferenceGeometryAndFixtureActions() {
        let app = XCUIApplication()
        app.launchArguments = []
        app.launch()
        let challenge = app.buttons["home.challenge"]
        XCTAssertTrue(challenge.waitForExistence(timeout: 10))
        // Measured Figma positions, not values derived from the implementation.
        XCTAssertEqual(challenge.frame.minX, 20, accuracy: 0.5)
        XCTAssertEqual(challenge.frame.minY, 165, accuracy: 0.5)
        XCTAssertEqual(challenge.frame.width, app.frame.width - 40, accuracy: 0.5)
        XCTAssertEqual(challenge.frame.height, 225, accuracy: 0.5)
        let event = app.buttons["home.event.EventCard"]
        XCTAssertEqual(event.label, "Puppy Yoga, Lawrenceville, PA, 7 attending")
        XCTAssertEqual(event.frame.minX, 20, accuracy: 0.5)
        XCTAssertEqual(event.frame.minY, 442, accuracy: 0.5)
        XCTAssertEqual(event.frame.width, 163, accuracy: 0.5)
        XCTAssertEqual(event.frame.height, 205, accuracy: 0.5)
        let home = app.buttons["home.tab.Home"]
        XCTAssertEqual(home.frame.minY, app.frame.height - 101, accuracy: 0.5)
        XCTAssertEqual(home.frame.width, 80, accuracy: 0.5)
        XCTAssertTrue(home.isSelected)
        event.tap()
        XCTAssertTrue(app.buttons["event.back"].waitForExistence(timeout: 3))
        XCTAssertEqual(app.staticTexts["event.title"].label, "PUPPY YOGA")
        app.buttons["event.back"].tap()
        app.buttons["home.attendees"].tap()
        XCTAssertTrue(app.buttons["participants.back"].waitForExistence(timeout: 3))
    }

    @MainActor func testReferenceNavigationAndHorizontalEventsRemainInteractive() {
        let app = XCUIApplication()
        app.launchArguments = []
        app.launch()
        XCTAssertTrue(app.buttons["home.notifications"].waitForExistence(timeout: 10))
        app.buttons["home.notifications"].tap()
        XCTAssertTrue(app.staticTexts["Notifications is not connected yet."].waitForExistence(timeout: 3))
        app.alerts.buttons["OK"].tap()
        app.buttons["home.tab.My Events"].tap()
        XCTAssertTrue(app.buttons["events.card.puppy-yoga"].waitForExistence(timeout: 3))
        app.buttons["home.tab.Home"].tap()
        app.scrollViews["home.events"].swipeLeft()
        let hike = app.buttons["home.event.EventCard2"]
        XCTAssertTrue(hike.isHittable)
        hike.tap()
        XCTAssertTrue(app.buttons["event.back"].waitForExistence(timeout: 3))
        XCTAssertEqual(app.staticTexts["event.title"].label, "HIKE")
    }
}
