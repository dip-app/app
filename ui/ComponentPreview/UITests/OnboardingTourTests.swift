import XCTest

/// The post-membership tour (spec §5 UI tests), hosted by `--onboarding-tour` (signed in as the preview
/// member Sam Rivera) or `--onboarding=<account> --onboarding-tour`.
final class OnboardingTourTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor private func launch(_ arguments: [String], account: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--onboarding-tour"] + (account.map { ["--onboarding=\($0)"] } ?? []) + arguments
        app.launch()
        return app
    }

    @MainActor private func title(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["onboarding.tour.title"]
    }

    @MainActor private func waitForTitle(_ app: XCUIApplication, _ text: String, timeout: TimeInterval = 10,
                                         file: StaticString = #filePath, line: UInt = #line) {
        let element = title(app)
        // Case-insensitive: the Fjalla One title is drawn uppercase.
        let predicate = NSPredicate(format: "label ==[c] %@", text)
        let result = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: element)], timeout: timeout)
        XCTAssertEqual(result, .completed, "title is \(element.exists ? element.label : "missing"), expected \(text)",
                       file: file, line: line)
    }

    @MainActor private func tapNext(_ app: XCUIApplication) {
        let next = app.buttons["onboarding.next"]
        XCTAssertTrue(next.waitForExistence(timeout: 5))
        next.tap()
    }

    @MainActor private func waitForHome(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: title(app))
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 10), .completed, "the tour is still up", file: file, line: line)
        XCTAssertTrue(app.buttons["home.tab.Home"].waitForExistence(timeout: 10), file: file, line: line)
    }

    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    /// First run with the shipping feature set: B0 → B1 → B2 → B4 → B5 (B3 needs F3) → Home.
    @MainActor func testFirstRunToHome() {
        let app = launch(["-onboarding.reset", "-onboarding.timeScale", "4"])
        waitForTitle(app, "You're in, Sam")
        XCTAssertTrue(app.buttons["onboarding.tour.skip"].exists)
        XCTAssertFalse(app.buttons["onboarding.tour.back"].exists)
        tapNext(app)
        waitForTitle(app, "Find something fun")
        let progress = app.descendants(matching: .any)["onboarding.tour.progress"]
        XCTAssertEqual(progress.label, "Step 1 of 4, Find events")
        XCTAssertTrue(app.descendants(matching: .any)["onboarding.stage"].exists)
        tapNext(app)
        waitForTitle(app, "Go with people you know")
        XCTAssertEqual(progress.label, "Step 2 of 4, Who's going")
        // Back returns to B1 and forward again.
        app.buttons["onboarding.tour.back"].tap()
        waitForTitle(app, "Find something fun")
        tapNext(app)
        waitForTitle(app, "Go with people you know")
        tapNext(app)
        waitForTitle(app, "Keep the memories")
        tapNext(app)
        waitForTitle(app, "What are you into?")
        XCTAssertFalse(app.buttons["onboarding.tour.skip"].exists, "B5 offers Skip for now instead")
        XCTAssertTrue(app.buttons["onboarding.interests.skip"].exists)
        let bar = app.buttons["onboarding.interests.save"]
        XCTAssertTrue(bar.waitForExistence(timeout: 5))
        bar.tap()
        waitForHome(app)

        // Second launch of the same uid: no tour.
        app.terminate()
        let again = launch([])
        XCTAssertTrue(again.buttons["home.tab.Home"].waitForExistence(timeout: 10))
        XCTAssertFalse(title(again).exists)
    }

    @MainActor func testSkipAtB2WritesSkippedAndNeverShowsAgain() {
        let app = launch(["-onboarding.reset", "-onboarding.timeScale", "4"])
        waitForTitle(app, "You're in, Sam")
        tapNext(app)
        tapNext(app)
        waitForTitle(app, "Go with people you know")
        app.buttons["onboarding.tour.skip"].tap()
        waitForHome(app)
        app.terminate()
        let again = launch([])
        XCTAssertTrue(again.buttons["home.tab.Home"].waitForExistence(timeout: 10))
        XCTAssertFalse(title(again).exists)
    }

    /// A relaunch with a stored lastStep resumes there (the resume entrance) with the stack pre-filled.
    @MainActor func testRelaunchResumesAtStoredStep() {
        let app = launch(["-onboarding.resumeAt", "memories", "-onboarding.timeScale", "4"])
        waitForTitle(app, "Keep the memories")
        XCTAssertEqual(app.descendants(matching: .any)["onboarding.tour.progress"].label, "Step 3 of 4, Memories")
        XCTAssertTrue(app.buttons["onboarding.tour.back"].exists)
        app.terminate()
        // All features: B3 exists, and a stored B3 resumes there.
        let challenges = launch(["-onboarding.resumeAt", "challenges", "-onboarding.features", "all", "-onboarding.timeScale", "4"])
        waitForTitle(challenges, "Take on a challenge")
        XCTAssertEqual(challenges.descendants(matching: .any)["onboarding.tour.progress"].label, "Step 3 of 5, Challenges")
    }

    @MainActor func testInterestSaveFailureRetriesFromTheBar() {
        let app = launch(["-onboarding.resumeAt", "interests", "-onboarding.timeScale", "4"], account: "member-save-fails")
        waitForTitle(app, "What are you into?")
        let option = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'profile.interests.option.'")).firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 10))
        option.tap()
        let bar = app.buttons["onboarding.interests.save"]
        XCTAssertEqual(bar.label, "Save and start")
        bar.tap()
        XCTAssertTrue(app.descendants(matching: .any)["profile.interests.error"].waitForExistence(timeout: 8))
        let retry = NSPredicate(format: "label == %@", "Try again")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: retry, object: bar)], timeout: 5), .completed)
        bar.tap()
        waitForHome(app)
    }

    @MainActor func testReplayFromProfileEndsOverProfile() {
        let app = launch(["-onboarding.resumeAt", "interests", "-onboarding.timeScale", "4"])
        waitForTitle(app, "What are you into?")
        app.buttons["onboarding.interests.skip"].tap()
        waitForHome(app)
        app.buttons["home.tab.Profile"].tap()
        let row = app.buttons["profile.howDIPWorks"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        waitForTitle(app, "Find something fun")
        XCTAssertEqual(app.buttons["onboarding.tour.skip"].label, "Done")
        app.buttons["onboarding.tour.skip"].tap()
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: title(app))
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 10), .completed)
        XCTAssertTrue(row.waitForExistence(timeout: 5), "replay ends over Profile")
    }

    /// Reduce Motion plays the crossfade compositions. (Accessibility audits and large-text variants are deferred
    /// by owner decision, November 10.)
    @MainActor func testReduceMotionComposition() {
        let reduced = launch(["-onboarding.reset", "-onboarding.reduceMotion", "-onboarding.timeScale", "4"])
        waitForTitle(reduced, "You're in, Sam")
        tapNext(reduced)
        waitForTitle(reduced, "Find something fun")
    }

    /// iPhone 17 Pro captures per step for side-by-side review with the Figma frames (spec §7, not a pixel gate).
    @MainActor func testStepCaptures() {
        let steps: [(String, [String])] = [
            ("onboarding-tour-B0-arrival", ["-onboarding.reset"]),
            ("onboarding-tour-B1-discover", ["-onboarding.resumeAt", "discover", "-onboarding.freezeAt", "discover@final"]),
            ("onboarding-tour-B2-people", ["-onboarding.resumeAt", "people", "-onboarding.freezeAt", "people@2.1"]),
            ("onboarding-tour-B3-challenges", ["-onboarding.resumeAt", "challenges", "-onboarding.features", "all",
                                               "-onboarding.freezeAt", "challenges@3.2"]),
            ("onboarding-tour-B4-memories", ["-onboarding.resumeAt", "memories", "-onboarding.freezeAt", "memories@5.7"]),
            ("onboarding-tour-B5-interests", ["-onboarding.resumeAt", "interests"]),
        ]
        for (name, arguments) in steps {
            let app = launch(arguments)
            XCTAssertTrue(title(app).waitForExistence(timeout: 10), name)
            sleep(3)  // entrances settle and images decode before the capture
            capture(app, name)
            app.terminate()
        }
    }
}
