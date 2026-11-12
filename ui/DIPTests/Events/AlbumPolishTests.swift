import DIPCore
import XCTest
@testable import DIP

final class AlbumPolishTests: XCTestCase {
    func testUploadRunAnnouncementsCoverEveryOutcome() {
        XCTAssertNil(DIPAlbumScreen.runAnnouncement(succeeded: 0, failed: 0))
        XCTAssertEqual(DIPAlbumScreen.runAnnouncement(succeeded: 1, failed: 0), "Photo added")
        XCTAssertEqual(DIPAlbumScreen.runAnnouncement(succeeded: 3, failed: 0), "3 photos added")
        XCTAssertEqual(DIPAlbumScreen.runAnnouncement(succeeded: 0, failed: 1), "1 photo couldn’t be added. Retry is available.")
        XCTAssertEqual(DIPAlbumScreen.runAnnouncement(succeeded: 0, failed: 2), "2 photos couldn’t be added. Retry is available.")
        XCTAssertEqual(DIPAlbumScreen.runAnnouncement(succeeded: 2, failed: 1), "2 added, 1 couldn’t be added. Retry is available.")
    }

    func testRSVPAnnouncementsNameTheActivity() {
        XCTAssertEqual(DIPPrototypeApp.rsvpAnnouncement(title: "Kayaking", going: true), "You joined Kayaking")
        XCTAssertEqual(DIPPrototypeApp.rsvpAnnouncement(title: "Kayaking", going: false), "You left Kayaking")
        XCTAssertEqual(DIPPrototypeApp.rsvpAnnouncement(title: nil, going: true), "You joined")
    }

    func testCommentSendErrorsSayWhatHappened() {
        XCTAssertTrue(DIPPhotoCommentsScreen.sendErrorMessage(for: URLError(.notConnectedToInternet)).contains("offline"))
        XCTAssertEqual(DIPPhotoCommentsScreen.sendErrorMessage(for: DIPRepositoryError.invalidInput("Comments are closed.")), "Comments are closed.")
        XCTAssertEqual(DIPPhotoCommentsScreen.sendErrorMessage(for: DIPRepositoryError.invalidInput("")), "Your comment could not be sent. Try again.")
        XCTAssertEqual(DIPPhotoCommentsScreen.sendErrorMessage(for: CancellationError()), "Your comment could not be sent. Try again.")
    }
}
