import XCTest

/// Album upload drafts in the Preview app (`--album-upload-review`: two failed, one finished, one uploading).
final class AlbumUploadTileTests: XCTestCase {
    @MainActor private func launch() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--screen=album", "--album-upload-review"]
        app.launch()
        return app
    }

    @MainActor private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    /// Regression: a finished upload tile (success checkmark) stayed on screen after the batch completed.
    @MainActor func testFinishedUploadTileIsReplacedAndNeverLingers() {
        let app = launch()
        XCTAssertTrue(element(app, "album.upload.status").waitForExistence(timeout: 15))
        let finished = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Photo added'")).firstMatch
        // The success state is brief (about 1 s), then the tile goes; the grace adds 3 s at most.
        XCTAssertTrue(finished.waitForNonExistence(timeout: 12), "finished upload tile is still shown")
        XCTAssertTrue(element(app, "album.upload.status").label.contains("2 couldn’t be added"))
        XCTAssertTrue(element(app, "album.upload.status").label.contains("1 uploading"))
        XCTAssertTrue(app.buttons["album.upload.retry.0"].exists, "failed drafts stay for retry")
    }

    @MainActor func testRemovingAFailedDraftUpdatesTheStrip() {
        let app = launch()
        let status = element(app, "album.upload.status")
        XCTAssertTrue(status.waitForExistence(timeout: 15))
        let remove = app.buttons["album.upload.remove.0"]
        XCTAssertTrue(remove.waitForExistence(timeout: 10))
        remove.tap()
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS '1 couldn’t be added'"), object: status)
        XCTAssertEqual(XCTWaiter().wait(for: [expectation], timeout: 10), .completed)
    }
}
