import XCTest

final class ChatBellTests: XCTestCase {
    @MainActor func testBellMenuChangesThePerEventLevel() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event-joined"]
        app.launch()
        XCTAssertTrue(app.buttons["event.primary"].waitForExistence(timeout: 10))
        app.buttons["event.primary"].tap()
        let bell = app.buttons["event.chat.notifications"]
        XCTAssertTrue(bell.waitForExistence(timeout: 5))
        XCTAssertEqual(bell.label, "Notifications: Changes")
        bell.tap()
        let none = app.buttons["event.chat.notifications.none"]
        XCTAssertTrue(none.waitForExistence(timeout: 3))
        let menu = XCTAttachment(screenshot: app.screenshot())
        menu.name = "chat-bell-menu"; menu.lifetime = .keepAlways; add(menu)
        none.tap()
        XCTAssertTrue(app.buttons["Notifications: None"].waitForExistence(timeout: 3))
    }
}
