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
        // A fresh install (the mock member has no finished tour record) opens on the onboarding tour, which covers the
        // shell and takes its taps; skip it the way a member would before using the tab bar.
        // Skip can land on the interests step ("Skip for now"), and the tour draws its own copy of the tab bar, so keep
        // skipping (bounded) until the tour's title is gone.
        XCTAssertTrue(app.buttons["home.tab.Profile"].firstMatch.waitForExistence(timeout: 20))
        let tourTitle = app.staticTexts["onboarding.tour.title"]
        let skipTour = app.buttons["onboarding.tour.skip"]
        let skipInterests = app.buttons["onboarding.interests.skip"]
        if skipTour.waitForExistence(timeout: 5) || skipInterests.exists {
            for _ in 0..<4 where tourTitle.exists {
                if skipInterests.exists { skipInterests.tap() } else if skipTour.exists { skipTour.tap() }
                _ = tourTitle.waitForNonExistence(timeout: 4)
            }
            XCTAssertTrue(tourTitle.waitForNonExistence(timeout: 10), "the onboarding tour did not close")
        }
        let profile = app.buttons["home.tab.Profile"]
        // The tour's closing reveal still holds the shell's taps for a moment after Skip disappears, so a tap can be
        // swallowed: tap until the Profile tab is selected (bounded), then require it.
        let selected = NSPredicate(format: "isSelected == true")
        for _ in 0..<3 where !profile.isSelected {
            profile.tap()
            _ = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: selected, object: profile)], timeout: 3)
        }
        XCTAssertTrue(profile.isSelected, "the Profile tab did not open")
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
        XCTAssertTrue(app.staticTexts["Push is off"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["notificationSettings.master.action"].exists)
        let chat = app.switches["notificationSettings.toggle.chat"]
        XCTAssertTrue(chat.exists)
        XCTAssertFalse(chat.isEnabled)
    }

    func testEmailSectionShowsAndKeepsReminderChoiceEvenWhenPushIsDenied() {
        let app = launch(permission: "denied")
        openSettings(app)
        let reminders = app.switches["notificationSettings.email.toggle.reminders"]
        XCTAssertTrue(reminders.waitForExistence(timeout: 10))
        XCTAssertTrue(reminders.isEnabled, "email does not depend on push permission")
        XCTAssertEqual(reminders.value as? String, "0", "email reminders default to off")
        XCTAssertTrue(app.switches["notificationSettings.email.toggle.invites"].exists)
        XCTAssertFalse(app.switches["notificationSettings.email.toggle.chat"].exists)
        XCTAssertFalse(app.switches["notificationSettings.email.toggle.social"].exists)
        XCTAssertFalse(app.switches["notificationSettings.email.toggle.discovery"].exists)
        reminders.tap()
        XCTAssertEqual(reminders.value as? String, "1")
    }

    func testOptInEmailRowsAreOffAndTheDigestIsForAdminsOnly() {
        let member = launch(permission: "authorized")
        openSettings(member)
        let weekly = member.switches["notificationSettings.email.toggle.weekly_themes"]
        XCTAssertTrue(weekly.waitForExistence(timeout: 10))
        XCTAssertEqual(weekly.value as? String, "0", "the weekly challenge email is opt in")
        let dayBefore = member.switches["notificationSettings.email.toggle.day_before_reminders"]
        XCTAssertTrue(dayBefore.exists)
        XCTAssertEqual(dayBefore.value as? String, "1", "the day-before reminder email is on by default")
        XCTAssertFalse(member.switches["notificationSettings.toggle.day_before_reminders"].exists, "email only")
        XCTAssertFalse(member.switches["notificationSettings.email.toggle.admin_digest"].exists, "members never see the admin digest")
        XCTAssertFalse(member.switches["notificationSettings.toggle.weekly_themes"].exists, "email only")
        member.terminate()

        let admin = launch(permission: "authorized", extra: ["--notification-settings-admin"])
        openSettings(admin)
        let digest = admin.switches["notificationSettings.email.toggle.admin_digest"]
        XCTAssertTrue(digest.waitForExistence(timeout: 10))
        XCTAssertEqual(digest.value as? String, "0", "the admin digest is opt in")
        XCTAssertTrue(admin.switches["notificationSettings.email.toggle.weekly_themes"].exists)
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
