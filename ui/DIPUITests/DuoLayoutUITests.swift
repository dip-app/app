import XCTest

/// iPhone Duo (model iPhone19,4): the sensor island is reported as an 84 pt trailing safe area in portrait. These tests
/// drive the real app in Debug mock-member mode. On any other device the Duo assertion is skipped, and the capture test
/// only writes screenshots when `TEST_RUNNER_DIP_CAPTURE_DIR` is set (used for the before/after phone comparison).
final class DuoLayoutUITests: XCTestCase {
    private static let islandInset: CGFloat = 84

    private var isDuo: Bool { ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] == "iPhone19,4" }

    override func setUp() { continueAfterFailure = false }

    private func launch(_ extra: [String] = ["--mock-member"]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = extra
        app.launch()
        return app
    }

    func testDuoKeepsTheBottomBarClearOfTheSensorIsland() throws {
        try XCTSkipUnless(isDuo, "Duo only")
        let app = launch()
        let profile = app.buttons["Profile"]
        XCTAssertTrue(profile.waitForExistence(timeout: 30))
        let window = app.windows.firstMatch.frame
        // The hinge reports asynchronously, so allow the Duo shell a moment to apply its insets.
        let limit = window.maxX - Self.islandInset + 0.5
        let clear = NSPredicate { _, _ in profile.frame.maxX <= limit }
        let expectation = XCTNSPredicateExpectation(predicate: clear, object: nil)
        XCTAssertEqual(XCTWaiter().wait(for: [expectation], timeout: 15), .completed, "tab bar extends under the sensor island: \(profile.frame)")
        for tab in ["Home", "Rewards", "My Events", "Profile"] {
            XCTAssertGreaterThanOrEqual(app.buttons[tab].frame.height, 44, "\(tab) tab is below the 44 pt target")
        }
    }

    func testCaptureScreensWhenAsked() throws {
        guard let directory = ProcessInfo.processInfo.environment["DIP_CAPTURE_DIR"] else { throw XCTSkip("DIP_CAPTURE_DIR not set") }
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        func shot(_ name: String) {
            Thread.sleep(forTimeInterval: 2.5)
            let image = XCUIScreen.main.screenshot()
            try? image.pngRepresentation.write(to: URL(fileURLWithPath: directory).appendingPathComponent(name + ".png"))
        }
        func fresh(_ args: [String] = ["--mock-member"]) -> XCUIApplication {
            let app = XCUIApplication()
            app.terminate()
            app.launchArguments = args
            app.launch()
            return app
        }

        var app = fresh(["--mock-onboarding"])
        _ = app.staticTexts.firstMatch.waitForExistence(timeout: 20)
        shot("onboarding")

        app = fresh()
        XCTAssertTrue(app.buttons["Profile"].waitForExistence(timeout: 30))
        shot("home")
        let event = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'home.event.'")).firstMatch
        XCTAssertTrue(event.waitForExistence(timeout: 20))
        event.tap()
        XCTAssertTrue(app.descendants(matching: .any)["event.where"].waitForExistence(timeout: 10))
        shot("event")

        app = fresh()
        XCTAssertTrue(app.buttons["Profile"].waitForExistence(timeout: 30))
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Notifications'")).firstMatch.tap()
        _ = app.descendants(matching: .any)["notifications.screen"].waitForExistence(timeout: 10)
        shot("notifications")

        for (tab, name) in [("Rewards", "rewards"), ("My Events", "myevents"), ("Profile", "profile")] {
            app = fresh()
            XCTAssertTrue(app.buttons[tab].waitForExistence(timeout: 30))
            app.buttons[tab].tap()
            shot(name)
            if tab == "My Events" {
                app.buttons["events.segment.memories"].tap()
                shot("memories")
                let memory = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'events.album.'")).firstMatch
                if memory.waitForExistence(timeout: 10) {
                    memory.tap()
                    app.buttons["event.primary"].tap()
                    _ = app.buttons["album.photo.0"].waitForExistence(timeout: 10)
                    shot("album")
                }
            }
        }
    }
}
