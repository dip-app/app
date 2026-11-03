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
        XCTAssertGreaterThanOrEqual(google.frame.height, 44)
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
}
