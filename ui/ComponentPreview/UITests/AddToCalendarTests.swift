import XCTest

final class AddToCalendarTests: XCTestCase {
    @MainActor func testGenericLabelVariantCapture() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event", "--v1-event-fixtures", "--calendar-label=generic"]
        app.launch()
        XCTAssertTrue(app.buttons["event.addToCalendar"].waitForExistence(timeout: 10))
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "event-add-to-calendar-generic"; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor func testManyLongTagsWrapAndStayVisible() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event", "--many-tags"]
        app.launch()
        let last = app.staticTexts["A really long interest name that needs wrapping"]
        XCTAssertTrue(last.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Yoga"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "event-many-tags"; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor func testAddToCalendarSendsEventFieldsToTheAdapter() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event", "--v1-event-fixtures", "--fake-calendar"]
        app.launch()
        let button = app.buttons["event.addToCalendar"]
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["calendar.fake.last"].label, "none")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "event-add-to-calendar"; shot.lifetime = .keepAlways; add(shot)
        button.tap()
        XCTAssertTrue(app.buttons["Added to calendar"].waitForExistence(timeout: 3))
        let recorded = app.staticTexts["calendar.fake.last"].label
        XCTAssertTrue(recorded.lowercased().hasPrefix("puppy yoga|"), recorded)
        XCTAssertTrue(recorded.split(separator: "|").dropFirst().first.map { $0.contains(",") } ?? false, recorded)
        XCTAssertTrue(recorded.hasSuffix("|5400|false"), recorded)
    }
}
