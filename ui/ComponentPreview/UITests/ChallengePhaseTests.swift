import XCTest

final class ChallengePhaseTests: XCTestCase {
    private func launch(_ phase: String, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--challenge-phase=\(phase)", "--fake-calendar"] + extra
        app.launch()
        return app
    }

    @MainActor func testUpcomingShowsStartNoteAndSolidCalendarButton() {
        continueAfterFailure = false
        let app = launch("upcoming")
        XCTAssertTrue(app.descendants(matching: .any)["challenge.submissions"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["challenge.submissions"].label.hasPrefix("Starts "))
        XCTAssertTrue(app.buttons["challenge.addToCalendar"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "challenge-upcoming"; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor func testActiveAddsTheWholeWeekAsAnAllDayEvent() {
        continueAfterFailure = false
        let app = launch("active")
        let button = app.buttons["challenge.addToCalendar"]
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        XCTAssertEqual(app.descendants(matching: .any)["challenge.submissions"].label, "Submissions open soon")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "challenge-active"; shot.lifetime = .keepAlways; add(shot)
        button.tap()
        XCTAssertTrue(app.buttons["Added to calendar"].waitForExistence(timeout: 3))
        let recorded = app.staticTexts["calendar.fake.last"].label
        XCTAssertTrue(recorded.hasPrefix("Weekly theme: Fitness|"), recorded)
        XCTAssertTrue(recorded.hasSuffix("|true"), recorded)
    }

    @MainActor func testEndedHasNoCalendarButtonAndSaysSo() {
        continueAfterFailure = false
        let app = launch("ended")
        XCTAssertTrue(app.descendants(matching: .any)["challenge.submissions"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.descendants(matching: .any)["challenge.submissions"].label, "This weekly theme has ended")
        XCTAssertFalse(app.buttons["challenge.addToCalendar"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "challenge-ended"; shot.lifetime = .keepAlways; add(shot)
    }
}
