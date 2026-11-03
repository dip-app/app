import XCTest

final class ProfileInterestTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor private func launch(_ flags: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--screen=profile"] + flags
        app.launch()
        XCTAssertTrue(app.buttons["profile.interests.add"].waitForExistence(timeout: 10))
        return app
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor private func search(_ app: XCUIApplication, _ text: String) {
        let field = app.textFields["profile.interests.search"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40))
        field.typeText(text)
    }

    @MainActor func testAddSearchSaveAndReopen() {
        let app = launch()
        capture(app, "profile-refined")
        app.buttons["profile.interests.add"].tap()
        XCTAssertTrue(app.buttons["profile.interests.option.tag-fitness"].waitForExistence(timeout: 5))
        capture(app, "profile-interest-catalog")
        search(app, "Photo")
        app.buttons["profile.interests.option.tag-photography"].tap()
        app.buttons["profile.interests.save"].tap()
        XCTAssertTrue(app.buttons["profile.edit"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["5 selected"].exists)
        app.buttons["home.tab.Home"].tap()
        app.buttons["home.tab.Profile"].tap()
        app.buttons["profile.interests.add"].tap()
        XCTAssertEqual(app.buttons["profile.interests.option.tag-fitness"].value as? String, "Selected")
        search(app, "Photo")
        XCTAssertEqual(app.buttons["profile.interests.option.tag-photography"].value as? String, "Selected")
    }

    @MainActor func testFailedSaveKeepsSelectionAndRetryPersistsIt() {
        let app = launch(["--fail-profile-once"])
        app.buttons["profile.interests.add"].tap()
        search(app, "Photo")
        app.buttons["profile.interests.option.tag-photography"].tap()
        app.buttons["profile.interests.save"].tap()
        let error = app.descendants(matching: .any)["profile.interests.error"]
        XCTAssertTrue(error.waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["profile.interests.option.tag-photography"].value as? String, "Selected")
        capture(app, "profile-interest-retry")
        app.buttons["profile.interests.retry"].tap()
        XCTAssertTrue(app.buttons["profile.edit"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["5 selected"].exists)
    }

    @MainActor func testSearchEmptyAndCancelPreserveProfileAndEditDraft() {
        let app = launch()
        app.buttons["profile.interests.add"].tap()
        search(app, "zzzznointerest")
        XCTAssertTrue(app.staticTexts["No Results"].waitForExistence(timeout: 5))
        capture(app, "profile-interest-no-results")
        app.buttons["profile.interests.cancel"].tap()
        XCTAssertTrue(app.staticTexts["4 selected"].waitForExistence(timeout: 5))
        app.buttons["profile.edit"].tap()
        let department = app.textFields["profile.edit.department"]
        department.tap()
        department.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 30))
        department.typeText("Design")
        app.buttons["profile.edit.interests"].tap()
        search(app, "Photo")
        app.buttons["profile.interests.option.tag-photography"].tap()
        app.buttons["profile.interests.save"].tap()
        XCTAssertEqual(department.value as? String, "Design")
        app.buttons["profile.edit.interests"].tap()
        search(app, "Music")
        app.buttons["profile.interests.option.tag-music"].tap()
        app.buttons["profile.interests.cancel"].tap()
        XCTAssertEqual(department.value as? String, "Design")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.staticTexts["4 selected"].waitForExistence(timeout: 5))
    }

    @MainActor func testLargeTextProfileAndPickerRemainUsable() {
        let app = launch(["--large-text"])
        let add = app.buttons["profile.interests.add"]
        if !add.isHittable { app.swipeUp() }
        XCTAssertTrue(add.isHittable)
        capture(app, "profile-large-text")
        add.tap()
        search(app, "Photo")
        let photo = app.buttons["profile.interests.option.tag-photography"]
        XCTAssertTrue(photo.isHittable)
        XCTAssertGreaterThanOrEqual(photo.frame.height, 44)
        capture(app, "profile-interest-large-text")
        app.buttons["profile.interests.cancel"].tap()
    }
}
