import XCTest

/// Pill rule captures: solid = pressable, outline = informational.
final class PillRuleTests: XCTestCase {
    @MainActor private func capture(_ args: [String], wait id: String, name: String) {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = args
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)[id].waitForExistence(timeout: 10))
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor func testChallengeGoalRewardAreOutlinedPills() {
        capture(["--screen=challenge"], wait: "challenge.goal", name: "pill-challenge")
    }

    @MainActor func testHomeTitlePillAndEventCalendarPill() {
        capture(["--screen=home"], wait: "home.challenge", name: "pill-home")
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event", "--v1-event-fixtures"]
        app.launch()
        XCTAssertTrue(app.buttons["event.addToCalendar"].waitForExistence(timeout: 10))
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "pill-event"; shot.lifetime = .keepAlways; add(shot)
    }
}
