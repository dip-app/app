import XCTest

final class MemberEventsFlowTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    @MainActor func testCompanyFeedOpensExistingDetailAndUnavailableRSVPDoesNotJoin() {
        let app = XCUIApplication(); app.launchArguments = ["--member-events"]; app.launch()
        let event = app.buttons["home.event.company-event-1"]
        XCTAssertTrue(event.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["home.event.EventCard"].exists)
        XCTAssertFalse(app.buttons["home.challenge"].exists)
        XCTAssertTrue(app.staticTexts["Upcoming events"].exists)
        XCTAssertFalse(event.label.contains("attending"), "No attendee count on an event nobody has joined")
        XCTAssertFalse(app.staticTexts["0 Attending"].exists)
        event.tap()
        XCTAssertTrue(app.staticTexts["event.title"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["event.title"].label, "COMPANY LUNCH")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "1 Test Street")).firstMatch.exists)
        XCTAssertTrue(app.descendants(matching: .any)["event.directions"].exists, "Directions fills the slot beside Share before joining")
        XCTAssertFalse(app.buttons["event.join"].exists, "The bottom bar is the only Join action")
        let join = app.buttons["event.primary"]
        XCTAssertTrue(join.exists); join.tap()
        XCTAssertTrue(app.alerts["Not available yet"].waitForExistence(timeout: 3))
        app.alerts.buttons["OK"].tap()
        XCTAssertFalse(app.buttons["event.leave"].exists)
        XCTAssertEqual(join.label, "Join the Activity")
        let capture = XCTAttachment(screenshot: app.screenshot()); capture.name = "member-company-event-details"; capture.lifetime = .keepAlways; add(capture)
    }
}
