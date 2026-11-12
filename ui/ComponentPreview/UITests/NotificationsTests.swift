import XCTest

/// The notifications center against the fixture repository (no Firebase): the bell opens it (badge = unread),
/// rows are grouped by day, opening a row marks it read, "Mark all as read" clears the badge, and Invitations
/// are one tap away. `--notifications-state=empty|loading|failed|many|mark-failed|more-failed` and
/// `--notifications-push=undetermined|denied` select the review variants.
final class NotificationsTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func launch(_ arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        return app
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    @MainActor func testBellBadgeCountsUnreadAndOpensTheCenterGroupedByDay() {
        let app = launch([])
        let bell = app.buttons["home.notifications"]
        XCTAssertTrue(bell.waitForExistence(timeout: 20))
        XCTAssertTrue(bell.label.contains("4 unread"), "four unread fixture notifications, got \(bell.label)")
        bell.tap()
        XCTAssertTrue(app.descendants(matching: .any)["notifications.section.today"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["notifications.section.yesterday"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["notifications.section.earlier"].exists)
        XCTAssertTrue(app.buttons["notifications.row.invite_e1_me"].label.hasPrefix("Unread: "))
        XCTAssertTrue(app.buttons["notifications.invitations"].exists)
        shot("notifications-list")
    }

    @MainActor func testOpeningAnEventNotificationMarksItReadAndGoesToTheEvent() {
        let app = launch(["--screen=notifications"])
        let row = app.buttons["notifications.row.event_e2_5"]
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        XCTAssertTrue(row.label.hasPrefix("Unread: "))
        row.tap()
        XCTAssertTrue(app.descendants(matching: .any)["notifications.screen"].waitForNonExistence(timeout: 10), "the center closes when a row opens its place")
    }

    @MainActor func testMarkAllAsReadClearsTheUnreadStyleAndTheBadge() {
        let app = launch(["--screen=notifications"])
        let markAll = app.buttons["notifications.markall"]
        XCTAssertTrue(markAll.waitForExistence(timeout: 20))
        markAll.tap()
        XCTAssertTrue(markAll.waitForNonExistence(timeout: 10), "nothing left to mark")
        XCTAssertFalse(app.buttons["notifications.row.invite_e1_me"].label.hasPrefix("Unread: "))
        shot("notifications-all-read")
    }

    @MainActor func testInvitationsButtonOpensInvitations() {
        let app = launch(["--screen=notifications"])
        let button = app.buttons["notifications.invitations"]
        XCTAssertTrue(button.waitForExistence(timeout: 20))
        button.tap()
        XCTAssertTrue(app.buttons["invitations.accept.e1_me"].waitForExistence(timeout: 10))
    }

    @MainActor func testEmptyLoadingAndFailedStates() {
        var app = launch(["--screen=notifications", "--notifications-state=empty"])
        XCTAssertTrue(app.descendants(matching: .any)["empty.notifications"].waitForExistence(timeout: 20))
        shot("notifications-empty")
        app.terminate()
        app = launch(["--screen=notifications", "--notifications-state=loading"])
        XCTAssertTrue(app.descendants(matching: .any)["notifications.loading"].waitForExistence(timeout: 20))
        shot("notifications-loading")
        app.terminate()
        app = launch(["--screen=notifications", "--notifications-state=failed"])
        XCTAssertTrue(app.buttons["empty.notifications-error.action"].waitForExistence(timeout: 20))
        shot("notifications-error")
    }

    @MainActor func testLoadMorePagesInOlderNotifications() {
        let app = launch(["--screen=notifications", "--notifications-state=many"])
        let more = app.buttons["notifications.more"]
        XCTAssertTrue(more.waitForExistence(timeout: 20))
        shot("notifications-load-more")
    }

    @MainActor func testPermissionBannerShowsWhenPushIsOffAndTurnsOnFromTheCenter() {
        let app = launch(["--screen=notifications", "--notifications-push=undetermined"])
        let action = app.buttons["notifications.permission.action"]
        XCTAssertTrue(action.waitForExistence(timeout: 20))
        shot("notifications-permission")
        action.tap()
        XCTAssertTrue(action.waitForNonExistence(timeout: 10), "the banner goes away once permission is on")
    }

    @MainActor func testNoBannerWithoutThePushClient() {
        let app = launch(["--screen=notifications"])
        XCTAssertTrue(app.buttons["notifications.markall"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.descendants(matching: .any)["notifications.permission"].exists)
    }
}
