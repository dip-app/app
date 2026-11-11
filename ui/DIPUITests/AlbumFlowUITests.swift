import XCTest

/// Album flow in Debug mock-member mode (in-memory fixtures, no Firebase): My Events -> Memories -> past event
/// -> View Album -> Add Photos is offered -> a photo opens in the viewer -> a comment is sent and shown.
final class AlbumFlowUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func openAlbum() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--mock-member"]
        app.launch()
        let myEvents = app.buttons["My Events"]
        XCTAssertTrue(myEvents.waitForExistence(timeout: 20))
        myEvents.tap()
        let memories = app.buttons["events.segment.memories"]
        XCTAssertTrue(memories.waitForExistence(timeout: 10))
        memories.tap()
        let memory = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'events.album.'")).firstMatch
        XCTAssertTrue(memory.waitForExistence(timeout: 10), "no past event in Memories")
        memory.tap()
        let viewAlbum = app.buttons["event.primary"]
        XCTAssertTrue(viewAlbum.waitForExistence(timeout: 10))
        XCTAssertEqual(viewAlbum.label, "View Album")
        viewAlbum.tap()
        XCTAssertTrue(app.buttons["album.photo.0"].waitForExistence(timeout: 10), "album grid did not open")
        return app
    }

    func testAlbumOffersAddPhotosAndOpensThePickerSheet() {
        let app = openAlbum()
        let add = app.buttons["album.add-photos"]
        XCTAssertTrue(add.waitForExistence(timeout: 10), "Add Photos is offered to an attendee")
        add.tap()
        // The system photo picker is out of process; its presentation is enough here (device pass covers picking).
        XCTAssertTrue(add.waitForNonExistence(timeout: 10) || !add.isHittable, "the picker sheet covers the album")
    }

    func testPhotoOpensInTheViewerAndACommentIsShown() {
        let app = openAlbum()
        app.buttons["album.photo.0"].tap()
        let field = app.descendants(matching: .any).matching(identifier: "photo.comments.message").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "viewer composer missing")
        field.tap()
        field.typeText("Great boat day")
        app.buttons["photo.comments.send"].tap()
        let comment = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Great boat day'")).firstMatch
        XCTAssertTrue(comment.waitForExistence(timeout: 10), "sent comment is shown on the photo")
        app.buttons["album.photo.close"].tap()
        XCTAssertTrue(app.buttons["album.photo.0"].waitForExistence(timeout: 10))
    }
}
