import DIPCore
import XCTest
@testable import DIP

private actor FakeLibrary: PhotoLibraryWriting {
    var granted = true
    var writes: [Data] = []
    var failWriteFor: Set<Data> = []
    func setGranted(_ value: Bool) { granted = value }
    func fail(_ data: Data) { failWriteFor.insert(data) }
    func requestAddAccess() async -> Bool { granted }
    func write(_ data: Data) async throws {
        if failWriteFor.contains(data) { throw URLError(.cannotWriteToFile) }
        writes.append(data)
    }
}

@MainActor final class AlbumPhotoSaverTests: XCTestCase {
    private func data(_ id: String) -> Data { Data(id.utf8) }

    func testSavingAPhotoWritesItOnceAndRemembersIt() async {
        let library = FakeLibrary()
        let saver = AlbumPhotoSaver(library: library)
        let first = await saver.save(eventID: "e", photoID: "a") { self.data($0) }
        XCTAssertEqual(first, .saved)
        let second = await saver.save(eventID: "e", photoID: "a") { self.data($0) }
        XCTAssertEqual(second, .alreadySaved)
        let writes = await library.writes
        XCTAssertEqual(writes, [data("a")])
        XCTAssertTrue(saver.isSaved(eventID: "e", photoID: "a"))
        XCTAssertFalse(saver.isSaved(eventID: "other", photoID: "a"), "saved state is per event")
    }

    func testDeniedAccessWritesNothingAndReportsDenied() async {
        let library = FakeLibrary()
        await library.setGranted(false)
        let saver = AlbumPhotoSaver(library: library)
        let outcome = await saver.save(eventID: "e", photoID: "a") { self.data($0) }
        XCTAssertEqual(outcome, .denied)
        let writes = await library.writes
        XCTAssertTrue(writes.isEmpty)
        XCTAssertFalse(saver.isSaved(eventID: "e", photoID: "a"))
    }

    func testLoadFailuresAreMessagesNotCrashes() async {
        let saver = AlbumPhotoSaver(library: FakeLibrary())
        let offline = await saver.save(eventID: "e", photoID: "a") { _ in throw URLError(.notConnectedToInternet) }
        XCTAssertEqual(offline, .failed("You’re offline. Try again when you’re back online."))
        let other = await saver.save(eventID: "e", photoID: "b") { _ in throw DIPRepositoryError.notFound("x") }
        XCTAssertEqual(other, .failed("Couldn’t save this photo. Try again."))
        XCTAssertFalse(saver.isSaved(eventID: "e", photoID: "a"), "a failed save can be retried")
    }

    private func waitForRun(_ saver: AlbumPhotoSaver) async {
        for _ in 0..<200 where saver.isSavingAll || saver.lastRunSummary == nil && !saver.lastRunDenied {
            try? await Task.sleep(for: .milliseconds(10))
        }
    }

    func testSaveAllSkipsPhotosAlreadySavedThisSessionAndSummarizes() async {
        let library = FakeLibrary()
        let saver = AlbumPhotoSaver(library: library)
        _ = await saver.save(eventID: "e", photoID: "a") { self.data($0) }
        saver.saveAll(eventID: "e", photoIDs: ["a", "b", "c"]) { self.data($0) }
        await waitForRun(saver)
        XCTAssertEqual(saver.lastRunSummary, "Saved 2 photos · 1 already saved")
        let writes = await library.writes
        XCTAssertEqual(writes, [data("a"), data("b"), data("c")])
        // Running again has nothing left to do.
        saver.saveAll(eventID: "e", photoIDs: ["a", "b", "c"]) { self.data($0) }
        XCTAssertEqual(saver.lastRunSummary, "All photos are already saved")
    }

    func testSaveAllContinuesPastAFailureAndRetriesOnlyTheFailedOnes() async {
        let library = FakeLibrary()
        await library.fail(data("b"))
        let saver = AlbumPhotoSaver(library: library)
        saver.saveAll(eventID: "e", photoIDs: ["a", "b", "c"]) { self.data($0) }
        await waitForRun(saver)
        XCTAssertEqual(saver.lastRunSummary, "Saved 2 photos. Couldn’t save 1.")
        XCTAssertTrue(saver.isSaved(eventID: "e", photoID: "c"))
        XCTAssertFalse(saver.isSaved(eventID: "e", photoID: "b"))
    }

    func testSaveAllWithDeniedAccessReportsDeniedOnce() async {
        let library = FakeLibrary()
        await library.setGranted(false)
        let saver = AlbumPhotoSaver(library: library)
        saver.saveAll(eventID: "e", photoIDs: ["a", "b"]) { self.data($0) }
        await waitForRun(saver)
        XCTAssertTrue(saver.lastRunDenied)
        XCTAssertNil(saver.lastRunSummary)
        saver.clearRunResult()
        XCTAssertFalse(saver.lastRunDenied)
    }
}
