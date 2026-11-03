import XCTest

final class ConversationFlowTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor func testChatRetryAndReopeningKeepObservedMessages() {
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event-joined", "--fail-chat-once"]
        app.launch()
        let primary = app.buttons["event.primary"]
        XCTAssertTrue(primary.waitForExistence(timeout: 10))
        primary.tap()
        let field = app.descendants(matching: .any)["event.chat.message"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["event.chat.send"].isEnabled)
        field.tap()
        field.typeText("See you at puppy yoga!")
        app.buttons["event.chat.send"].tap()
        XCTAssertTrue(app.buttons["event.chat.retry"].waitForExistence(timeout: 5))
        XCTAssertEqual(field.value as? String, "See you at puppy yoga!")
        XCTAssertFalse(app.staticTexts["See you at puppy yoga!"].exists)
        app.buttons["event.chat.retry"].tap()
        XCTAssertTrue(app.staticTexts["See you at puppy yoga!"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        primary.tap()
        XCTAssertTrue(app.staticTexts["See you at puppy yoga!"].waitForExistence(timeout: 5))
        let deliveredRows = app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier BEGINSWITH %@ AND label CONTAINS %@", "event.chat.message.", "See you at puppy yoga!"))
        XCTAssertEqual(deliveredRows.count, 1, "Retry must render exactly one observed message row")
    }

    @MainActor func testPhotoCommentRetryReopeningAndThreadIsolation() {
        let app = XCUIApplication()
        app.launchArguments = ["--screen=album", "--fail-comment-once"]
        app.launch()
        let photo = app.buttons["album.photo.0"]
        XCTAssertTrue(photo.waitForExistence(timeout: 10))
        photo.tap()
        let field = app.descendants(matching: .any)["photo.comments.message"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["photo.comments.send"].isEnabled)
        field.tap()
        field.typeText("Such a lovely afternoon!")
        let send = app.buttons["photo.comments.send"]
        XCTAssertTrue(send.isEnabled)
        XCTAssertTrue(send.isHittable)
        if app.keyboards.firstMatch.exists {
            XCTAssertLessThanOrEqual(send.frame.maxY, app.keyboards.firstMatch.frame.minY + 0.5)
        }
        send.tap()
        let retryAppeared = app.buttons["photo.comments.retry"].waitForExistence(timeout: 5)
        XCTAssertTrue(retryAppeared)
        XCTAssertEqual(field.value as? String, "Such a lovely afternoon!")
        app.buttons["photo.comments.retry"].tap()
        let bubble = app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
            "photo.comments.comment.", "Such a lovely afternoon!"
        )).firstMatch
        XCTAssertTrue(bubble.waitForExistence(timeout: 5))
        XCTAssertLessThanOrEqual(bubble.frame.width, 134.5)
        XCTAssertEqual(bubble.frame.height, 44, accuracy: 0.5)
        let image = app.descendants(matching: .any)["photo.comments.image"]
        XCTAssertTrue(image.exists)
        let overlap = bubble.frame.intersection(image.frame)
        XCTAssertGreaterThan(overlap.height, 0)
        XCTAssertLessThan(overlap.height, bubble.frame.height)
        app.buttons["album.photo.close"].tap()
        photo.tap()
        XCTAssertTrue(bubble.waitForExistence(timeout: 5))
        app.buttons["album.photo.close"].tap()
        app.buttons["album.photo.1"].tap()
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertFalse(bubble.exists)
    }
    @MainActor func testFourCompactBubblesExpandAtPhotoCenter() {
        let app = XCUIApplication()
        app.launchArguments = ["--screen=album", "--comment-bubble-fixtures"]
        app.launch()
        XCTAssertTrue(app.buttons["album.photo.0"].waitForExistence(timeout: 10))
        app.buttons["album.photo.0"].tap()
        let compact = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "photo.comments.comment."))
        XCTAssertTrue(app.buttons["photo.comments.comment.review-2"].waitForExistence(timeout: 5))
        XCTAssertEqual(compact.count, 4)
        XCTAssertFalse(app.buttons["photo.comments.comment.review-0"].exists)
        let image = app.descendants(matching: .any)["photo.comments.image"]
        let selected = app.buttons["photo.comments.comment.review-2"]
        XCTAssertLessThanOrEqual(selected.frame.width, 134.5)
        XCTAssertEqual(selected.frame.height, 44, accuracy: 0.5)
        let compactCapture = XCTAttachment(screenshot: app.screenshot())
        compactCapture.name = "photo-comments-compact"
        compactCapture.lifetime = .keepAlways
        add(compactCapture)
        selected.tap()
        let expanded = app.descendants(matching: .any)["photo.comments.expanded.review-2"]
        XCTAssertTrue(expanded.waitForExistence(timeout: 5))
        XCTAssertEqual(expanded.frame.midX, image.frame.midX, accuracy: 0.5)
        XCTAssertEqual(expanded.frame.midY, image.frame.midY, accuracy: 0.5)
        XCTAssertLessThanOrEqual(expanded.frame.height, 108.5)
        let text = app.scrollViews["photo.comments.expanded-text"]
        XCTAssertTrue(text.exists)
        text.swipeUp()
        XCTAssertTrue(expanded.exists)
        let expandedCapture = XCTAttachment(screenshot: app.screenshot())
        expandedCapture.name = "photo-comments-expanded"
        expandedCapture.lifetime = .keepAlways
        add(expandedCapture)
        image.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)).tap()
        XCTAssertFalse(expanded.exists)
        XCTAssertEqual(compact.count, 4)
    }

    @MainActor func testParticipantsRequireJoinBeforeChat() {
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event"]
        app.launch()
        XCTAssertTrue(app.buttons["event.attendees"].waitForExistence(timeout: 10))
        app.buttons["event.attendees"].tap()
        let join = app.buttons["participants.join"]
        XCTAssertTrue(join.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["participants.chat"].exists)
        join.tap()
        let chat = app.buttons["participants.chat"]
        XCTAssertTrue(chat.waitForExistence(timeout: 5))
        chat.tap()
        XCTAssertTrue(app.buttons["event.chat.send"].waitForExistence(timeout: 5))
    }

    @MainActor func testChatComposerIsVisibleWithHistoryAndKeyboard() {
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event-joined", "--chat-history-fixtures"]
        app.launch()
        XCTAssertTrue(app.buttons["event.primary"].waitForExistence(timeout: 10))
        app.buttons["event.primary"].tap()
        let field = app.descendants(matching: .any)["event.chat.message"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        let send = app.buttons["event.chat.send"]
        XCTAssertTrue(field.isHittable)
        XCTAssertLessThanOrEqual(send.frame.maxY, app.frame.maxY)
        let latest = app.descendants(matching: .any)["event.chat.message.history-34"]
        XCTAssertTrue(latest.waitForExistence(timeout: 5))
        XCTAssertTrue(latest.isHittable)
        let closed = XCTAttachment(screenshot: app.screenshot())
        closed.name = "event-chat-history"; closed.lifetime = .keepAlways; add(closed)
        app.scrollViews["event.chat.messages"].swipeDown()
        field.tap()
        field.typeText("See you at the entrance!")
        XCTAssertTrue(send.isHittable)
        if app.keyboards.firstMatch.exists {
            XCTAssertLessThanOrEqual(send.frame.maxY, app.keyboards.firstMatch.frame.minY + 0.5)
        }
        let keyboard = XCTAttachment(screenshot: app.screenshot())
        keyboard.name = app.keyboards.firstMatch.exists ? "event-chat-keyboard" : "event-chat-focused"; keyboard.lifetime = .keepAlways; add(keyboard)
        send.tap()
        XCTAssertTrue(app.staticTexts["See you at the entrance!"].waitForExistence(timeout: 5))
    }

    @MainActor func testEmptyChatCanStartAConversation() {
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event-joined", "--empty-social-fixtures"]
        app.launch()
        XCTAssertTrue(app.buttons["event.primary"].waitForExistence(timeout: 10))
        app.buttons["event.primary"].tap()
        XCTAssertTrue(app.staticTexts["Start the conversation"].waitForExistence(timeout: 5))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "event-chat-empty"; screenshot.lifetime = .keepAlways; add(screenshot)
        let field = app.descendants(matching: .any)["event.chat.message"]
        field.tap(); field.typeText("Hello everyone!")
        app.buttons["event.chat.send"].tap()
        XCTAssertTrue(app.staticTexts["Hello everyone!"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Start the conversation"].exists)
    }

    @MainActor func testEarlierCommentsRemainReachableWithoutAThreadPanel() {
        let app = XCUIApplication()
        app.launchArguments = ["--screen=album", "--comment-bubble-fixtures"]
        app.launch()
        XCTAssertTrue(app.buttons["album.photo.0"].waitForExistence(timeout: 10))
        app.buttons["album.photo.0"].tap()
        let image = app.descendants(matching: .any)["photo.comments.image"]
        XCTAssertTrue(app.buttons["photo.comments.comment.review-2"].waitForExistence(timeout: 5))
        image.swipeLeft()
        XCTAssertTrue(app.buttons["photo.comments.comment.review-0"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["photo.comments.comment.review-2"].exists)
        image.swipeRight()
        XCTAssertTrue(app.buttons["photo.comments.comment.review-2"].waitForExistence(timeout: 5))
    }

    @MainActor func testSoftwareKeyboardKeepsComposerVisible() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event-joined"]
        app.launch()
        XCTAssertTrue(app.buttons["event.primary"].waitForExistence(timeout: 10))
        app.buttons["event.primary"].tap()
        let field = app.descendants(matching: .any)["event.chat.message"]
        XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap()
        guard app.keyboards.firstMatch.waitForExistence(timeout: 3) else {
            throw XCTSkip("Software keyboard unavailable; physical keyboard input is not avoidance evidence")
        }
        let send = app.buttons["event.chat.send"]
        XCTAssertLessThanOrEqual(send.frame.maxY, app.keyboards.firstMatch.frame.minY + 0.5)
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "event-chat-software-keyboard"; capture.lifetime = .keepAlways; add(capture)
    }

    @MainActor func testConsecutiveMessagesShareMetadata() {
        let app = XCUIApplication()
        app.launchArguments = ["--screen=event-joined", "--chat-grouping-fixtures"]
        app.launch()
        XCTAssertTrue(app.buttons["event.primary"].waitForExistence(timeout: 10))
        app.buttons["event.primary"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["event.chat.message.group-5"].waitForExistence(timeout: 5))
        let groups = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "event.chat.group."))
        XCTAssertEqual(groups.count, 3)
        let first = app.descendants(matching: .any)["event.chat.message.group-0"]
        let middle = app.descendants(matching: .any)["event.chat.message.group-1"]
        let last = app.descendants(matching: .any)["event.chat.message.group-2"]
        XCTAssertLessThan(middle.frame.height, first.frame.height)
        XCTAssertLessThan(middle.frame.height, last.frame.height)
        XCTAssertTrue((middle.value as? String)?.contains("Frank White") == true)
        for index in 0..<6 {
            XCTAssertTrue(app.descendants(matching: .any)["event.chat.message.group-\(index)"].exists)
        }
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "event-chat-grouped"; capture.lifetime = .keepAlways; add(capture)
    }

}
