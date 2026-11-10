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

    /// Lets the Stage's springs settle before a review capture.
    private func settle(_ seconds: TimeInterval = 1.4) { Thread.sleep(forTimeInterval: seconds) }

    /// The one Bar sits on the shared rectangle: 20 pt insets, 80 pt tall, bottom 21 pt above the edge.
    @MainActor private func assertSharedBar(_ bar: XCUIElement, in app: XCUIApplication,
                                            file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(bar.frame.height, 80, accuracy: 0.5, file: file, line: line)
        XCTAssertEqual(bar.frame.minY, app.frame.height - 101, accuracy: 0.5, file: file, line: line)
        XCTAssertEqual(bar.frame.minX, 20, accuracy: 0.5, file: file, line: line)
        XCTAssertEqual(bar.frame.width, app.frame.width - 40, accuracy: 0.5, file: file, line: line)
    }

    /// Signs in and waits for the notice's primary action on the Bar.
    @MainActor private func reachNotice(_ account: String, largeText: Bool = false) -> XCUIApplication {
        let app = launch(account, largeText: largeText)
        app.buttons["onboarding.google"].tap()
        XCTAssertTrue(app.buttons["onboarding.primary"].waitForExistence(timeout: 10))
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

    // MARK: Sign-in stage (onboarding P1)

    @MainActor func testWelcomeStageLayout() {
        let app = launch("welcome")
        let title = app.staticTexts["onboarding.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        settle()
        XCTAssertEqual(title.label.lowercased(), "meet your team outside work")
        XCTAssertEqual(title.frame.minY, 307, accuracy: 4)
        let body = app.staticTexts["onboarding.body"]
        XCTAssertTrue(body.label.hasPrefix("Board games, cooking nights, hikes and more."))
        XCTAssertEqual(app.staticTexts["onboarding.work-account-guidance"].label,
                       "Use your work Google account. We find your company from your email.")
        assertSharedBar(app.buttons["onboarding.google"], in: app)
        capture(app, "onboarding-a1-welcome")
    }

    @MainActor func testResolvingShowsProgressOnTheSameBar() {
        let app = launch("slow")
        app.buttons["onboarding.google"].tap()
        let progress = app.buttons["onboarding.progress"]
        XCTAssertTrue(progress.waitForExistence(timeout: 5))
        let finding = NSPredicate(format: "label == %@", "Finding your company…")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: finding, object: progress)], timeout: 5),
                       .completed)
        XCTAssertEqual(progress.value as? String, "In progress")
        XCTAssertFalse(progress.isEnabled)
        assertSharedBar(progress, in: app)
        XCTAssertEqual(app.staticTexts["onboarding.title"].label.lowercased(), "meet your team outside work")
        XCTAssertFalse(app.buttons["onboarding.google"].exists)
        settle(0.9)
        capture(app, "onboarding-a2-resolving")
    }

    @MainActor func testEveryNoticeUsesTheBarAndKeepsItsCopy() {
        let cases: [(account: String, title: String, primary: String, secondary: String?)] = [
            ("personal", "use your work account", "Use a different account", nil),
            ("conflict", "this account belongs to another company", "Use a different account", nil),
            ("unmapped", "your company isn't here yet", "Try again", "Use a different account"),
            ("offline", "you're offline", "Try again", "Sign out"),
            ("limited", "too many tries", "Try again", "Sign out"),
            ("problem", "something went wrong", "Try again", "Sign out"),
            ("unconfigured", "sign-in isn't available", "Try again", nil),
        ]
        for item in cases {
            let app = reachNotice(item.account)
            let primary = app.buttons["onboarding.primary"]
            XCTAssertEqual(primary.label, item.primary, item.account)
            assertSharedBar(primary, in: app)
            let title = app.staticTexts["onboarding.title"]
            XCTAssertTrue(title.waitForExistence(timeout: 5))
            settle()
            XCTAssertEqual(title.label.lowercased(), item.title, item.account)
            XCTAssertEqual(title.frame.minY, 307, accuracy: 4, item.account)
            let secondary = app.buttons["onboarding.secondary"]
            if let expected = item.secondary {
                XCTAssertTrue(secondary.waitForExistence(timeout: 3), item.account)
                XCTAssertEqual(secondary.label, expected)
                XCTAssertGreaterThanOrEqual(secondary.frame.height, 44)
                XCTAssertEqual(secondary.frame.maxY, primary.frame.minY - 12, accuracy: 1, item.account)
            } else {
                XCTAssertFalse(secondary.exists, item.account)
            }
            capture(app, "onboarding-notice-\(item.account)")
            app.terminate()
        }
    }

    @MainActor func testOfflineRetryRestartsAndSignOutReturnsToWelcome() {
        let app = reachNotice("offline")
        let primary = app.buttons["onboarding.primary"]
        primary.tap()
        // restart: A0 retry look, then the same failure again.
        XCTAssertTrue(app.buttons["onboarding.progress"].waitForExistence(timeout: 5))
        XCTAssertTrue(primary.waitForExistence(timeout: 10))
        let title = app.staticTexts["onboarding.title"]
        let offline = NSPredicate(format: "label ==[c] %@", "You're offline")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: offline, object: title)], timeout: 5),
                       .completed)
        app.buttons["onboarding.secondary"].tap()
        XCTAssertTrue(app.buttons["onboarding.google"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["home.tab.Home"].exists)
    }

    @MainActor func testLargeTextNoticeHidesStageAndPinsActions() {
        let app = reachNotice("personal", largeText: true)
        let primary = app.buttons["onboarding.primary"]
        XCTAssertTrue(primary.isHittable)
        assertSharedBar(primary, in: app)
        settle()
        XCTAssertLessThan(app.staticTexts["onboarding.title"].frame.minY, 120, "no Stage above the title")
        capture(app, "onboarding-notice-large-text")
    }
}
