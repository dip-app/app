import XCTest

/// Home weekly-theme card states through the real feed/repository with a fake source
/// (`--home-theme=...`, see HomeThemePreview). No Firebase is involved.
final class HomeThemeTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor private func launch(_ arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        return app
    }
    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement { app.descendants(matching: .any)[id] }

    @MainActor func testLiveCardKeepsReferenceGeometryAndOpensReadOnlyDetail() {
        let app = launch(["--home-theme=live"])
        let card = app.buttons["home.challenge"]
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        XCTAssertEqual(card.label, "This week’s challenge: Fitness, 128 others participating")
        XCTAssertEqual(card.frame.minY, 165, accuracy: 0.5)
        XCTAssertEqual(card.frame.height, 225, accuracy: 0.5)
        XCTAssertFalse(element(app, "home.challenge.stale").exists)
        XCTAssertTrue(app.buttons["home.event.EventCard"].exists, "the rest of Home is unchanged")
        card.tap()
        XCTAssertTrue(app.staticTexts["challenge.title"].waitForExistence(timeout: 3))
        XCTAssertEqual(app.staticTexts["challenge.title"].label, "FITNESS")
        XCTAssertTrue(element(app, "challenge.goal").exists)
        XCTAssertTrue(element(app, "challenge.goal").label.contains("3 workouts"))
        XCTAssertTrue(element(app, "challenge.reward").label.contains("+50 points"))
        XCTAssertTrue(element(app, "challenge.how").exists)
        XCTAssertTrue(element(app, "challenge.submissions").exists)
        // Read-only: no entry action, no completed-list dead end, no "not connected" alert.
        XCTAssertFalse(app.buttons["challenge.primary"].exists)
        XCTAssertFalse(app.buttons["challenge.attendees"].exists)
        XCTAssertFalse(app.buttons["challenge.join"].exists)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        app.buttons["challenge.back"].tap()
        XCTAssertTrue(card.waitForExistence(timeout: 3))
    }

    @MainActor func testParticipantCountVariants() {
        for (count, label) in [(0, "This week’s challenge: Fitness, be the first this week"),
                               (1, "This week’s challenge: Fitness, 1 other participating")] {
            let app = launch(["--home-theme=live", "--home-theme-count=\(count)"])
            let card = app.buttons["home.challenge"]
            XCTAssertTrue(card.waitForExistence(timeout: 10))
            XCTAssertEqual(card.label, label)
            app.terminate()
        }
    }

    @MainActor func testNoThemeThisWeekShowsDesignedEmptyCard() {
        let app = launch(["--home-theme=none"])
        let empty = element(app, "home.challenge.empty")
        XCTAssertTrue(empty.waitForExistence(timeout: 10))
        XCTAssertTrue(empty.label.contains("No weekly theme right now."))
        XCTAssertFalse(app.buttons["home.challenge"].exists)
        XCTAssertTrue(app.buttons["home.event.EventCard"].exists)
    }

    @MainActor func testErrorRetriesInPlaceAndKeepsOtherHomeContent() {
        let app = launch(["--home-theme=error"])
        let retry = app.buttons["home.challenge.retry"]
        XCTAssertTrue(retry.waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "home.challenge.error").exists)
        XCTAssertTrue(app.buttons["home.event.EventCard"].isHittable)
        retry.tap()
        XCTAssertTrue(app.buttons["home.challenge"].waitForExistence(timeout: 5))
        XCTAssertFalse(element(app, "home.challenge.error").exists)
    }

    @MainActor func testLoadingSkeletonHasTheCardFootprint() {
        let app = launch(["--home-theme=loading"])
        let skeleton = element(app, "home.challenge.loading")
        XCTAssertTrue(skeleton.waitForExistence(timeout: 10))
        XCTAssertEqual(skeleton.frame.minY, 165, accuracy: 0.5)
        XCTAssertEqual(skeleton.frame.height, 225, accuracy: 0.5)
        XCTAssertEqual(app.buttons["home.event.EventCard"].frame.minY, 442, accuracy: 0.5, "events do not move when the card loads")
    }

    @MainActor func testOfflineShowsCachedCardMarkedStale() {
        let app = launch(["--home-theme=offline"])
        XCTAssertTrue(app.buttons["home.challenge"].waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "home.challenge.stale").exists)
    }

    @MainActor func testUnknownThemeFallsBackToTitleOnlyCard() {
        let app = launch(["--home-theme=unknown"])
        let card = app.buttons["home.challenge"]
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        XCTAssertTrue(card.label.hasPrefix("This week’s challenge: Sleep"))
        card.tap()
        XCTAssertEqual(app.staticTexts["challenge.title"].label, "SLEEP")
    }

    @MainActor func testReferenceFixtureCardOpensReadOnlyDetailWithoutNotice() {
        let app = launch([])
        let card = app.buttons["home.challenge"]
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        card.tap()
        XCTAssertTrue(element(app, "challenge.submissions").waitForExistence(timeout: 3))
        XCTAssertFalse(app.alerts.firstMatch.exists)
        XCTAssertTrue(app.buttons["home.tab.Home"].exists, "no entry action replaces the tabs")
    }

    @MainActor func testLargestTextKeepsCardAndDetailReadable() {
        let app = launch(["--home-theme=live", "--largest-text"])
        let card = app.buttons["home.challenge"]
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        XCTAssertGreaterThanOrEqual(card.frame.height, 225)
        card.tap()
        XCTAssertTrue(element(app, "challenge.submissions").waitForExistence(timeout: 3))
    }
}
