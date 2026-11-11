import XCTest

/// Weekly-theme entry flow (F3) against the in-memory source: states, the full submit path, validation and retry.
final class ChallengeSubmissionTests: XCTestCase {
    private func launch(_ state: String, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--challenge-submission=\(state)", "--fake-calendar"] + extra
        app.launch()
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement { app.descendants(matching: .any)[id] }

    private func scrollToSection(_ app: XCUIApplication) {
        let section = element(app, "submission.section")
        XCTAssertTrue(section.waitForExistence(timeout: 10))
        var swipes = 0
        while !app.buttons["submission.action"].isHittable, swipes < 6, app.buttons["submission.action"].exists || swipes < 2 {
            app.swipeUp(); swipes += 1
        }
    }

    @MainActor func testNotStartedShowsExplanationAndOneSolidAction() {
        continueAfterFailure = false
        let app = launch("none")
        XCTAssertTrue(element(app, "challenge.how").waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "challenge.goal").exists)
        XCTAssertTrue(element(app, "challenge.reward").exists)
        scrollToSection(app)
        XCTAssertEqual(element(app, "submission.status").label, "Entry status: Not started")
        XCTAssertTrue(app.buttons["submission.action"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "submission-none"; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor func testFullSubmitPathEndsPendingReview() {
        continueAfterFailure = false
        let app = launch("none")
        scrollToSection(app)
        app.buttons["submission.action"].tap()
        let progress = app.textFields["submission.progress"]
        XCTAssertTrue(progress.waitForExistence(timeout: 5))
        // Above the form: requirement, window and reward.
        XCTAssertTrue(element(app, "submission.explain").exists)
        XCTAssertTrue(element(app, "submission.facts").exists)
        progress.tap(); progress.typeText("2")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "submission-sheet"; shot.lifetime = .keepAlways; add(shot)
        app.buttons["submission.send"].tap()
        XCTAssertTrue(element(app, "submission.section").waitForExistence(timeout: 5))
        XCTAssertTrue(element(app, "submission.status").waitForExistence(timeout: 5))
        XCTAssertEqual(element(app, "submission.status").label, "Entry status: Waiting for review")
        XCTAssertFalse(app.textFields["submission.progress"].exists)
    }

    @MainActor func testInvalidProgressShowsAnInlineIssueAndSendsNothing() {
        continueAfterFailure = false
        let app = launch("none")
        scrollToSection(app)
        app.buttons["submission.action"].tap()
        XCTAssertTrue(app.buttons["submission.send"].waitForExistence(timeout: 5))
        app.buttons["submission.send"].tap()
        XCTAssertTrue(element(app, "submission.progress.issue").waitForExistence(timeout: 3))
        let field = app.textFields["submission.progress"]
        field.tap(); field.typeText("9")
        app.buttons["submission.send"].tap()
        XCTAssertTrue(element(app, "submission.progress.issue").label.contains("more than"))
        XCTAssertTrue(app.textFields["submission.progress"].exists)
    }

    @MainActor func testOfflineFailureKeepsTheDraftAndRetrySucceeds() {
        continueAfterFailure = false
        let app = launch("none", extra: ["--submission-fail=1", "--submission-offline"])
        scrollToSection(app)
        app.buttons["submission.action"].tap()
        let field = app.textFields["submission.progress"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap(); field.typeText("1")
        app.buttons["submission.send"].tap()
        XCTAssertTrue(element(app, "submission.error").waitForExistence(timeout: 5))
        XCTAssertTrue(element(app, "submission.error").label.contains("offline"))
        XCTAssertEqual(app.textFields["submission.progress"].value as? String, "1", "the draft survives a failure")
        app.buttons["submission.send"].tap()
        XCTAssertTrue(element(app, "submission.status").waitForExistence(timeout: 5))
        XCTAssertEqual(element(app, "submission.status").label, "Entry status: Waiting for review")
    }

    @MainActor func testPendingCanBeEditedWhileOpen() {
        continueAfterFailure = false
        let app = launch("pending")
        scrollToSection(app)
        XCTAssertEqual(element(app, "submission.status").label, "Entry status: Waiting for review")
        XCTAssertEqual(app.buttons["submission.action"].label, "Edit entry")
        app.buttons["submission.action"].tap()
        XCTAssertEqual(app.textFields["submission.progress"].waitForExistence(timeout: 5) ? app.textFields["submission.progress"].value as? String : nil, "2")
    }

    @MainActor func testRejectedShowsTheOrganizerNoteAndAllowsResubmission() {
        continueAfterFailure = false
        let app = launch("rejected")
        scrollToSection(app)
        XCTAssertEqual(element(app, "submission.status").label, "Entry status: Needs changes")
        XCTAssertTrue(element(app, "submission.detail").label.contains("too dark"))
        XCTAssertEqual(app.buttons["submission.action"].label, "Update and resubmit")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "submission-rejected"; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor func testApprovedShowsPointsAndNoAction() {
        continueAfterFailure = false
        let app = launch("approved")
        XCTAssertTrue(element(app, "submission.section").waitForExistence(timeout: 10))
        app.swipeUp()
        XCTAssertEqual(element(app, "submission.status").label, "Entry status: Approved")
        XCTAssertTrue(element(app, "submission.detail").label.contains("+50 points"))
        XCTAssertFalse(app.buttons["submission.action"].exists)
    }

    @MainActor func testClosedThemeWithoutEntryOffersNoAction() {
        continueAfterFailure = false
        let app = launch("missed")
        XCTAssertTrue(element(app, "submission.section").waitForExistence(timeout: 10))
        app.swipeUp()
        XCTAssertEqual(element(app, "submission.status").label, "Entry status: Closed")
        XCTAssertFalse(app.buttons["submission.action"].exists)
    }

    @MainActor func testLoadErrorOffersRetryInPlace() {
        continueAfterFailure = false
        let app = launch("load-failed")
        XCTAssertTrue(element(app, "submission.section").waitForExistence(timeout: 10))
        app.swipeUp()
        XCTAssertTrue(element(app, "empty.submission-load").waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["empty.submission-load.action"].exists)
    }

    @MainActor func testLoadingShowsASkeleton() {
        continueAfterFailure = false
        let app = launch("loading")
        XCTAssertTrue(element(app, "submission.section").waitForExistence(timeout: 10))
        app.swipeUp()
        XCTAssertTrue(element(app, "submission.loading").exists)
        XCTAssertFalse(app.buttons["submission.action"].exists)
    }
}
