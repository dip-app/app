import XCTest

/// Profile > Notifications in Debug mock-member mode: the push flag (`--push-enabled`), a fake permission
/// (`--notifications-push=authorized|denied|undetermined`) and the in-memory preferences repository. Nothing is
/// requested from the system and nothing leaves the device.
final class NotificationSettingsUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func launch(permission: String, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--mock-member", "--push-enabled", "--notifications-push=\(permission)"] + extra
        app.launch()
        return app
    }

    private func openSettings(_ app: XCUIApplication) {
        let profile = app.buttons["Profile"]
        XCTAssertTrue(profile.waitForExistence(timeout: 20))
        profile.tap()
        let row = app.buttons["profile.notifications"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "Profile has no Notifications row")
        row.tap()
        XCTAssertTrue(app.otherElements["notificationSettings.screen"].waitForExistence(timeout: 10)
                      || app.switches["notificationSettings.toggle.chat"].waitForExistence(timeout: 10))
    }

    func testToggleStaysChangedAfterLeavingAndComingBack() {
        let app = launch(permission: "authorized")
        openSettings(app)
        let chat = app.switches["notificationSettings.toggle.chat"]
        XCTAssertTrue(chat.waitForExistence(timeout: 10))
        XCTAssertEqual(chat.value as? String, "1", "chat defaults to on")
        chat.tap()
        XCTAssertEqual(chat.value as? String, "0")
        // Away and back: the screen reloads from the repository.
        let close = app.buttons["Close"].firstMatch
        XCTAssertTrue(close.waitForExistence(timeout: 10))
        close.tap()
        XCTAssertTrue(app.buttons["profile.notifications"].waitForExistence(timeout: 10))
        app.buttons["profile.notifications"].tap()
        let again = app.switches["notificationSettings.toggle.chat"]
        XCTAssertTrue(again.waitForExistence(timeout: 10))
        XCTAssertEqual(again.value as? String, "0", "the change was not kept")
        // Other categories were not touched.
        XCTAssertEqual(app.switches["notificationSettings.toggle.invites"].value as? String, "1")
    }

    func testDeniedPermissionShowsTheSettingsShortcutAndDisablesSwitches() {
        let app = launch(permission: "denied")
        openSettings(app)
        XCTAssertTrue(app.staticTexts["Notifications are off in iOS Settings"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["notificationSettings.master.action"].exists)
        let chat = app.switches["notificationSettings.toggle.chat"]
        XCTAssertTrue(chat.exists)
        XCTAssertFalse(chat.isEnabled)
    }

    func testFailedSaveRevertsTheSwitchAndShowsAnError() {
        let app = launch(permission: "authorized", extra: ["--notification-settings=save-failed"])
        openSettings(app)
        let reminders = app.switches["notificationSettings.toggle.reminders"]
        XCTAssertTrue(reminders.waitForExistence(timeout: 10))
        reminders.tap()
        XCTAssertTrue(app.otherElements["notificationSettings.error"].waitForExistence(timeout: 10)
                      || app.staticTexts["Couldn’t save that change. Check your connection and try again."].waitForExistence(timeout: 10))
        XCTAssertEqual(reminders.value as? String, "1", "a failed save puts the switch back")
    }
}
