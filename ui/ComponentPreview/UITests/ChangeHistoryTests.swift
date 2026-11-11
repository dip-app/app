import XCTest

final class ChangeHistoryTests: XCTestCase {
    @MainActor func testChangesButtonOpensTheSheetNewestFirst() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event"]
        app.launch()
        let button = app.buttons["event.changes"]
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        app.swipeUp(); app.swipeUp()
        let page = XCTAttachment(screenshot: app.screenshot())
        page.name = "changes-button"; page.lifetime = .keepAlways; add(page)
        button.tap()
        XCTAssertTrue(app.descendants(matching: .any)["event.changes.sheet"].waitForExistence(timeout: 5))
        let first = app.descendants(matching: .any)["event.changes.entry.0"]
        XCTAssertTrue(first.waitForExistence(timeout: 3))
        XCTAssertTrue(first.label.contains("Location"), "Newest edit (location, cost, spots) comes first: \(first.label)")
        XCTAssertTrue(app.descendants(matching: .any)["event.changes.entry.1"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["event.changes.entry.1"].label.contains("Time"))
        let sheet = XCTAttachment(screenshot: app.screenshot())
        sheet.name = "changes-sheet"; sheet.lifetime = .keepAlways; add(sheet)
        app.buttons["event.changes.done"].tap()
        XCTAssertTrue(app.buttons["event.changes"].waitForExistence(timeout: 3))
    }

    @MainActor func testSheetStatesEmptySingleAndLong() {
        continueAfterFailure = false
        for (mode, expected) in [("empty", "empty.event-changes"), ("single", "event.changes.entry.0"), ("long", "event.changes.entry.6")] {
            let app = XCUIApplication()
            app.launchArguments = ["--changes-sheet=\(mode)"]
            app.launch()
            XCTAssertTrue(app.descendants(matching: .any)[expected].waitForExistence(timeout: 10), mode)
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = "changes-sheet-\(mode)"; shot.lifetime = .keepAlways; add(shot)
            app.terminate()
        }
    }

    @MainActor func testEventWithoutEditsHasNoChangesButton() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screen=past-event"]
        app.launch()
        XCTAssertTrue(app.buttons["event.primary"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["event.changes"].exists)
    }
}
