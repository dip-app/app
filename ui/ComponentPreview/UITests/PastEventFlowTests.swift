import XCTest

final class PastEventFlowTests: XCTestCase {
    @MainActor func testPastEventAlbumAndAttendees() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screen=past-event"]
        app.launch()
        let primary = app.buttons["event.primary"]
        XCTAssertTrue(primary.waitForExistence(timeout: 10))
        XCTAssertEqual(primary.label, "View Album")
        XCTAssertEqual(app.staticTexts["event.title"].label, "KAYAKING")
        XCTAssertTrue(app.staticTexts["Who Attended"].exists)
        XCTAssertFalse(app.buttons["event.join"].exists)
        let detail = XCTAttachment(screenshot: app.screenshot())
        detail.name = "past-event-detail"; detail.lifetime = .keepAlways; add(detail)
        app.swipeUp()
        let photo = app.buttons["event.album.photo.0"]
        XCTAssertTrue(photo.waitForExistence(timeout: 3))
        let photos = XCTAttachment(screenshot: app.screenshot())
        photos.name = "past-event-photos"; photos.lifetime = .keepAlways; add(photos)
        photo.tap()
        XCTAssertTrue(app.buttons["album.back"].waitForExistence(timeout: 3))
        app.buttons["album.back"].tap()
        app.swipeDown()
        app.buttons["event.attendees"].tap()
        XCTAssertTrue(app.buttons["participants.back"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["participants.album"].exists)
        XCTAssertFalse(app.buttons["participants.chat"].exists)
        let people = XCTAttachment(screenshot: app.screenshot())
        people.name = "past-event-attendees"; people.lifetime = .keepAlways; add(people)
        app.buttons["participants.album"].tap()
        XCTAssertTrue(app.buttons["album.back"].waitForExistence(timeout: 3))
    }
}
