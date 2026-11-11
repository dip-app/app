import XCTest

/// Shake to report. The simulator shake is delivered with XCUIDevice's private `_shake`; `--open-bug-report` opens
/// the same sheet without it (design review). Reports go to the in-memory submitter; `--bugreport-*` flags choose
/// its outcome.
final class BugReportFlowTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func launch(_ arguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    @MainActor private func shake() {
        XCUIDevice.shared.perform(NSSelectorFromString("_shake"))
    }

    @MainActor func testShakeOpensSheetAndAReportIsSent() {
        let app = launch()
        XCTAssertTrue(app.buttons["home.tab.Home"].waitForExistence(timeout: 10))
        shake()
        XCTAssertTrue(element(app, "report.sheet").waitForExistence(timeout: 10), "a shake opens the report sheet")
        XCTAssertTrue(element(app, "report.thumbnail").exists, "the screenshot was captured before the sheet")
        let send = app.buttons["report.send"]
        XCTAssertTrue(send.waitForExistence(timeout: 5))
        XCTAssertFalse(send.isEnabled, "nothing to send yet")
        app.buttons["report.category.bug"].tap()
        XCTAssertTrue(send.isEnabled)
        send.tap()
        XCTAssertTrue(app.buttons["report.sent"].waitForExistence(timeout: 10), "success state")
        // The sheet closes by itself.
        XCTAssertTrue(element(app, "report.sheet").waitForNonExistence(timeout: 10))
    }

    @MainActor func testDescriptionAloneEnablesSendAfterTenCharacters() {
        let app = launch(["--open-bug-report"])
        let field = element(app, "report.description")
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("short")
        XCTAssertFalse(app.buttons["report.send"].isEnabled)
        field.typeText(" and now long enough")
        XCTAssertTrue(app.buttons["report.send"].isEnabled)
    }

    @MainActor func testOfflineReportIsQueued() {
        let app = launch(["--open-bug-report", "--bugreport-offline"])
        XCTAssertTrue(element(app, "report.sheet").waitForExistence(timeout: 10))
        app.buttons["report.category.idea"].tap()
        app.buttons["report.send"].tap()
        XCTAssertTrue(app.buttons["report.queued"].waitForExistence(timeout: 10), "queued state")
    }

    @MainActor func testFailureKeepsDraftAndOffersTryAgain() {
        let app = launch(["--open-bug-report", "--bugreport-fail"])
        XCTAssertTrue(element(app, "report.sheet").waitForExistence(timeout: 10))
        app.buttons["report.category.confusing"].tap()
        app.buttons["report.send"].tap()
        XCTAssertTrue(element(app, "report.error").waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["report.retry"].exists)
        XCTAssertEqual(app.buttons["report.category.confusing"].isSelected, true, "the draft is kept")
    }

    @MainActor func testRateLimitedOffersClose() {
        let app = launch(["--open-bug-report", "--bugreport-ratelimited"])
        XCTAssertTrue(element(app, "report.sheet").waitForExistence(timeout: 10))
        app.buttons["report.category.bug"].tap()
        app.buttons["report.send"].tap()
        XCTAssertTrue(app.buttons["report.close"].waitForExistence(timeout: 10))
    }

    @MainActor func testScreenshotCanBeLeftOutAndDiagnosticsExpand() {
        let app = launch(["--open-bug-report"])
        XCTAssertTrue(element(app, "report.sheet").waitForExistence(timeout: 10))
        let toggle = app.switches["report.screenshot.toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        toggle.tap()
        XCTAssertEqual(toggle.value as? String, "0")
        XCTAssertTrue(app.staticTexts["Screenshot won’t be sent."].exists)
        XCTAssertTrue(element(app, "report.included").exists)
        XCTAssertTrue(element(app, "report.privacy").exists)
    }

    @MainActor func testClosingWithContentAsksBeforeDiscarding() {
        let app = launch(["--open-bug-report"])
        XCTAssertTrue(element(app, "report.sheet").waitForExistence(timeout: 10))
        app.buttons["report.category.looksWrong"].tap()
        app.buttons["report.close.button"].tap()
        XCTAssertTrue(app.buttons["Keep editing"].waitForExistence(timeout: 5))
        app.buttons["Discard"].tap()
        XCTAssertTrue(element(app, "report.sheet").waitForNonExistence(timeout: 10))
    }

    @MainActor func testProfileEntryOpensTheSameSheet() {
        let app = launch(["--screen=profile"])
        let entry = app.buttons["profile.reportProblem"]
        XCTAssertTrue(entry.waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "profile.shakeToReport").exists)
        entry.tap()
        XCTAssertTrue(element(app, "report.sheet").waitForExistence(timeout: 10))
    }
}
