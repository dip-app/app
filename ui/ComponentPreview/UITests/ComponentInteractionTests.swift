import XCTest

final class ComponentInteractionTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    @MainActor func testCallbacksAndNativeTabs() {
        let app = XCUIApplication()
        app.launchArguments.append("--gallery")
        app.launch()
        let card = app.buttons["foundation.event-card"]
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        XCTAssertEqual(card.label, "Puppy Yoga, Thu, Nov 5 · 6:30–7:30 PM, Lawrenceville, PA, 7 attending")
        XCTAssertEqual(card.value as? String, "Joined")
        card.tap()
        XCTAssertEqual(app.staticTexts["foundation.callback-message"].label, "Event details callback")
        app.swipeUp()
        let action = app.buttons["foundation.primary-action"]
        XCTAssertTrue(action.waitForExistence(timeout: 3))
        action.tap()
        XCTAssertEqual(app.staticTexts["foundation.callback-count"].label, "Action callbacks: 1")
        XCTAssertFalse(app.buttons["foundation.disabled-action"].isEnabled)
        app.switches["foundation.loading-toggle"].tap()
        XCTAssertFalse(action.isEnabled)
        XCTAssertEqual(action.value as? String, "In progress")
        app.tabBars.buttons["My Events"].tap()
        XCTAssertTrue(app.tabBars.buttons["My Events"].isSelected)
        XCTAssertTrue(app.staticTexts["No joined events"].waitForExistence(timeout: 3))
        app.tabBars.buttons["Profile"].tap()
        XCTAssertTrue(app.tabBars.buttons["Profile"].isSelected)
        XCTAssertTrue(app.staticTexts["Profile preview"].waitForExistence(timeout: 3))
    }
    @MainActor func testProfileAndRetryCallbacksHideUnavailableActions() {
        let app = XCUIApplication()
        app.launchArguments.append("--gallery")
        app.launch()
        let profile = app.buttons["Open profile for Alex Morgan"]
        XCTAssertTrue(profile.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Notifications"].exists)
        profile.tap()
        XCTAssertEqual(app.staticTexts["foundation.callback-message"].label, "Profile callback")
        let retry = app.buttons["Reload events"]
        for _ in 0..<10 where !retry.isHittable { app.swipeUp() }
        XCTAssertTrue(retry.isHittable)
        retry.tap()
        XCTAssertEqual(app.staticTexts["foundation.callback-message"].label, "Retry callback")
    }
    @MainActor func testAccessibilityTextKeepsActionsReachable() {
        let app = XCUIApplication()
        app.launchArguments = ["--large-text"]
        app.launchArguments.append("--gallery")
        app.launch()
        XCTAssertTrue(app.buttons["foundation.event-card"].waitForExistence(timeout: 10))
        let card = app.buttons["foundation.event-card"]
        XCTAssertLessThanOrEqual(card.frame.maxX, app.frame.maxX + 1)
        let action = app.buttons["foundation.primary-action"]
        for _ in 0..<8 where !action.isHittable { app.swipeUp() }
        XCTAssertTrue(action.isHittable)
        action.tap()
        app.tabBars.buttons["My Events"].tap()
        XCTAssertTrue(app.tabBars.buttons["My Events"].isSelected)
        XCTAssertTrue(app.staticTexts["No joined events"].waitForExistence(timeout: 3))
    }
}
