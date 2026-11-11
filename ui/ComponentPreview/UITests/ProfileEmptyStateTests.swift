import XCTest

final class ProfileEmptyStateTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor func testMemberWithoutMemoriesSeesDesignedEmptyState() {
        let app = XCUIApplication()
        app.launchArguments = ["--profile-state=account-empty"]
        app.launch()
        XCTAssertTrue(app.descendants(matching: .any)["empty.profile-memories"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["profile.memory.0"].exists)
        // About details live in the header and show placeholders for what is not set yet.
        XCTAssertTrue(app.descendants(matching: .any)["profile.details.jobTitle"].exists)
        XCTAssertTrue(app.buttons["profile.interests.add"].exists)
    }

    @MainActor func testMemoriesGridShowsTilesWhenPresent() {
        let app = XCUIApplication()
        app.launchArguments = ["--profile-state=account"]
        app.launch()
        XCTAssertTrue(app.buttons["profile.memory.0"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.descendants(matching: .any)["empty.profile-memories"].exists)
    }
}
