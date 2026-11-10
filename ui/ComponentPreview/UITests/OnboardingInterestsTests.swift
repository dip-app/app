import XCTest

/// Onboarding B5 (proposal): the embedded interest picker driven by OnboardingInterestsModel.
final class OnboardingInterestsTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor private func launch(_ flags: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--onboarding-interests"] + flags
        app.launch()
        return app
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor private func waitForLabel(_ element: XCUIElement, _ label: String, timeout: TimeInterval = 5) -> Bool {
        let predicate = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", label), object: element)
        return XCTWaiter.wait(for: [predicate], timeout: timeout) == .completed
    }

    @MainActor func testSelectFailSaveAndRetryFromTheBar() {
        let app = launch(["--onboarding-interests-fail"])
        let bar = app.buttons["onboarding.interests.save"]
        let food = app.buttons["profile.interests.option.tag-food"]
        XCTAssertTrue(food.waitForExistence(timeout: 10))
        XCTAssertEqual(bar.label, "Start exploring")
        XCTAssertFalse(app.navigationBars.firstMatch.exists, "embedded picker has no navigation stack")
        XCTAssertFalse(app.buttons["profile.interests.cancel"].exists)

        food.tap()
        app.buttons["profile.interests.option.tag-arts"].tap()
        XCTAssertEqual(food.value as? String, "Selected")
        XCTAssertTrue(waitForLabel(bar, "Save and start"))
        XCTAssertEqual(app.staticTexts["profile.interests.count"].label, "2 of 10 selected")
        capture(app, "onboarding-interests-picking")

        bar.tap()
        XCTAssertTrue(app.descendants(matching: .any)["profile.interests.error"].waitForExistence(timeout: 5))
        XCTAssertTrue(waitForLabel(bar, "Try again"))
        XCTAssertFalse(app.buttons["profile.interests.retry"].exists, "the bar is the only retry")
        XCTAssertEqual(food.value as? String, "Selected", "choices are kept")
        XCTAssertTrue(app.buttons["onboarding.interests.skip"].isEnabled)
        capture(app, "onboarding-interests-save-failed")

        bar.tap()
        let done = app.staticTexts["onboarding.interests.done"]
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        XCTAssertEqual(done.label, "Saved 2 interests")
    }

    @MainActor func testSearchAndSkipWriteNothing() {
        let app = launch()
        let field = app.textFields["profile.interests.search"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("Out")
        XCTAssertTrue(app.buttons["profile.interests.option.tag-outdoors"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["profile.interests.option.tag-food"].exists)
        app.buttons["profile.interests.option.tag-outdoors"].tap()
        app.buttons["onboarding.interests.skip"].tap()
        XCTAssertTrue(waitForLabel(app.staticTexts["onboarding.interests.done"], "Skipped"))
    }

    @MainActor func testCatalogLoadingShowsPlaceholderRows() {
        let app = launch(["--onboarding-interests-loading"])
        XCTAssertTrue(app.descendants(matching: .any)["profile.interests.loading"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons["onboarding.interests.save"].label, "Start exploring")
        XCTAssertFalse(app.textFields["profile.interests.search"].exists)
        capture(app, "onboarding-interests-loading")
    }

    @MainActor func testCatalogFailureOffersStartExploringWithoutPicker() {
        let app = launch(["--onboarding-interests-catalog-fail"])
        let message = app.staticTexts["profile.interests.catalogFailed"]
        XCTAssertTrue(message.waitForExistence(timeout: 10))
        XCTAssertEqual(message.label, "Your interests couldn’t load. You can add them in Profile anytime.")
        XCTAssertFalse(app.textFields["profile.interests.search"].exists)
        let bar = app.buttons["onboarding.interests.save"]
        XCTAssertEqual(bar.label, "Start exploring")
        capture(app, "onboarding-interests-catalog-failed")
        bar.tap()
        XCTAssertTrue(waitForLabel(app.staticTexts["onboarding.interests.done"], "Finished without changes"))
    }

    @MainActor func testEmptyCatalogSkipsTheStep() {
        let app = launch(["--onboarding-interests-empty"])
        XCTAssertTrue(app.staticTexts["onboarding.interests.skippedStep"].waitForExistence(timeout: 10))
    }
}
