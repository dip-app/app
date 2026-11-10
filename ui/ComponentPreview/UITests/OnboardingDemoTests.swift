import XCTest

/// The onboarding DemoStage with the B1 Discover & Join scene, hosted by `--onboarding-demo=discover`.
final class OnboardingDemoTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor private func launch(_ arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--onboarding-demo=discover"] + arguments
        app.launch()
        return app
    }

    @MainActor private func stage(_ app: XCUIApplication) -> XCUIElement {
        let stage = app.descendants(matching: .any)["onboarding.stage"]
        XCTAssertTrue(stage.waitForExistence(timeout: 10))
        return stage
    }

    @MainActor private func waitForPhase(_ app: XCUIApplication, _ phase: String, timeout: TimeInterval = 15) {
        let label = app.staticTexts["onboarding.demo.phase"]
        let predicate = NSPredicate(format: "label == %@", phase)
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: label)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: timeout), .completed,
                       "phase stayed \(label.exists ? label.label : "missing") instead of \(phase)")
    }

    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    @MainActor func testStageIsOneElementThatAutoplaysRestsAndReplays() {
        let app = launch(["-onboarding.timeScale", "2"])
        let stage = stage(app)
        XCTAssertEqual(stage.label, "Example")
        XCTAssertTrue((stage.value as? String)?.contains("Opening Pasta Night") == true)
        // Exactly one element: nothing inside the canvas is exposed.
        XCTAssertFalse(app.buttons["home.event.onboarding.demo.pasta-night"].exists)
        XCTAssertFalse(app.buttons["event.primary"].exists)
        XCTAssertFalse(app.staticTexts["Who’s Attending"].exists)
        XCTAssertEqual(stage.descendants(matching: .any).count, 0)
        // Plays once, then rests (6.4 s at 2×).
        waitForPhase(app, "playing", timeout: 5)
        waitForPhase(app, "resting", timeout: 15)
        // Tapping the Stage replays from the start.
        stage.tap()
        waitForPhase(app, "playing", timeout: 3)
        waitForPhase(app, "resting", timeout: 15)
    }

    @MainActor func testHorizontalDragScrubsAndResumes() {
        let app = launch(["-onboarding.timeScale", "2"])
        let stage = stage(app)
        waitForPhase(app, "resting", timeout: 20)
        let start = stage.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5))
        let end = stage.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: end)
        // Dragging left from the end scrubs back; release resumes playback to the rest frame.
        waitForPhase(app, "playing", timeout: 3)
        waitForPhase(app, "resting", timeout: 15)
    }

    @MainActor func testReduceMotionShowsStillsThenRests() {
        let app = launch(["-onboarding.reduceMotion", "-onboarding.timeScale", "2"])
        _ = stage(app)
        waitForPhase(app, "still 0", timeout: 5)
        waitForPhase(app, "still 1", timeout: 5)
        waitForPhase(app, "still 2", timeout: 5)
        waitForPhase(app, "resting", timeout: 5)
        stage(app).tap()
        waitForPhase(app, "still 0", timeout: 3)
    }

    /// Captures for side-by-side review with the Figma frames (spec §7: discover@0.30, @3.80, @6.40 and
    /// the Reduce Motion stills). Saved as attachments; not a pixel gate.
    @MainActor func testFreezeAtCaptures() {
        let captures: [(String, [String])] = [
            ("onboarding-discover-beat1-0.30", ["-onboarding.freezeAt", "discover@0.3"]),
            ("onboarding-discover-beat4-3.80", ["-onboarding.freezeAt", "discover@3.8"]),
            ("onboarding-discover-beat6-final", ["-onboarding.freezeAt", "discover@final"]),
            ("onboarding-discover-reduced-1-feed", ["-onboarding.reduceMotion", "-onboarding.freezeAt", "discover@1.1"]),
            ("onboarding-discover-reduced-2-event", ["-onboarding.reduceMotion", "-onboarding.freezeAt", "discover@3.79"]),
            ("onboarding-discover-reduced-3-joined", ["-onboarding.reduceMotion", "-onboarding.freezeAt", "discover@final"]),
        ]
        for (name, arguments) in captures {
            let app = launch(arguments)
            _ = stage(app)
            waitForPhase(app, "frozen", timeout: 5)
            sleep(1)  // let images decode before the capture
            capture(app, name)
            app.terminate()
        }
    }
}
