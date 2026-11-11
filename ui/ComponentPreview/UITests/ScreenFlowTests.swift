import XCTest

final class ScreenFlowTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor func testJoinAttendeesAndChatKeepLocalState() {
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event"]
        app.launch()
        let join = app.buttons["event.primary"]
        XCTAssertTrue(join.waitForExistence(timeout: 10))
        XCTAssertEqual(join.label, "Join the Activity")
        XCTAssertFalse(app.buttons["home.challenge"].exists)
        XCTAssertTrue(app.buttons["event.share"].exists)
        XCTAssertFalse(app.buttons["event.join"].exists, "The bottom bar is the only Join action")
        XCTAssertFalse(app.buttons["event.leave"].exists)
        XCTAssertEqual(join.frame.minY, app.frame.height - 101, accuracy: 0.5)
        XCTAssertEqual(join.frame.height, 80, accuracy: 0.5)
        join.tap()
        XCTAssertEqual(join.label, "Activity Chat")
        XCTAssertTrue(app.buttons["event.leave"].waitForExistence(timeout: 3), "Leave appears once joined")
        XCTAssertFalse(app.buttons["event.join"].exists)
        XCTAssertFalse(app.buttons["event.directions"].exists)
        app.buttons["event.attendees"].tap()
        XCTAssertTrue(app.buttons["participants.back"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Elissa Woode"].exists)
        app.buttons["participants.back"].tap()
        XCTAssertEqual(join.label, "Activity Chat")
        join.tap()
        let field = app.descendants(matching: .any)["event.chat.message"]
        XCTAssertTrue(field.waitForExistence(timeout: 3))
        let send = app.buttons["event.chat.send"]
        XCTAssertFalse(send.isEnabled)
        field.tap()
        field.typeText("See you there!")
        send.tap()
        XCTAssertTrue(app.staticTexts["See you there!"].exists)
        app.buttons["Done"].tap()
        app.buttons["event.back"].tap()
        app.buttons["home.event.EventCard"].tap()
        XCTAssertEqual(app.buttons["event.primary"].label, "Activity Chat")
    }

    @MainActor func testMyEventsMemoriesAlbumAndBackNavigation() {
        let app = XCUIApplication()
        app.launchArguments = ["--screen=events"]
        app.launch()
        let puppy = app.buttons["events.card.puppy-yoga"]
        XCTAssertTrue(puppy.waitForExistence(timeout: 10))
        XCTAssertEqual(puppy.frame.minX, 20, accuracy: 0.5)
        XCTAssertEqual(puppy.frame.minY, 188, accuracy: 0.5)
        XCTAssertEqual(puppy.frame.width, app.frame.width - 40, accuracy: 0.5)
        XCTAssertEqual(puppy.frame.height, 246, accuracy: 0.5)
        app.buttons["events.segment.memories"].tap()
        let album = app.buttons["events.album.0"]
        XCTAssertTrue(album.waitForExistence(timeout: 3))
        XCTAssertEqual(album.frame.minY, 188, accuracy: 0.5)
        XCTAssertEqual(album.frame.height, 205, accuracy: 0.5)
        album.tap()
        XCTAssertTrue(app.buttons["event.primary"].waitForExistence(timeout: 3))
        XCTAssertEqual(app.buttons["event.primary"].label, "View Album")
        app.buttons["event.primary"].tap()
        XCTAssertTrue(app.buttons["album.back"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["album.add-photos"].exists)
        if app.frame.width == 402 {
            // Independent coordinates measured from Figma Album46:1995.
            let frames: [(Int, CGFloat, CGFloat)] = [
                (0, 121.5, 237), (1, 120, 115), (2, 245, 115),
                (3, 369, 114), (4, 370, 112), (5, 369, 114),
                (6, 492, 115), (7, 617, 115), (8, 493.5, 237),
            ]
            for (index, y, height) in frames {
                let photo = app.buttons["album.photo.\(index)"]
                print("Album geometry", index, photo.frame)
                XCTAssertEqual(photo.frame.minY, y, accuracy: 0.5)
                XCTAssertEqual(photo.frame.height, height, accuracy: 0.5)
            }
        }
        app.buttons["album.photo.0"].tap()
        XCTAssertTrue(app.buttons["album.photo.close"].waitForExistence(timeout: 3))
        app.buttons["album.photo.close"].tap()
        app.buttons["album.back"].tap()
        app.buttons["event.back"].tap()
        XCTAssertTrue(app.buttons["events.segment.memories"].isSelected)
        app.buttons["events.segment.active"].tap()
        puppy.tap()
        XCTAssertEqual(app.staticTexts["event.title"].label, "PUPPY YOGA")
        app.buttons["event.back"].tap()
        XCTAssertTrue(puppy.exists)
    }

    @MainActor func testProfileEditsAndMemoryNavigation() {
        let app = XCUIApplication()
        app.launchArguments = ["--screen=profile"]
        app.launch()
        let edit = app.buttons["profile.edit"]
        XCTAssertTrue(edit.waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts["profile.name"].label, "ELISSA WOODE")
        edit.tap()
        let oauthName = app.staticTexts["profile.edit.name"]
        XCTAssertTrue(oauthName.waitForExistence(timeout: 3))
        XCTAssertEqual(oauthName.label, "Name, Elissa Woode")
        XCTAssertFalse(app.textFields["profile.edit.name"].exists)
        let department = app.textFields["profile.edit.department"]
        // Tap at the trailing end so the caret lands after the text, then delete it all.
        department.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
        department.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 30))
        department.typeText("Design")
        app.buttons["profile.edit.save"].tap()
        XCTAssertTrue(app.staticTexts["profile.name"].waitForExistence(timeout: 3))
        XCTAssertEqual(app.staticTexts["profile.name"].label, "ELISSA WOODE")
        app.buttons["home.tab.Home"].tap()
        app.buttons["home.tab.Profile"].tap()
        XCTAssertEqual(app.staticTexts["profile.name"].label, "ELISSA WOODE")
        app.buttons["profile.edit"].tap()
        XCTAssertTrue(department.waitForExistence(timeout: 3))
        XCTAssertEqual(department.value as? String, "Design")
        XCTAssertEqual(oauthName.label, "Name, Elissa Woode")
        app.buttons["Cancel"].tap()
        // Memory 0 is album photo "4" (not the first photo): the viewer opens on exactly that photo,
        // with the comment field, and closing it leaves the album grid.
        app.buttons["profile.memory.0"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["photo.viewer.4"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.descendants(matching: .any)["photo.viewer.0"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["photo.comments.message"].waitForExistence(timeout: 5))
        app.buttons["album.photo.close"].tap()
        XCTAssertTrue(app.buttons["album.back"].waitForExistence(timeout: 3))
        app.buttons["album.back"].tap()
        XCTAssertTrue(app.buttons["profile.edit"].exists)
    }
}
