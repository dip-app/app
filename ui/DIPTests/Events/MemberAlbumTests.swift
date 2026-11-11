import XCTest
import DIPContracts
import DIPCore
import DIPDesignSystem
import DIPMockData
import ImageIO
import UniformTypeIdentifiers
@preconcurrency import FirebaseFunctions
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseStorage
@testable import DIP

@MainActor final class MemberAlbumTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 2_000_000_000)
    let scope = EventReadScope(uid: "member", companyID: "alpha")

    private func event(_ id: String, endsIn offset: TimeInterval, status: String = "scheduled") -> DIPContracts.Event {
        DIPContracts.Event(id: id, companyId: "alpha", title: "Boat Ride", description: "", tagIds: [], coverImageURL: "",
            startTime: now.addingTimeInterval(offset - 3600), endTime: now.addingTimeInterval(offset),
            venue: Venue(name: "Lake", address: "1 Shore", locality: "Pittsburgh", latitude: 40, longitude: -79),
            costCents: 0, costNote: "", capacity: 20, pointsValue: 0, isOutdoor: true, status: status,
            attendeeCount: 1, createdBy: "host", createdAt: now, revision: 1)
    }

    private func make(_ reads: AlbumReadsStub, _ participation: AlbumParticipationStub, _ albums: AlbumSourceStub) -> MemberEventAppRepository {
        let repository = MemberEventsRepository(scope: scope, source: reads, currentUID: { "member" })
        let profile = DIPProfile(id: "member", displayName: "Member", department: "", city: "", interestTagIDs: [], interestCatalog: [],
                                 photo: .data(Data()), avatar: .data(Data()), favoriteMemories: [])
        return MemberEventAppRepository(reads: repository, profile: profile, participation: participation, albums: albums,
                                        chatAuthor: ChatAuthor(name: "Member", avatarID: "a1"), clock: { self.now })
    }

    /// Opens the boat ride (ended, joined) and waits until its album has loaded.
    private func openAlbum(_ repository: MemberEventAppRepository, _ participation: AlbumParticipationStub,
                           _ albums: AlbumSourceStub, records: [AlbumPhotoRecord] = []) async throws {
        let stream = await repository.observe(); var iterator = stream.makeAsyncIterator()
        _ = try await iterator.next()
        participation.joined?.yield(["boat"])
        repository.selectDetail("boat")
        try await waitFor { albums.photos != nil }
        albums.photos?.yield(records)
        var found: DIPAppSnapshot?
        repeat { found = try await iterator.next() } while found?.albums["boat"]?.isLoaded != true
    }

    private func waitFor(_ condition: @escaping () -> Bool) async throws {
        for _ in 0..<200 where !condition() { try await Task.sleep(for: .milliseconds(5)) }
        XCTAssertTrue(condition())
    }

    private func record(_ id: String, uploader: String) -> AlbumPhotoRecord {
        AlbumPhotoRecord(id: id, uploaderID: uploader, uploaderName: "Name \(uploader)",
                         storagePath: "companies/alpha/events/boat/photos/\(uploader)/0", createdAt: now, commentCount: 0)
    }

    func testPolicySlotsMatchTheStorageRules() {
        XCTAssertEqual(AlbumPolicy.storagePath(scope: scope, eventID: "boat", slot: 7), "companies/alpha/events/boat/photos/member/7")
        XCTAssertEqual(AlbumPolicy.photoID(uid: "member", slot: 19), "member_19")
        XCTAssertEqual(AlbumPolicy.slot(photoID: "member_19", uid: "member"), 19)
        XCTAssertNil(AlbumPolicy.slot(photoID: "member_20", uid: "member"))
        XCTAssertNil(AlbumPolicy.slot(photoID: "member_01", uid: "member"))
        XCTAssertNil(AlbumPolicy.slot(photoID: "other_3", uid: "member"))
        XCTAssertEqual(AlbumPolicy.freeSlot(taken: [0, 1, 3]), 2)
        XCTAssertNil(AlbumPolicy.freeSlot(taken: Set(0..<20)))
    }

    func testAttendeeOfEndedEventSeesLiveAlbumWithUploadRightsAndAttribution() async throws {
        let reads = AlbumReadsStub(); reads.extra = [event("boat", endsIn: -600)]
        let participation = AlbumParticipationStub(), albums = AlbumSourceStub()
        let repository = make(reads, participation, albums)
        let later = await repository.observe(); var iterator = later.makeAsyncIterator()
        try await openAlbum(repository, participation, albums,
                            records: [record("other_0", uploader: "other"), record("member_0", uploader: "member")])
        var snapshot: DIPAppSnapshot?
        repeat { snapshot = try await iterator.next() } while snapshot?.albums["boat"]?.photos.count != 2
        let album = try XCTUnwrap(snapshot?.albums["boat"])
        XCTAssertTrue(album.canAddPhotos)
        XCTAssertEqual(album.remainingUploads, 19, "own published photos use slots")
        XCTAssertEqual(album.photos.first?.attribution, DIPPhotoAttribution(name: "Name other", avatar: .generatedAvatar(userID: "other")))
        repository.stop()
        XCTAssertTrue(albums.stopped, "sign-out disposes album listeners")
        try await waitFor { albums.photosTerminated }
    }

    func testNonAttendeeAndCancelledOrLiveEventsCannotUpload() async throws {
        for (joined, ev, reason) in [(false, event("boat", endsIn: -600), AlbumFailure.notAttendee), (true, event("boat", endsIn: 600), .notEnded),
                                     (true, event("boat", endsIn: -600, status: "cancelled"), .cancelled)] {
            let reads = AlbumReadsStub(); reads.extra = [ev]
            let participation = AlbumParticipationStub(), albums = AlbumSourceStub()
            let repository = make(reads, participation, albums)
            let stream = await repository.observe(); var iterator = stream.makeAsyncIterator()
            _ = try await iterator.next()
            participation.joined?.yield(joined ? ["boat"] : [])
            repository.selectDetail("boat")
            if joined {
                // Wait for the joined event's record (fetched by ID) before asking for upload rights.
                var seen: DIPAppSnapshot?
                repeat { seen = try await iterator.next() } while seen?.eventDetails["boat"]?.isJoined != true
            }
            do {
                _ = try await repository.uploadPhoto(eventID: "boat", photo: PhotoUpload(id: "u1", data: Data([1])), progress: { _ in })
                XCTFail("upload must be refused")
            } catch {
                XCTAssertEqual(error as? DIPRepositoryError, .invalidInput(reason.message))
            }
            XCTAssertTrue(albums.uploads.isEmpty)
            repository.stop()
        }
    }

    func testUploadPicksFreeSlotsSkipsOrphansAndRetriesReuseTheSameSlot() async throws {
        let reads = AlbumReadsStub(); reads.extra = [event("boat", endsIn: -600)]
        let participation = AlbumParticipationStub(), albums = AlbumSourceStub()
        albums.own = ["member_0"]
        albums.occupied = [1]
        let repository = make(reads, participation, albums)
        try await openAlbum(repository, participation, albums)
        // Slot 0 is published, slot 1 holds an abandoned upload: the photo lands in slot 2.
        albums.finalizeFailure = .unavailable
        do {
            _ = try await repository.uploadPhoto(eventID: "boat", photo: PhotoUpload(id: "u1", data: Data([1])), progress: { _ in })
            XCTFail("finalize failed")
        } catch { XCTAssertEqual(error as? DIPRepositoryError, .invalidInput(AlbumFailure.unavailable.message)) }
        XCTAssertEqual(albums.uploads.map(\.slot), [1, 2])
        // The retry keeps slot 2 (its bytes already landed) and only finalizes once.
        albums.finalizeFailure = nil
        let id = try await repository.uploadPhoto(eventID: "boat", photo: PhotoUpload(id: "u1", data: Data([1])), progress: { _ in })
        XCTAssertEqual(id, "member_2")
        XCTAssertEqual(albums.uploads.map(\.slot), [1, 2, 2])
        XCTAssertEqual(albums.finalized, [2])
        // A different photo takes the next free slot.
        let next = try await repository.uploadPhoto(eventID: "boat", photo: PhotoUpload(id: "u2", data: Data([2])), progress: { _ in })
        XCTAssertEqual(next, "member_3")
        repository.stop()
    }

    func testLimitReachedWhenAllSlotsAreUsed() async throws {
        let reads = AlbumReadsStub(); reads.extra = [event("boat", endsIn: -600)]
        let participation = AlbumParticipationStub(), albums = AlbumSourceStub()
        albums.own = Set((0..<20).map { "member_\($0)" })
        let repository = make(reads, participation, albums)
        try await openAlbum(repository, participation, albums)
        do {
            _ = try await repository.uploadPhoto(eventID: "boat", photo: PhotoUpload(id: "u1", data: Data([1])), progress: { _ in })
            XCTFail("limit")
        } catch { XCTAssertEqual(error as? DIPRepositoryError, .invalidInput(AlbumFailure.limitReached.message)) }
        XCTAssertTrue(albums.uploads.isEmpty)
        repository.stop()
    }

    func testViewedPhotoCommentsAreObservedAndSentAsTheMember() async throws {
        let reads = AlbumReadsStub(); reads.extra = [event("boat", endsIn: -600)]
        let participation = AlbumParticipationStub(), albums = AlbumSourceStub()
        let repository = make(reads, participation, albums)
        let later = await repository.observe(); var iterator = later.makeAsyncIterator()
        try await openAlbum(repository, participation, albums, records: [record("other_0", uploader: "other")])
        repository.selectPhoto(eventID: "boat", photoID: "other_0")
        try await waitFor { albums.comments != nil }
        albums.comments?.yield([PhotoCommentRecord(id: "c1", authorID: "other", authorName: "Other", text: "Great day", createdAt: now)])
        var snapshot: DIPAppSnapshot?
        repeat { snapshot = try await iterator.next() } while snapshot?.photoComments["boat"]?["other_0"]?.isEmpty ?? true
        XCTAssertEqual(snapshot?.photoComments["boat"]?["other_0"]?.first?.authorAvatar, .generatedAvatar(userID: "other"))
        try await repository.addPhotoComment(eventID: "boat", photoID: "other_0", commentID: "comment-123", text: "Nice")
        XCTAssertEqual(albums.sentComments.first?.author, ChatAuthor(name: "Member", avatarID: "a1"))
        // The rules compare author fields with the current profile: an avatar change applies to the next comment.
        repository.updateAuthor(ChatAuthor(name: "Member", avatarID: "a2"))
        try await repository.addPhotoComment(eventID: "boat", photoID: "other_0", commentID: "comment-456", text: "Again")
        XCTAssertEqual(albums.sentComments.last?.author, ChatAuthor(name: "Member", avatarID: "a2"))
        repository.selectPhoto(eventID: "boat", photoID: nil)
        try await waitFor { albums.commentsTerminated }
        repository.stop()
    }

    func testFirestoreRecordsAreScopedToTheirCompanyAndEvent() {
        let fields: [String: Any] = ["companyId": "alpha", "eventId": "boat", "uploaderId": "u", "uploaderName": "U",
                                     "storagePath": "companies/alpha/events/boat/photos/u/0", "commentCount": 2,
                                     "createdAt": Timestamp(date: now)]
        XCTAssertEqual(FirebasePhotoAlbumSource.photoRecord(id: "u_0", fields: fields, companyID: "alpha", eventID: "boat")?.commentCount, 2)
        XCTAssertNil(FirebasePhotoAlbumSource.photoRecord(id: "u_0", fields: fields, companyID: "beta", eventID: "boat"))
        var foreignPath = fields; foreignPath["storagePath"] = "companies/beta/events/boat/photos/u/0"
        XCTAssertNil(FirebasePhotoAlbumSource.photoRecord(id: "u_0", fields: foreignPath, companyID: "alpha", eventID: "boat"))
        let comment: [String: Any] = ["companyId": "alpha", "photoId": "u_0", "authorId": "x", "authorName": "X", "text": "Hi",
                                      "createdAt": Timestamp(date: now)]
        XCTAssertNotNil(FirebasePhotoAlbumSource.commentRecord(id: "c", fields: comment, companyID: "alpha", photoID: "u_0"))
        XCTAssertNil(FirebasePhotoAlbumSource.commentRecord(id: "c", fields: comment, companyID: "alpha", photoID: "u_1"))
    }

    func testFinalizeReasonsMapToReadableFailures() {
        func functionsError(_ code: FunctionsErrorCode, _ reason: String?) -> NSError {
            NSError(domain: FunctionsErrorDomain, code: code.rawValue,
                    userInfo: reason.map { [FunctionsErrorDetailsKey: ["reason": $0]] } ?? [:])
        }
        XCTAssertEqual(FirebasePhotoAlbumSource.failure(functionsError(.permissionDenied, "NOT_ATTENDEE")), .notAttendee)
        XCTAssertEqual(FirebasePhotoAlbumSource.failure(functionsError(.failedPrecondition, "EVENT_NOT_ENDED")), .notEnded)
        XCTAssertEqual(FirebasePhotoAlbumSource.failure(functionsError(.failedPrecondition, "UPLOAD_INVALID")), .invalidImage)
        XCTAssertEqual(FirebasePhotoAlbumSource.failure(functionsError(.unavailable, nil)), .unavailable)
        XCTAssertEqual(FirebasePhotoAlbumSource.failure(NSError(domain: StorageErrorDomain, code: StorageErrorCode.unauthorized.rawValue)), .notAttendee)
        XCTAssertEqual(FirebasePhotoAlbumSource.failure(NSError(domain: NSURLErrorDomain, code: NSURLErrorNotConnectedToInternet)), .unavailable)
        XCTAssertEqual(FirebasePhotoAlbumSource.md5Base64(Data("abc".utf8)), "kAFQmDzST7DWlj99KOF/cg==")
    }

    func testPreparationConvertsToJPEGWithinTheLimits() throws {
        let png = try Self.image(width: 4000, height: 3000, type: .png)
        let jpeg = try AlbumImageProcessing.prepareUpload(png)
        XCTAssertEqual(Array(jpeg.prefix(3)), [0xff, 0xd8, 0xff], "always JPEG")
        let source = try XCTUnwrap(CGImageSourceCreateWithData(jpeg as CFData, nil))
        let properties = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
        XCTAssertEqual(properties[kCGImagePropertyPixelWidth] as? Int, 2048)
        XCTAssertEqual(properties[kCGImagePropertyPixelHeight] as? Int, 1536)
        XCTAssertLessThanOrEqual(jpeg.count, AlbumPolicy.maxBytes)
        XCTAssertThrowsError(try AlbumImageProcessing.prepareUpload(Data("not an image".utf8)))
        XCTAssertThrowsError(try AlbumImageProcessing.prepareUpload(png, maxBytes: 10)) { error in
            XCTAssertEqual(error as? AlbumImageProcessing.Failure, .tooLarge)
        }
        XCTAssertNotNil(AlbumImageProcessing.displayCopy(jpeg))
        // Transparent PNG pixels become white, not black.
        let clear = try Self.image(width: 8, height: 8, type: .png, alpha: 0)
        let flattened = try XCTUnwrap(AlbumImageProcessing.downsample(AlbumImageProcessing.prepareUpload(clear), maxPixelSize: 8))
        let pixel = try XCTUnwrap(flattened.dataProvider?.data as Data?)
        XCTAssertGreaterThan(pixel[0], 240)
    }

    static func image(width: Int, height: Int, type: UTType, alpha: CGFloat = 1) throws -> Data {
        let context = try XCTUnwrap(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                              space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.setFillColor(CGColor(red: 0.4, green: 0.5, blue: 0.9, alpha: alpha))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let image = try XCTUnwrap(context.makeImage())
        let output = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(output, type.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(destination, image, nil)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return output as Data
    }
}

@MainActor final class AlbumUploadQueueTests: XCTestCase {
    private func waitFor(_ condition: @escaping () -> Bool) async throws {
        for _ in 0..<400 where !condition() { try await Task.sleep(for: .milliseconds(5)) }
        XCTAssertTrue(condition())
    }

    func testDraftsUploadInOrderReportProgressAndClearOnceObserved() async throws {
        var sent: [String] = []
        var runs: [(Int, Int)] = []
        let queue = AlbumUploadQueue(send: { _, photo, progress in
            sent.append(photo.id); progress(0.5); progress(1); return "published-\(photo.id)"
        }, prepare: { ($0, $0) })
        queue.onRunFinished = { runs.append(($0, $1)) }
        queue.enqueue(eventID: "boat", loaders: [{ Data([1]) }, { Data([2]) }])
        try await waitFor { runs.count == 1 }
        XCTAssertEqual(runs.first?.0, 2); XCTAssertEqual(runs.first?.1, 0)
        XCTAssertEqual(sent, queue.items.map(\.id))
        XCTAssertEqual(queue.pendingCount(for: "boat"), 0)
        XCTAssertEqual(queue.reservedCount(for: "boat"), 0, "published drafts no longer hold a slot")
        queue.reconcile(eventID: "boat", publishedPhotoIDs: Set(sent.map { "published-\($0)" }))
        XCTAssertTrue(queue.items.isEmpty)
    }

    func testFailedDraftKeepsItsIdentityForRetryAndUnreadablePicksFail() async throws {
        var attempts: [String] = []
        var fail = true
        var runs: [(Int, Int)] = []
        let queue = AlbumUploadQueue(send: { _, photo, _ in
            attempts.append(photo.id)
            if fail { throw DIPRepositoryError.invalidInput("You’re offline.") }
            return photo.id
        }, prepare: { data in
            guard data != Data([0]) else { throw AlbumImageProcessing.Failure.unreadable }
            return (data, nil)
        })
        queue.onRunFinished = { runs.append(($0, $1)) }
        queue.enqueue(eventID: "boat", loaders: [{ Data([1]) }, { Data([0]) }])
        try await waitFor { runs.count == 1 }
        XCTAssertEqual(runs.first?.0, 0); XCTAssertEqual(runs.first?.1, 2)
        XCTAssertEqual(queue.failedCount(for: "boat"), 2)
        XCTAssertEqual(queue.items.first?.state, .failed("You’re offline."))
        XCTAssertEqual(queue.items.last?.state, .failed(AlbumUploadQueue.unreadableMessage))
        XCTAssertEqual(queue.reservedCount(for: "boat"), 2)
        fail = false
        queue.retry(queue.items[0].id)
        queue.retry(queue.items[1].id) // unreadable: nothing to resend
        try await waitFor { runs.count == 2 }
        XCTAssertEqual(attempts, [queue.items[0].id, queue.items[0].id], "a retry resends the same upload identity")
        queue.remove(queue.items[1].id)
        XCTAssertEqual(queue.items.count, 1)
        queue.cancelAll()
        XCTAssertTrue(queue.items.isEmpty)
    }
}

final class AlbumBarActionTests: XCTestCase {
    private func snapshot(_ album: DIPAlbum) -> DIPAppSnapshot {
        var snapshot = DIPMockFixtures.reference
        snapshot.albums = [album.eventID: album]
        return snapshot
    }

    func testAddPhotosIsOfferedOnlyToMembersWhoMayUpload() {
        let base = DIPAlbum(id: "boat", eventID: "boat", title: "Boat Ride", photos: [])
        XCTAssertEqual(EventBarAction.resolve(route: .album("boat"), snapshot: snapshot(base), isLoading: false)?.title, "Add Photos")
        var denied = base; denied.canAddPhotos = false
        XCTAssertNil(EventBarAction.resolve(route: .album("boat"), snapshot: snapshot(denied), isLoading: false))
        var loading = base; loading.isLoaded = false
        XCTAssertNil(EventBarAction.resolve(route: .album("boat"), snapshot: snapshot(loading), isLoading: false))
        var full = base; full.remainingUploads = 0
        let action = EventBarAction.resolve(route: .album("boat"), snapshot: snapshot(full), isLoading: false)
        XCTAssertEqual(action?.title, "Photo limit reached")
        XCTAssertEqual(action?.style, .complete)
    }
}

// MARK: Stubs

@MainActor private final class AlbumReadsStub: EventReadSource {
    var page: [DIPContracts.Event] = []
    var extra: [DIPContracts.Event] = []
    func feed(scope: EventReadScope, query: EventFeedQuery, after: EventFeedCursor?) async throws -> [DIPContracts.Event] {
        page.filter { $0.startTime >= query.startsAtOrAfter }
    }
    func detail(scope: EventReadScope, eventID: String) async throws -> DIPContracts.Event? { (page + extra).first { $0.id == eventID } }
    func observeDetail(scope: EventReadScope, eventID: String) -> AsyncThrowingStream<DIPContracts.Event?, Error> { AsyncThrowingStream { _ in } }
    func stop() {}
}

@MainActor private final class AlbumParticipationStub: ParticipationSource {
    var joined: AsyncThrowingStream<Set<String>, Error>.Continuation?
    func setRsvp(scope: EventReadScope, eventID: String, going: Bool) async throws -> Int { 0 }
    func observeMyGoingEventIDs(scope: EventReadScope) -> AsyncThrowingStream<Set<String>, Error> { AsyncThrowingStream { joined = $0 } }
    func attendees(scope: EventReadScope, eventID: String) async throws -> [RsvpAttendee] { [] }
    func stop() { joined?.finish() }
}

@MainActor private final class AlbumSourceStub: PhotoAlbumSource {
    var photos: AsyncThrowingStream<[AlbumPhotoRecord], Error>.Continuation?
    var photosTerminated = false
    var comments: AsyncThrowingStream<[PhotoCommentRecord], Error>.Continuation?
    var commentsTerminated = false
    var own: Set<String> = []
    /// Slots holding someone's abandoned object (create denied, checksum differs).
    var occupied: Set<Int> = []
    /// Slots whose bytes already landed (a retry is recognized by checksum).
    var stored: Set<Int> = []
    var uploads: [(slot: Int, size: Int)] = []
    var finalized: [Int] = []
    var finalizeFailure: AlbumFailure?
    var sentComments: [(id: String, author: ChatAuthor)] = []
    var stopped = false

    func observePhotos(scope: EventReadScope, eventID: String) -> AsyncThrowingStream<[AlbumPhotoRecord], Error> {
        AsyncThrowingStream { continuation in
            photos = continuation
            continuation.onTermination = { _ in Task { @MainActor in self.photosTerminated = true } }
        }
    }
    func ownPhotoIDs(scope: EventReadScope, eventID: String) async throws -> Set<String> { own }
    func imageData(path: String) async throws -> Data { Data() }
    func upload(scope: EventReadScope, eventID: String, slot: Int, jpeg: Data,
                progress: @escaping @Sendable (Double) -> Void) async throws -> AlbumUploadOutcome {
        uploads.append((slot, jpeg.count))
        if occupied.contains(slot) { return .slotOccupied }
        stored.insert(slot); progress(1)
        return .stored
    }
    func finalize(scope: EventReadScope, eventID: String, slot: Int) async throws -> String {
        if let finalizeFailure { throw finalizeFailure }
        finalized.append(slot)
        return AlbumPolicy.photoID(uid: scope.uid, slot: slot)
    }
    func observeComments(scope: EventReadScope, eventID: String, photoID: String) -> AsyncThrowingStream<[PhotoCommentRecord], Error> {
        AsyncThrowingStream { continuation in
            comments = continuation
            continuation.onTermination = { _ in Task { @MainActor in self.commentsTerminated = true } }
        }
    }
    func addComment(scope: EventReadScope, eventID: String, photoID: String, commentID: String, text: String, author: ChatAuthor) async throws {
        sentComments.append((commentID, author))
    }
    func stop() { stopped = true; photos?.finish(); comments?.finish() }
}
