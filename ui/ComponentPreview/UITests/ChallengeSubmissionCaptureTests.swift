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

    private func openSheet(_ app: XCUIApplication) {
        XCTAssertTrue(app.buttons["submission.action"].waitForExistence(timeout: 10))
        app.buttons["submission.action"].tap()
        XCTAssertTrue(app.buttons["submission.send"].waitForExistence(timeout: 5))
    }

    @MainActor func testPageStates() {
        continueAfterFailure = true
        for (state, name, scroll) in [("none", "01-no-entry-bar-only", 0), ("pending", "02-pending-large-photo", 3), ("approved", "03-approved", 3),
                                      ("rejected", "04-needs-changes", 3), ("missed", "05-closed-no-entry", 0), ("upcoming", "06-upcoming", 0),
                                      ("loading", "07-loading", 3), ("load-failed", "08-load-error", 3)] {
            let app = launch(state)
            _ = element(app, "challenge.how").waitForExistence(timeout: 10)
            for _ in 0..<scroll { app.swipeUp() }
            sleep(1)
            snap(app, name)
            app.terminate()
        }
    }

    @MainActor func testSheetStates() {
        continueAfterFailure = true
        var app = launch("none")
        openSheet(app)
        snap(app, "09-sheet-new-entry")
        app.buttons["submission.progress.increase"].tap()
        app.swipeUp()
        snap(app, "10-sheet-new-entry-scrolled")
        app.terminate()

        app = launch("none", extra: ["--submission-photo"])
        openSheet(app)
        app.buttons["submission.progress.increase"].tap()
        app.swipeUp()
        snap(app, "11-sheet-photo-ready")
        app.terminate()

        app = launch("none", extra: ["--submission-photo", "--submission-slow"])
        openSheet(app)
        app.buttons["submission.send"].tap()
        sleep(3)
        snap(app, "12-sheet-uploading")
        app.terminate()

        app = launch("none", extra: ["--submission-photo", "--submission-upload-fail"])
        openSheet(app)
        app.buttons["submission.send"].tap()
        _ = element(app, "submission.error").waitForExistence(timeout: 8)
        sleep(1)
        snap(app, "13-sheet-upload-failed")
        app.terminate()

        app = launch("none", extra: ["--submission-fail=1", "--submission-offline"])
        openSheet(app)
        app.buttons["submission.send"].tap()
        _ = element(app, "submission.error").waitForExistence(timeout: 8)
        sleep(1)
        snap(app, "14-sheet-offline")
        app.terminate()

        app = launch("rejected")
        openSheet(app)
        sleep(1)
        snap(app, "15-sheet-resubmit-top")
        app.swipeUp(); app.swipeUp()
        sleep(1)
        snap(app, "16-sheet-resubmit-existing-photo")
        app.terminate()

        app = launch("rejected", extra: ["--submission-evidence-fail=100"])
        openSheet(app)
        app.swipeUp(); app.swipeUp()
        sleep(1)
        snap(app, "17-sheet-existing-photo-failed")
        app.terminate()
    }
}
