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

    @MainActor func testInviteBesideShareAndLeaveAtBottom() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event-joined", "--v1-event-fixtures"]
        app.launch()
        XCTAssertTrue(app.buttons["event.invite"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.descendants(matching: .any)["event.directions"].exists, "Directions lives on the Where row")
        XCTAssertTrue(app.buttons["event.share"].exists)
        XCTAssertEqual(app.buttons["event.invite"].frame.minY, app.buttons["event.share"].frame.minY, accuracy: 1, "one row of two pills")
        let row = XCTAttachment(screenshot: app.screenshot())
        row.name = "event-action-row"; row.lifetime = .keepAlways; add(row)
        app.swipeUp(); app.swipeUp()
        XCTAssertTrue(app.buttons["event.leave"].exists)
        let bottom = XCTAttachment(screenshot: app.screenshot())
        bottom.name = "event-leave-bottom"; bottom.lifetime = .keepAlways; add(bottom)
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

    @MainActor func testWhenRowAddsToCalendarLikeTheHeaderPill() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event", "--v1-event-fixtures", "--fake-calendar"]
        app.launch()
        let row = app.buttons["event.when"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        app.swipeUp()
        XCTAssertGreaterThanOrEqual(row.frame.height, 44)
        XCTAssertEqual(app.staticTexts["calendar.fake.last"].label, "none")
        let before = XCTAttachment(screenshot: app.screenshot())
        before.name = "event-info-rows"; before.lifetime = .keepAlways; add(before)
        row.tap()
        XCTAssertTrue(app.buttons["Added to calendar"].waitForExistence(timeout: 3))
        let recorded = app.staticTexts["calendar.fake.last"].label
        XCTAssertTrue(recorded.lowercased().hasPrefix("puppy yoga|"), recorded)
        XCTAssertTrue(recorded.hasSuffix("|5400|false"), recorded)
        XCTAssertFalse(app.buttons["event.when"].isEnabled, "Row is spent once added, like the header pill")
    }

    @MainActor func testWhereRowOpensDirections() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event", "--v1-event-fixtures", "--fake-directions"]
        app.launch()
        let row = app.descendants(matching: .any)["event.where"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        app.swipeUp()
        XCTAssertGreaterThanOrEqual(row.frame.height, 44)
        row.tap()
        let rowTarget = app.staticTexts["directions.fake.last"].label
        XCTAssertTrue(rowTarget.hasPrefix("https://maps.apple.com/"), rowTarget)
    }

    @MainActor func testPriceRowStaysInformational() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event", "--v1-event-fixtures"]
        app.launch()
        XCTAssertTrue(app.buttons["event.when"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["event.price"].exists)
        XCTAssertFalse(app.buttons["event.price"].exists)
        XCTAssertFalse(app.links["event.price"].exists)
    }

    @MainActor func testPastEventRowsAreInformational() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screen=past-event"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["event.metadata"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["event.when"].exists)
        XCTAssertFalse(app.buttons["event.where"].exists)
        XCTAssertFalse(app.links["event.where"].exists)
    }
}
