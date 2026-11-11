import XCTest

/// Design-review capture of mid-transition frames (not a regression test: it skips unless
/// `TEST_RUNNER_DIP_SHOT_DIR` names a folder). Animations are slowed with `--animation-speed`.
final class TransitionFramesCapture: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipUnless(Self.dir != nil, "capture only")
    }

    private static var dir: String? { ProcessInfo.processInfo.environment["DIP_SHOT_DIR"] }

    private func shot(_ name: String) {
        guard let dir = Self.dir else { return }
        let data = XCUIScreen.main.screenshot().pngRepresentation
        try? data.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
    }

    @MainActor func testHomeFilterSwitchFrames() {
        let app = XCUIApplication()
        app.launchArguments = ["--home-filter=match", "-dip.home.scope.elissa-woode", "matching", "--animation-speed=0.12"]
        app.launch()
        XCTAssertTrue(app.buttons["home.event.EventCard1"].waitForExistence(timeout: 10))
        Thread.sleep(forTimeInterval: 1.5)
        shot("home-switch-0-before")
        app.buttons["home.filter.all"].tap()
        for step in 1...3 { Thread.sleep(forTimeInterval: 0.25); shot("home-switch-\(step)") }
        Thread.sleep(forTimeInterval: 3)
        shot("home-switch-4-after")
    }

    @MainActor func testMyEventsSwipeFrames() {
        let app = XCUIApplication()
        app.launchArguments = ["--screen=events"]
        app.launch()
        XCTAssertTrue(app.buttons["events.card.puppy-yoga"].waitForExistence(timeout: 10))
        let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5))
        let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.5))
        DispatchQueue.global().asyncAfter(deadline: .now() + 2.2) { self.shot("events-swipe-mid") }
        from.press(forDuration: 0.1, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 3)
        Thread.sleep(forTimeInterval: 1.5)
        shot("events-swipe-after-release")
    }
}
