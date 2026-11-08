import XCTest
import DIPContracts
import DIPCore
@testable import DIP

@MainActor final class MemberEventAppRepositoryTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 2_000_000_000)
    func event(_ number: Int = 0) -> DIPContracts.Event {
        DIPContracts.Event(id: String(format: "event-%02d", number), companyId: "alpha", title: "Company event \(number)", description: "A real projection", tagIds: [], coverImageURL: "", startTime: now.addingTimeInterval(100), endTime: now.addingTimeInterval(3700), venue: Venue(name: "Cafe", address: "1 Main", locality: "Pittsburgh", latitude: 40, longitude: -79), costCents: 0, costNote: "", capacity: 20, pointsValue: 0, isOutdoor: false, status: "scheduled", attendeeCount: 3, createdBy: "host", createdAt: now, revision: 1)
    }
    private func bridge(_ source: AppBridgeSource) -> MemberEventAppRepository {
        let reads = MemberEventsRepository(scope: EventReadScope(uid: "member", companyID: "alpha"), source: source, currentUID: { "member" })
        let profile = DIPProfile(id: "member", displayName: "Member", department: "", city: "", interestTagIDs: [], interestCatalog: [], photo: .data(Data()), avatar: .data(Data()), favoriteMemories: [])
        return MemberEventAppRepository(reads: reads, profile: profile, clock: { self.now })
    }
    func testCompanyEventsReplaceFixturesWithoutInventingMembershipOrSocialData() async throws {
        let source = AppBridgeSource(); source.page = [event()]; let repository = bridge(source)
        let stream = await repository.observe(); var iterator = stream.makeAsyncIterator()
        let received = try await iterator.next()
        let snapshot = try XCTUnwrap(received)
        XCTAssertEqual(snapshot.home.events.map(\.id), ["event-00"])
        XCTAssertNil(snapshot.eventDetails["puppy-yoga"])
        XCTAssertEqual(snapshot.eventDetails["event-00"]?.metadata?.address, "1 Main")
        XCTAssertEqual(snapshot.eventDetails["event-00"]?.isJoined, false)
        XCTAssertTrue(snapshot.participants.isEmpty); XCTAssertTrue(snapshot.activeEvents.isEmpty)
        XCTAssertTrue(snapshot.messages.isEmpty); XCTAssertNil(snapshot.home.challenge)
        repository.stop()
    }
    func testFailedNextPageRetainsCursorAndPreviouslyLoadedDataForRetry() async throws {
        let source = AppBridgeSource(); source.page = (0..<20).map(event); let repository = bridge(source)
        let stream = await repository.observe(); var iterator = stream.makeAsyncIterator()
        let initial = try await iterator.next(); XCTAssertEqual(initial?.home.events.count, 20)
        source.error = .unavailable; await repository.loadMore()
        XCTAssertNotNil(repository.paginationError); XCTAssertTrue(repository.hasMore)
        source.error = nil; source.page = [event(20)]; await repository.loadMore()
        let updated = try await iterator.next()
        XCTAssertEqual(updated?.home.events.count, 21); XCTAssertFalse(repository.hasMore)
        XCTAssertEqual(source.cursors.compactMap { $0 }.map(\.eventID), ["event-19", "event-19"])
        repository.stop()
    }
    func testObservedCancellationUpdatesExistingDetailAndRemovesItFromDiscovery() async throws {
        let source = AppBridgeSource(); source.page = [event()]; let repository = bridge(source)
        let stream = await repository.observe(); var iterator = stream.makeAsyncIterator(); _ = try await iterator.next()
        repository.selectDetail("event-00")
        while source.detailContinuation == nil { await Task.yield() }
        var cancelled = event(); cancelled.status = "cancelled"; cancelled.revision = 2
        source.detailContinuation?.yield(cancelled)
        let snapshot = try await iterator.next()
        XCTAssertTrue(snapshot?.home.events.isEmpty == true)
        XCTAssertEqual(snapshot?.eventDetails["event-00"]?.metadata?.status, .cancelled)
        repository.stop()
    }
    func testStopRejectsLateInitialDataAndDoesNotYieldAnotherTenantSnapshot() async throws {
        let source = AppBridgeSource(); source.suspend = true; let repository = bridge(source)
        let stream = await repository.observe()
        let consumer = Task { var iterator = stream.makeAsyncIterator(); return try await iterator.next() }
        while source.pending == nil { await Task.yield() }
        repository.stop(); source.pending?.resume(returning: [event()]); source.pending = nil
        do { _ = try await consumer.value; XCTFail() } catch { XCTAssertEqual(error as? EventReadFailure, .unauthenticated) }
        XCTAssertTrue(source.stopped)
    }
    func testLiveReadBridgeNeverPretendsToPerformAnRSVP() async throws {
        let repository = bridge(AppBridgeSource())
        do { try await repository.setRSVP(eventID: "event-00", going: true); XCTFail() }
        catch { guard case DIPRepositoryError.invalidInput = error else { return XCTFail("Expected explicit unavailable action") } }
        repository.stop()
    }
}
@MainActor private final class AppBridgeSource: EventReadSource {
    var page: [DIPContracts.Event] = []
    var error: EventReadFailure?
    var cursors: [EventFeedCursor?] = []
    var suspend = false
    var stopped = false
    var pending: CheckedContinuation<[DIPContracts.Event], Error>?
    var detailContinuation: AsyncThrowingStream<DIPContracts.Event?, Error>.Continuation?
    func feed(scope: EventReadScope, query: EventFeedQuery, after: EventFeedCursor?) async throws -> [DIPContracts.Event] {
        cursors.append(after)
        if let error { throw error }
        if suspend { return try await withCheckedThrowingContinuation { pending = $0 } }
        return page
    }
    func detail(scope: EventReadScope, eventID: String) async throws -> DIPContracts.Event? { page.first { $0.id == eventID } }
    func observeDetail(scope: EventReadScope, eventID: String) -> AsyncThrowingStream<DIPContracts.Event?, Error> { AsyncThrowingStream { detailContinuation = $0 } }
    func stop() { stopped = true; detailContinuation?.finish() }
}
