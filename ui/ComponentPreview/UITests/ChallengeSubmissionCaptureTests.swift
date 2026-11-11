import XCTest

/// Review captures for the design audit (no Figma frame exists for the entry flow): one screenshot per state.
final class ChallengeSubmissionCaptureTests: XCTestCase {
    private func launch(_ state: String, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--challenge-submission=\(state)", "--fake-calendar"] + extra
        app.launch()
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement { app.descendants(matching: .any)[id] }

    private func snap(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = name; shot.lifetime = .keepAlways; add(shot)
    }

    private func scrollToSection(_ app: XCUIApplication) {
        XCTAssertTrue(element(app, "submission.section").waitForExistence(timeout: 10))
        for _ in 0..<3 { app.swipeUp() }
    }

    @MainActor func testSectionStates() {
        continueAfterFailure = true
        for (state, name) in [("none", "01-not-started"), ("pending", "02-pending"), ("approved", "03-approved"),
                              ("rejected", "04-needs-changes"), ("missed", "05-closed"), ("upcoming", "06-upcoming"),
                              ("loading", "07-loading"), ("load-failed", "08-load-error")] {
            let app = launch(state)
            scrollToSection(app)
            if state == "pending" { sleep(1) }
            snap(app, name)
            app.terminate()
        }
    }

    @MainActor func testSheetStates() {
        continueAfterFailure = true
        // Empty sheet, then with the validation issue.
        var app = launch("none")
        scrollToSection(app)
        app.buttons["submission.action"].tap()
        XCTAssertTrue(app.buttons["submission.send"].waitForExistence(timeout: 5))
        snap(app, "09-sheet-empty")
        app.buttons["submission.send"].tap()
        sleep(1)
        snap(app, "10-sheet-validation")
        app.terminate()

        // Photo picked, ready to send.
        app = launch("none", extra: ["--submission-photo"])
        scrollToSection(app)
        app.buttons["submission.action"].tap()
        let field = app.textFields["submission.progress"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap(); field.typeText("2")
        app.swipeUp()
        snap(app, "11-sheet-photo-ready")
        app.terminate()

        // Photo upload in progress.
        app = launch("none", extra: ["--submission-photo", "--submission-slow"])
        scrollToSection(app)
        app.buttons["submission.action"].tap()
        let progress = app.textFields["submission.progress"]
        XCTAssertTrue(progress.waitForExistence(timeout: 5))
        progress.tap(); progress.typeText("2")
        app.buttons["submission.send"].tap()
        _ = element(app, "submission.progress.status").waitForExistence(timeout: 5)
        sleep(2)
        snap(app, "12-sheet-uploading")
        app.terminate()

        // Upload failed (offline), draft kept, retry available.
        app = launch("none", extra: ["--submission-photo", "--submission-upload-fail"])
        scrollToSection(app)
        app.buttons["submission.action"].tap()
        let failing = app.textFields["submission.progress"]
        XCTAssertTrue(failing.waitForExistence(timeout: 5))
        failing.tap(); failing.typeText("2")
        app.buttons["submission.send"].tap()
        _ = element(app, "submission.error").waitForExistence(timeout: 8)
        snap(app, "13-sheet-upload-failed")
        app.terminate()

        // Send failed (offline) after a note-only draft.
        app = launch("none", extra: ["--submission-fail=1", "--submission-offline"])
        scrollToSection(app)
        app.buttons["submission.action"].tap()
        let offline = app.textFields["submission.progress"]
        XCTAssertTrue(offline.waitForExistence(timeout: 5))
        offline.tap(); offline.typeText("1")
        app.buttons["submission.send"].tap()
        _ = element(app, "submission.error").waitForExistence(timeout: 8)
        snap(app, "14-sheet-offline")
        app.terminate()

        // Resubmit sheet for a rejected entry.
        app = launch("rejected")
        scrollToSection(app)
        app.buttons["submission.action"].tap()
        XCTAssertTrue(app.buttons["submission.send"].waitForExistence(timeout: 5))
        snap(app, "15-sheet-resubmit")
        app.terminate()
    }
}
