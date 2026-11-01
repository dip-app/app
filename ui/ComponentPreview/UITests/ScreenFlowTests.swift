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
        XCTAssertEqual(join.frame.minY, app.frame.height - 101, accuracy: 0.5)
        XCTAssertEqual(join.frame.height, 80, accuracy: 0.5)
        join.tap()
        XCTAssertEqual(join.label, "Activity Chat")
        XCTAssertEqual(app.buttons["event.join"].value as? String, "Joined")
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
        let name = app.textFields["profile.edit.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 3))
        name.tap()
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 30))
        XCTAssertFalse(app.buttons["profile.edit.save"].isEnabled)
        name.typeText("Elissa Test")
        app.buttons["profile.edit.save"].tap()
        XCTAssertTrue(app.staticTexts["ELISSA TEST"].waitForExistence(timeout: 3))
        app.buttons["home.tab.Home"].tap()
        app.buttons["home.tab.Profile"].tap()
        XCTAssertEqual(app.staticTexts["profile.name"].label, "ELISSA TEST")
        app.buttons["profile.memory.0"].tap()
        XCTAssertTrue(app.buttons["album.back"].waitForExistence(timeout: 3))
        app.buttons["album.back"].tap()
        XCTAssertTrue(app.buttons["profile.edit"].exists)
    }
}
