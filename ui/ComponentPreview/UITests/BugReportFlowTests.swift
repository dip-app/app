import XCTest

/// Shake to report. XCUITest has no public shake, so these tests open the same sheet with `--open-bug-report`; the
/// real shake was driven with `simctl spawn notifyutil -p com.apple.UIKit.SimulatorShake` (see the PR). Reports go to the in-memory submitter; `--bugreport-*` flags choose
/// its outcome.
final class BugReportFlowTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func launch(_ arguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        return app
    }

    /// Design-review screenshots: written only when /tmp/dip-c-shots exists (a local review run).
    @MainActor private func snap(_ name: String) {
        let folder = "/tmp/dip-c-shots"
        guard FileManager.default.fileExists(atPath: folder) else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(folder)/\(name).png"))
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    @MainActor func testReportIsSentAndTheSheetCloses() {
        let app = launch(["--open-bug-report"])
        XCTAssertTrue(element(app, "report.sheet").waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "report.thumbnail").exists, "the screenshot was captured before the sheet")
        let send = app.buttons["report.send"]
        XCTAssertTrue(send.waitForExistence(timeout: 5))
        XCTAssertFalse(send.isEnabled, "nothing to send yet")
        snap("10-empty")
        app.buttons["report.category.bug"].tap()
        XCTAssertTrue(send.isEnabled)
        let field = element(app, "report.description")
        field.tap()
        field.typeText("Tapped Join but the button kept spinning")
        snap("11-filled")
        send.tap()
        snap("12-sending")
        XCTAssertTrue(app.buttons["report.sent"].waitForExistence(timeout: 10), "success state")
        snap("13-sent")
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
        snap("14-queued")
    }

    @MainActor func testFailureKeepsDraftAndOffersTryAgain() {
        let app = launch(["--open-bug-report", "--bugreport-fail"])
        XCTAssertTrue(element(app, "report.sheet").waitForExistence(timeout: 10))
        app.buttons["report.category.confusing"].tap()
        app.buttons["report.send"].tap()
        XCTAssertTrue(element(app, "report.error").waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["report.retry"].exists)
        snap("15-failed")
        XCTAssertEqual(app.buttons["report.category.confusing"].isSelected, true, "the draft is kept")
    }

    @MainActor func testRateLimitedOffersClose() {
        let app = launch(["--open-bug-report", "--bugreport-ratelimited"])
        XCTAssertTrue(element(app, "report.sheet").waitForExistence(timeout: 10))
        app.buttons["report.category.bug"].tap()
        app.buttons["report.send"].tap()
        XCTAssertTrue(app.buttons["report.close"].waitForExistence(timeout: 10))
        snap("16-ratelimited")
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
        snap("17-screenshot-off")
        app.swipeUp()
        element(app, "report.included").tap()
        snap("18-included")
    }

    @MainActor func testClosingWithContentAsksBeforeDiscarding() {
        let app = launch(["--open-bug-report"])
        XCTAssertTrue(element(app, "report.sheet").waitForExistence(timeout: 10))
        app.buttons["report.category.looksWrong"].tap()
        app.buttons["report.close.button"].tap()
        // On iPhone the confirmation shows as a popover: Discard is a button; Keep editing is a tap outside.
        XCTAssertTrue(app.buttons["Discard"].waitForExistence(timeout: 5))
        app.buttons["Discard"].tap()
        XCTAssertTrue(element(app, "report.sheet").waitForNonExistence(timeout: 10))
    }

    @MainActor func testProfileEntryOpensTheSameSheet() {
        let app = launch(["--screen=profile"])
        let entry = app.buttons["profile.reportProblem"]
        XCTAssertTrue(entry.waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "profile.shakeToReport").exists)
        app.swipeUp()
        snap("19-profile")
        entry.tap()
        XCTAssertTrue(element(app, "report.sheet").waitForExistence(timeout: 10))
    }

    @MainActor func testShakeAsksBeforeOpeningTheReport() {
        let app = launch(["--screen=home", "--simulate-shake"])
        let alert = app.alerts["Report a problem?"]
        XCTAssertTrue(alert.waitForExistence(timeout: 10), "a shake asks first")
        alert.buttons["Not now"].tap()
        XCTAssertFalse(element(app, "report.sheet").exists)
    }

    @MainActor func testShakeQuestionLeadsToTheSheetWithTheScreenshot() {
        let app = launch(["--screen=home", "--simulate-shake"])
        let alert = app.alerts["Report a problem?"]
        XCTAssertTrue(alert.waitForExistence(timeout: 10))
        alert.buttons["Report"].tap()
        XCTAssertTrue(element(app, "report.sheet").waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "report.thumbnail").exists)
    }

    @MainActor func testMarkupCanBeDrawnUndoneAndKept() {
        let app = launch(["--open-bug-report"])
        XCTAssertTrue(element(app, "report.sheet").waitForExistence(timeout: 10))
        let markup = app.buttons["report.markup"]
        XCTAssertTrue(markup.waitForExistence(timeout: 5))
        markup.tap()
        let canvas = element(app, "markup.canvas")
        XCTAssertTrue(canvas.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["markup.undo"].isEnabled, "nothing drawn yet")
        let start = canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.3))
        start.press(forDuration: 0.05, thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.6)))
        XCTAssertTrue(app.buttons["markup.undo"].isEnabled)
        app.buttons["markup.undo"].tap()
        XCTAssertFalse(app.buttons["markup.undo"].isEnabled)
        start.press(forDuration: 0.05, thenDragTo: canvas.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.7)))
        app.buttons["markup.done"].tap()
        XCTAssertTrue(app.buttons["report.markup"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["report.markup"].label, "Edit markup")
    }
}
