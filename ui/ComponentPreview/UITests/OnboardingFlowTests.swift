import XCTest

final class OnboardingFlowTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor private func launch(_ state: String, largeText: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--onboarding=\(state)"] + (largeText ? ["--large-text"] : [])
        app.launch()
        XCTAssertTrue(app.buttons["onboarding.google"].waitForExistence(timeout: 10))
        return app
    }

    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    @MainActor func testWelcomeSignsInToHome() {
        let app = launch("welcome")
        let google = app.buttons["onboarding.google"]
        XCTAssertTrue(google.isHittable)
        XCTAssertEqual(google.frame.height, 80, accuracy: 0.5)
        XCTAssertEqual(google.frame.minY, app.frame.height - 101, accuracy: 0.5)
        XCTAssertEqual(google.frame.minX, 20, accuracy: 0.5)
        XCTAssertEqual(google.frame.width, app.frame.width - 40, accuracy: 0.5)
        XCTAssertFalse(app.staticTexts["DIP"].exists)
        XCTAssertFalse(app.buttons["home.tab.Home"].exists)
        let guidance = app.staticTexts["onboarding.work-account-guidance"]
        XCTAssertTrue(guidance.exists)
        XCTAssertLessThanOrEqual(guidance.frame.maxY, google.frame.minY)
        capture(app, "login-welcome")
        google.tap()
        XCTAssertTrue(app.buttons["home.tab.Home"].waitForExistence(timeout: 10))
        app.buttons["home.tab.Profile"].tap()
        let signOut = app.buttons["profile.signout"]
        for _ in 0..<4 where !signOut.isHittable { app.swipeUp() }
        XCTAssertTrue(signOut.isHittable)
        signOut.tap()
        XCTAssertTrue(app.buttons["onboarding.google"].waitForExistence(timeout: 5))
    }

    @MainActor func testPersonalAccountReturnsToWelcome() {
        let app = launch("personal")
        app.buttons["onboarding.google"].tap()
        let primary = app.buttons["onboarding.primary"]
        XCTAssertTrue(primary.waitForExistence(timeout: 10))
        XCTAssertEqual(primary.label, "Use a different account")
        XCTAssertEqual(app.staticTexts["onboarding.title"].label.lowercased(), "use your work account")
        capture(app, "login-work-account")
        primary.tap()
        XCTAssertTrue(app.buttons["onboarding.google"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["home.tab.Home"].exists)
    }

    @MainActor func testUnmappedCompanyRetryAndDifferentAccount() {
        let app = launch("unmapped")
        app.buttons["onboarding.google"].tap()
        let secondary = app.buttons["onboarding.secondary"]
        XCTAssertTrue(secondary.waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["onboarding.title"].label, "Your company isn't here yet")
        capture(app, "login-company-not-found")
        app.buttons["onboarding.primary"].tap()
        XCTAssertTrue(secondary.waitForExistence(timeout: 10))
        secondary.tap()
        XCTAssertTrue(app.buttons["onboarding.google"].waitForExistence(timeout: 5))
    }

    @MainActor func testLargeTextKeepsLoginAndRecoveryActionsReachable() {
        let app = launch("unconfigured", largeText: true)
        XCTAssertTrue(app.buttons["onboarding.google"].isHittable)
        capture(app, "login-large-text")
        app.buttons["onboarding.google"].tap()
        let retry = app.buttons["onboarding.primary"]
        XCTAssertTrue(retry.waitForExistence(timeout: 10))
        XCTAssertTrue(retry.isHittable)
        XCTAssertEqual(app.staticTexts["onboarding.title"].label, "Sign-in isn't available")
        retry.tap()
        XCTAssertTrue(app.buttons["onboarding.google"].waitForExistence(timeout: 5))
    }
    @MainActor func testInterestChangesUseAccountRepositoryAndSurviveSignOut() {
        let app = launch("welcome")
        app.buttons["onboarding.google"].tap()
        XCTAssertTrue(app.buttons["home.tab.Profile"].waitForExistence(timeout: 10))
        app.buttons["home.tab.Profile"].tap()
        let addInterest = app.buttons["profile.interests.add"]
        XCTAssertTrue(addInterest.waitForExistence(timeout: 5))
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: addInterest)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed)
        let name = app.staticTexts["profile.name"].label
        addInterest.tap()
        let fitness = app.buttons["profile.interests.option.tag-fitness"]
        XCTAssertTrue(fitness.waitForExistence(timeout: 5))
        XCTAssertEqual(fitness.value as? String, "Not selected")
        fitness.tap(); app.buttons["profile.interests.save"].tap()
        XCTAssertTrue(app.staticTexts["1 selected"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["profile.name"].label, name)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "profile-account-backed"; capture.lifetime = .keepAlways; add(capture)
        let signOut = app.buttons["profile.signout"]
        if !signOut.isHittable { app.swipeUp() }
        signOut.tap()
        XCTAssertTrue(app.buttons["onboarding.google"].waitForExistence(timeout: 5))
        app.buttons["onboarding.google"].tap()
        XCTAssertTrue(app.buttons["home.tab.Profile"].waitForExistence(timeout: 10))
        app.buttons["home.tab.Profile"].tap()
        XCTAssertTrue(app.staticTexts["1 selected"].waitForExistence(timeout: 5))
    }

    @MainActor func testLargestTextKeepsSharedLoginActionReadable() {
        let app = XCUIApplication()
        app.launchArguments = ["--onboarding=welcome", "--largest-text"]
        app.launch()
        let google = app.buttons["onboarding.google"]
        XCTAssertTrue(google.waitForExistence(timeout: 10))
        XCTAssertTrue(google.isHittable)
        XCTAssertEqual(google.frame.height, 80, accuracy: 0.5)
        XCTAssertEqual(google.frame.minY, app.frame.height - 101, accuracy: 0.5)
        XCTAssertFalse(app.buttons["home.tab.Home"].exists)
        XCTAssertFalse(app.staticTexts["DIP"].exists)
        let guidance = app.staticTexts["onboarding.work-account-guidance"]
        XCTAssertLessThanOrEqual(guidance.frame.maxY, google.frame.minY)
        capture(app, "login-largest-text")
    }

}
