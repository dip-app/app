import XCTest

/// Designed empty states, driven by `--empty-state=<fixture>` review data.
final class EmptyStateFlowTests: XCTestCase {
    @MainActor private func launch(_ fixture: String, screen: String, extra: [String] = []) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screen=\(screen)", "--empty-state=\(fixture)"] + extra
        app.launch()
        return app
    }

    @MainActor private func attach(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name; shot.lifetime = .keepAlways; add(shot)
    }

    @MainActor private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    @MainActor func testHomeShowsNoEventsInsteadOfAnEmptyCarousel() {
        let app = launch("home-events", screen: "home")
        let message = element(app, "empty.home-events.message")
        XCTAssertTrue(message.waitForExistence(timeout: 10))
        XCTAssertEqual(message.label, "Nothing planned yet. New company events will show up here.")
        XCTAssertFalse(element(app, "home.events").exists)
        XCTAssertTrue(app.buttons["home.attendees"].exists)
        attach(app, "empty-home-events")
    }

    @MainActor func testHomeRecentsHidesSeeAll() {
        let app = launch("home-recents", screen: "home")
        XCTAssertTrue(element(app, "empty.home-recents.message").waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["home.attendees"].exists)
        attach(app, "empty-home-recents")
    }

    @MainActor func testEventAndParticipantsWithNoAttendees() {
        let app = launch("attendees", screen: "event")
        let message = element(app, "empty.event-attendees.message")
        XCTAssertTrue(message.waitForExistence(timeout: 10))
        XCTAssertEqual(message.label, "Be the first to join. Coworkers who join will show up here.")
        XCTAssertFalse(app.buttons["event.attendees"].exists)
        attach(app, "empty-event-attendees")
    }

    @MainActor func testMyEventsActionReturnsHomeAndMemoriesAreEmpty() {
        let app = launch("my-events", screen: "events")
        XCTAssertTrue(element(app, "empty.my-events-active.message").waitForExistence(timeout: 10))
        attach(app, "empty-my-events-active")
        app.buttons["events.segment.memories"].tap()
        XCTAssertTrue(element(app, "empty.my-events-memories.message").waitForExistence(timeout: 3))
        attach(app, "empty-my-events-memories")
        app.buttons["events.segment.active"].tap()
        let action = app.buttons["empty.my-events-active.action"]
        XCTAssertTrue(action.waitForExistence(timeout: 3))
        XCTAssertGreaterThanOrEqual(action.frame.height, 44)
        action.tap()
        XCTAssertTrue(element(app, "home.events").waitForExistence(timeout: 3))
    }

    @MainActor func testAlbumWithNoPhotos() {
        let app = launch("album", screen: "album")
        XCTAssertTrue(element(app, "empty.album.message").waitForExistence(timeout: 10))
        attach(app, "empty-album")
    }

    @MainActor func testEmptyStatesAtAccessibilityTextSize() {
        let app = launch("my-events", screen: "events", extra: ["--large-text"])
        let action = app.buttons["empty.my-events-active.action"]
        XCTAssertTrue(action.waitForExistence(timeout: 10))
        XCTAssertTrue(action.isHittable)
        attach(app, "empty-my-events-large-text")
    }
}
