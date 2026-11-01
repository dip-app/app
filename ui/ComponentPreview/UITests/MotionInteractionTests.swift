import XCTest

final class MotionInteractionTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor func testPersistentNavigationAndActionStates() {
        let app = XCUIApplication()
        app.launchArguments = []
        app.launch()
        let home = app.buttons["home.tab.Home"]
        XCTAssertTrue(home.waitForExistence(timeout: 10))
        let fixedY = home.frame.minY
        XCTAssertEqual(fixedY, app.frame.height - 101, accuracy: 0.5)

        app.buttons["home.tab.My Events"].tap()
        XCTAssertTrue(app.buttons["events.card.puppy-yoga"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["home.tab.My Events"].isSelected)
        XCTAssertEqual(home.frame.minY, fixedY, accuracy: 0.5)
        app.buttons["events.segment.memories"].tap()
        XCTAssertTrue(app.buttons["events.album.0"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["events.segment.memories"].isSelected)
        app.buttons["events.segment.active"].tap()
        XCTAssertTrue(app.buttons["events.card.puppy-yoga"].waitForExistence(timeout: 5))

        app.buttons["home.tab.Profile"].tap()
        XCTAssertTrue(app.buttons["profile.edit"].waitForExistence(timeout: 5))
        XCTAssertEqual(home.frame.minY, fixedY, accuracy: 0.5)
        app.buttons["home.tab.Home"].tap()
        XCTAssertTrue(app.buttons["home.challenge"].waitForExistence(timeout: 5))
        app.buttons["home.event.EventCard"].tap()
        let action = app.buttons["event.primary"]
        XCTAssertTrue(action.waitForExistence(timeout: 5))
        // The base nav remains mounted under the action overlay.
        XCTAssertFalse(home.isEnabled)
        XCTAssertFalse(home.isHittable)
        XCTAssertEqual(action.frame.minY, fixedY, accuracy: 0.5)
        XCTAssertEqual(action.frame.height, 80, accuracy: 0.5)
        action.tap()
        XCTAssertEqual(action.label, "Activity Chat")
        XCTAssertEqual(action.frame.minY, fixedY, accuracy: 0.5)
        app.buttons["event.back"].tap()
        XCTAssertTrue(home.waitForExistence(timeout: 5))
        XCTAssertTrue(home.isSelected)
        XCTAssertEqual(home.frame.minY, fixedY, accuracy: 0.5)
    }
    @MainActor func testBottomActionPressKeepsItsSurface() {
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event-joined"]
        app.launch()
        let action = app.buttons["event.primary"]
        XCTAssertTrue(action.waitForExistence(timeout: 10))
        XCTAssertEqual(action.label, "Activity Chat")
        action.press(forDuration: 1.5)
        XCTAssertTrue(app.descendants(matching: .any)["event.chat.message"].waitForExistence(timeout: 5))
    }

}
