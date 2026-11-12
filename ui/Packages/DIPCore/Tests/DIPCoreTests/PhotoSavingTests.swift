import DIPCore
import XCTest

final class PhotoSavingTests: XCTestCase {
    func testPositionTextIsSlashFormattedAndClamped() {
        XCTAssertEqual(DIPPhotoCount.text(index: 3, count: 12), "3/12")
        XCTAssertEqual(DIPPhotoCount.text(index: 12, count: 12), "12/12")
        XCTAssertEqual(DIPPhotoCount.text(index: 0, count: 5), "1/5")
        XCTAssertEqual(DIPPhotoCount.text(index: 9, count: 5), "5/5")
        XCTAssertEqual(DIPPhotoCount.text(index: 1, count: 0), "1/1")
        XCTAssertEqual(DIPPhotoCount.spoken(index: 3, count: 12), "Photo 3 of 12")
    }

    func testLabelWidthDependsOnTheAlbumSizeNotTheCurrentPhoto() {
        XCTAssertEqual(DIPPhotoCount.labelWidth(count: 12), DIPPhotoCount.labelWidth(count: 99))
        XCTAssertGreaterThan(DIPPhotoCount.labelWidth(count: 120), DIPPhotoCount.labelWidth(count: 99))
    }

    func testPlanSkipsPhotosAlreadySavedAndDuplicates() {
        let plan = DIPAlbumSaveProgress.plan(photoIDs: ["a", "b", "c", "b", "d"], alreadySaved: ["a", "d", "zzz"])
        XCTAssertEqual(plan.toSave, ["b", "c"])
        XCTAssertEqual(plan.skipped, 2)
        let none = DIPAlbumSaveProgress.plan(photoIDs: [], alreadySaved: [])
        XCTAssertTrue(none.toSave.isEmpty); XCTAssertEqual(none.skipped, 0)
    }

    func testProgressLabelCountsTheCurrentPhotoAndNeverExceedsTheTotal() {
        var progress = DIPAlbumSaveProgress(total: 12, skipped: 0)
        XCTAssertEqual(progress.label, "Saving 1 of 12")
        for _ in 0..<3 { progress.recordSaved() }
        XCTAssertEqual(progress.label, "Saving 4 of 12")
        XCTAssertEqual(progress.fraction, 0.25, accuracy: 0.0001)
        for _ in 0..<9 { progress.recordSaved() }
        XCTAssertTrue(progress.isFinished)
        XCTAssertEqual(progress.label, "Saving 12 of 12")
    }

    func testSummariesCoverSavedSkippedFailedCancelledAndEmpty() {
        var all = DIPAlbumSaveProgress(total: 2, skipped: 0); all.recordSaved(); all.recordSaved()
        XCTAssertEqual(all.summary, "Saved 2 photos to Photos")
        var one = DIPAlbumSaveProgress(total: 1, skipped: 3); one.recordSaved()
        XCTAssertEqual(one.summary, "Saved 1 photo · 3 already saved")
        var mixed = DIPAlbumSaveProgress(total: 3, skipped: 0); mixed.recordSaved(); mixed.recordFailed("x"); mixed.recordFailed("y")
        XCTAssertEqual(mixed.summary, "Saved 1 photo. Couldn’t save 2.")
        XCTAssertTrue(mixed.isFinished)
        var failedOnly = DIPAlbumSaveProgress(total: 1, skipped: 0); failedOnly.recordFailed("x")
        XCTAssertEqual(failedOnly.summary, "Couldn’t save 1 photo. Try again.")
        var stopped = DIPAlbumSaveProgress(total: 5, skipped: 0); stopped.recordSaved(); stopped.cancel()
        XCTAssertEqual(stopped.summary, "Stopped after saving 1 photo")
        XCTAssertTrue(stopped.isFinished)
        XCTAssertEqual(DIPAlbumSaveProgress(total: 0, skipped: 4).summary, "All photos are already saved")
    }
}
