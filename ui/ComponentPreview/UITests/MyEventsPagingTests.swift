import XCTest

/// My Events is two real horizontal pages (Active Events, Memories) under a pinned toggle. Each page carries the
/// 20pt page padding inside itself, so nothing is clipped at the padding while swiping.
final class MyEventsPagingTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--screen=events"]
        app.launch()
        return app
    }

    @MainActor func testSwipingTheContentMovesTheToggleAndTheToggleMovesTheContent() {
        let app = launch()
        let puppy = app.buttons["events.card.puppy-yoga"]
        XCTAssertTrue(puppy.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["events.segment.active"].isSelected)
        app.swipeLeft()
        let album = app.buttons["events.album.0"]
        XCTAssertTrue(album.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["events.segment.memories"].isSelected, "the pill follows the swipe")
        XCTAssertTrue(album.isHittable)
        app.swipeRight()
        XCTAssertTrue(app.buttons["events.segment.active"].isSelected)
        XCTAssertTrue(puppy.isHittable)
        app.buttons["events.segment.memories"].tap()
        XCTAssertTrue(album.isHittable, "the toggle moves the content")
    }

    @MainActor func testNeitherPageIsClippedInsideThePagePaddingAtRest() {
        let app = launch()
        let width = app.frame.width
        let puppy = app.buttons["events.card.puppy-yoga"]
        XCTAssertTrue(puppy.waitForExistence(timeout: 10))
        XCTAssertEqual(puppy.frame.minX, 20, accuracy: 0.5)
        XCTAssertEqual(puppy.frame.maxX, width - 20, accuracy: 0.5)
        // The other page sits a full screen away and is hidden from accessibility while it is off screen.
        let album = app.buttons["events.album.0"]
        XCTAssertFalse(album.exists, "the off-screen page is not an accessibility target")
        app.buttons["events.segment.memories"].tap()
        XCTAssertTrue(album.waitForExistence(timeout: 5))
        XCTAssertTrue(album.isHittable)
        let second = app.buttons["events.album.1"]
        for card in [album, second] where card.exists {
            XCTAssertGreaterThanOrEqual(card.frame.minX, 20 - 0.5)
            XCTAssertLessThanOrEqual(card.frame.maxX, width - 20 + 0.5)
        }
        XCTAssertFalse(puppy.exists, "the active page is off screen and hidden from accessibility")
    }

    @MainActor func testRapidTogglingEndsOnTheLastTappedPage() {
        let app = launch()
        XCTAssertTrue(app.buttons["events.card.puppy-yoga"].waitForExistence(timeout: 10))
        app.buttons["events.segment.memories"].tap()
        app.buttons["events.segment.active"].tap()
        app.buttons["events.segment.memories"].tap()
        app.buttons["events.segment.active"].tap()
        XCTAssertTrue(app.buttons["events.segment.active"].isSelected)
        XCTAssertTrue(app.buttons["events.card.puppy-yoga"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["events.card.puppy-yoga"].isHittable)
        XCTAssertFalse(app.buttons["events.segment.memories"].isSelected)
    }

    @MainActor func testMemoriesDestinationOpensOnTheMemoriesPage() {
        let app = XCUIApplication()
        app.launchArguments = ["--screen=memories"]
        app.launch()
        XCTAssertTrue(app.buttons["events.album.0"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["events.segment.memories"].isSelected)
        XCTAssertTrue(app.buttons["events.album.0"].isHittable, "the page, not just the pill, is on Memories")
    }

    @MainActor func testEachPageKeepsItsOwnVerticalScrollPosition() {
        let app = launch()
        XCTAssertTrue(app.buttons["events.card.puppy-yoga"].waitForExistence(timeout: 10))
        app.buttons["events.segment.memories"].tap()
        XCTAssertTrue(app.buttons["events.album.0"].waitForExistence(timeout: 5))
        let topBefore = app.buttons["events.album.0"].frame.minY
        app.swipeUp()
        app.buttons["events.segment.active"].tap()
        XCTAssertTrue(app.buttons["events.card.puppy-yoga"].isHittable, "the active page was not scrolled by the other")
        app.buttons["events.segment.memories"].tap()
        XCTAssertLessThanOrEqual(app.buttons["events.album.0"].frame.minY, topBefore, "memories stayed where it was scrolled")
    }
}
