import XCTest

/// Weekly-theme entry flow (F3) against the in-memory source: states, the full submit path, the count control and retry.
/// The one entry action is the shared bottom-bar pill (`submission.action` on the page, `submission.send` in the sheet).
final class ChallengeSubmissionTests: XCTestCase {
    private func launch(_ state: String, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--challenge-submission=\(state)", "--fake-calendar"] + extra
        app.launch()
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement { app.descendants(matching: .any)[id] }

    private func scrollToSection(_ app: XCUIApplication) {
        XCTAssertTrue(element(app, "submission.section").waitForExistence(timeout: 10))
        for _ in 0..<3 { app.swipeUp() }
    }

    @MainActor func testNoEntryShowsOnlyTheSharedBarActionAndNoSection() {
        continueAfterFailure = false
        let app = launch("none")
        XCTAssertTrue(element(app, "challenge.how").waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "challenge.goal").exists)
        XCTAssertTrue(element(app, "challenge.reward").exists)
        XCTAssertTrue(app.buttons["submission.action"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["submission.action"].label, "Add your entry")
        for _ in 0..<2 { app.swipeUp() }
        XCTAssertFalse(element(app, "submission.section").exists, "no placeholder section without an entry")
        XCTAssertFalse(element(app, "submission.status").exists)
    }

    @MainActor func testFullSubmitPathEndsPendingReview() {
        continueAfterFailure = false
        let app = launch("none")
        XCTAssertTrue(app.buttons["submission.action"].waitForExistence(timeout: 10))
        app.buttons["submission.action"].tap()
        XCTAssertTrue(element(app, "submission.progress.value").waitForExistence(timeout: 5))
        // Above the form: requirement, window and reward.
        XCTAssertTrue(element(app, "submission.explain").exists)
        XCTAssertTrue(element(app, "submission.facts").exists)
        app.buttons["submission.progress.increase"].tap()
        XCTAssertEqual(element(app, "submission.progress.value").label, "2 of 3 workouts")
        XCTAssertTrue(app.buttons["submission.send"].exists, "the shared bar button is the only send action")
        app.buttons["submission.send"].tap()
        XCTAssertTrue(element(app, "submission.status").waitForExistence(timeout: 8))
        XCTAssertEqual(element(app, "submission.status").label, "Entry status: Waiting for review")
        XCTAssertFalse(element(app, "submission.progress.value").exists)
    }

    @MainActor func testCountControlStaysWithinOneStepAndTheGoal() {
        continueAfterFailure = false
        let app = launch("none")
        XCTAssertTrue(app.buttons["submission.action"].waitForExistence(timeout: 10))
        app.buttons["submission.action"].tap()
        let decrease = app.buttons["submission.progress.decrease"]
        let increase = app.buttons["submission.progress.increase"]
        XCTAssertTrue(decrease.waitForExistence(timeout: 5))
        XCTAssertFalse(decrease.isEnabled, "a new entry starts at the smallest step")
        increase.tap(); increase.tap()
        XCTAssertFalse(increase.isEnabled, "the goal is the maximum")
        decrease.tap()
        XCTAssertEqual(element(app, "submission.progress.value").label, "2 of 3 workouts")
        XCTAssertFalse(app.keyboards.element.exists, "no keyboard for the count")
    }

    @MainActor func testOfflineFailureKeepsTheDraftAndRetrySucceeds() {
        continueAfterFailure = false
        let app = launch("none", extra: ["--submission-fail=1", "--submission-offline"])
        XCTAssertTrue(app.buttons["submission.action"].waitForExistence(timeout: 10))
        app.buttons["submission.action"].tap()
        XCTAssertTrue(app.buttons["submission.progress.increase"].waitForExistence(timeout: 5))
        app.buttons["submission.progress.increase"].tap()
        app.buttons["submission.send"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "offline")).firstMatch.waitForExistence(timeout: 8))
        XCTAssertEqual(element(app, "submission.progress.value").label, "2 of 3 workouts", "the draft survives a failure")
        app.buttons["submission.send"].tap()
        XCTAssertTrue(element(app, "submission.status").waitForExistence(timeout: 8))
        XCTAssertEqual(element(app, "submission.status").label, "Entry status: Waiting for review")
    }

    @MainActor func testPendingCanBeEditedAndShowsALargePhoto() {
        continueAfterFailure = false
        let app = launch("pending")
        scrollToSection(app)
        XCTAssertEqual(element(app, "submission.status").label, "Entry status: Waiting for review")
        let photo = app.buttons["submission.photo.preview"]
        XCTAssertTrue(photo.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(photo.frame.width, 300, "the submitted photo is shown at full content width")
        XCTAssertGreaterThan(photo.frame.height, 200)
        photo.tap()
        XCTAssertTrue(element(app, "submission.photo.viewer").waitForExistence(timeout: 5))
        app.buttons["submission.photo.viewer.close"].tap()
        XCTAssertEqual(app.buttons["submission.action"].label, "Edit entry")
        app.buttons["submission.action"].tap()
        XCTAssertEqual(element(app, "submission.progress.value").waitForExistence(timeout: 5) ? element(app, "submission.progress.value").label : "", "2 of 3 workouts")
    }

    @MainActor func testRejectedShowsTheNoteAndTheExistingPhotoWithReplaceAndRemove() {
        continueAfterFailure = false
        let app = launch("rejected")
        scrollToSection(app)
        XCTAssertEqual(element(app, "submission.status").label, "Entry status: Needs changes")
        XCTAssertTrue(element(app, "submission.organizer-note").label.contains("too dark"))
        XCTAssertEqual(app.buttons["submission.action"].label, "Update and resubmit")
        app.buttons["submission.action"].tap()
        XCTAssertTrue(element(app, "submission.organizer-note").waitForExistence(timeout: 5))
        XCTAssertTrue(element(app, "submission.existing").waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["submission.existing.replace"].exists)
        XCTAssertTrue(app.buttons["submission.photo.remove"].exists)
        XCTAssertEqual(app.buttons["submission.send"].label, "Resubmit entry")
    }

    @MainActor func testExistingPhotoFailureOffersRetry() {
        continueAfterFailure = false
        let app = launch("rejected", extra: ["--submission-evidence-fail=3"])
        XCTAssertTrue(app.buttons["submission.action"].waitForExistence(timeout: 10))
        app.buttons["submission.action"].tap()
        // Two scripted failures: the status card's read and the sheet's read; the retry then succeeds.
        let retry = app.buttons["submission.existing.retry"]
        XCTAssertTrue(retry.waitForExistence(timeout: 8))
        retry.tap()
        XCTAssertTrue(element(app, "submission.existing.preview").waitForExistence(timeout: 8))
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

    @MainActor func testClosedThemeWithoutEntryShowsNothingToPress() {
        continueAfterFailure = false
        let app = launch("missed")
        XCTAssertTrue(element(app, "challenge.how").waitForExistence(timeout: 10))
        XCTAssertFalse(element(app, "submission.section").exists)
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
