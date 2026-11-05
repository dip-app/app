import XCTest

final class MemberEventsFlowTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    @MainActor func testCompanyFeedOpensExistingDetailAndUnavailableRSVPDoesNotJoin() {
        let app = XCUIApplication(); app.launchArguments = ["--member-events"]; app.launch()
        let event = app.buttons["home.event.company-event-1"]
        XCTAssertTrue(event.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["home.event.EventCard"].exists)
        XCTAssertFalse(app.buttons["home.challenge"].exists)
        event.tap()
        XCTAssertTrue(app.staticTexts["event.title"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["event.title"].label, "COMPANY LUNCH")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "1 Test Street")).firstMatch.exists)
        let join = app.buttons["event.primary"]
        XCTAssertTrue(join.exists); join.tap()
        XCTAssertTrue(app.alerts["Not available yet"].waitForExistence(timeout: 3))
        app.alerts.buttons["OK"].tap()
        XCTAssertFalse(app.buttons["event.leave"].exists)
        XCTAssertEqual(join.label, "Join the Activity")
        let capture = XCTAttachment(screenshot: app.screenshot()); capture.name = "member-company-event-details"; capture.lifetime = .keepAlways; add(capture)
    }
}
