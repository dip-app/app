import XCTest

/// Drives the real DIP app in Debug mock-member mode (see DIP/App/MockLaunch.swift):
/// no Google sign-in, no Firebase, in-memory fixture data.
final class MockMemberLaunchUITests: XCTestCase {
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--mock-member"]
        app.launch()
        return app
    }

    func testMemberShellShowsFourTabs() {
        let app = launch()
        for tab in ["Home", "Rewards", "My Events", "Profile"] {
            XCTAssertTrue(app.buttons[tab].waitForExistence(timeout: 20), "missing tab \(tab)")
        }
    }

    func testEventOpensWithVenueAndDirections() {
        let app = launch()
        let event = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'home.event.'")).firstMatch
        XCTAssertTrue(event.waitForExistence(timeout: 20), "no event on Home")
        event.tap()
        XCTAssertTrue(app.staticTexts["100 Example Street"].waitForExistence(timeout: 10), "event details with venue address did not open")
    }
}
