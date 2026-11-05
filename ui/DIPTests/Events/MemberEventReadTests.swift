import XCTest
import DIPContracts
import DIPCore
@testable import DIP

@MainActor final class MemberEventReadTests: XCTestCase {
    let scope = EventReadScope(uid: "member", companyID: "alpha")
    let instant = Date(timeIntervalSince1970: 2_000_000_000)
    func event(id: String = "event-a", company: String = "alpha") -> DIPContracts.Event {
        DIPContracts.Event(id: id, companyId: company, title: "Team lunch", description: "A team lunch", tagIds: [], coverImageURL: "fixture", startTime: instant, endTime: instant.addingTimeInterval(3600), venue: Venue(name: "Cafe", address: "1 Main", locality: "Pittsburgh", latitude: 40, longitude: -79), costCents: 1250, costNote: "Lunch included", capacity: 20, pointsValue: 0, isOutdoor: false, status: "scheduled", attendeeCount: 0, createdBy: "host", createdAt: instant.addingTimeInterval(-1000), revision: 1)
    }
    private func repository(_ source: StubEventSource) -> MemberEventsRepository { MemberEventsRepository(scope: scope, source: source, currentUID: { "member" }) }
    func testCursorPinsIdentityQueryAndTieBreakOrder() async throws {
        let source = StubEventSource(); source.page = [event()]
        let repository = repository(source); let query = EventFeedQuery(startsAtOrAfter: instant, pageSize: 1)
        let first = try await repository.feed(query)
        XCTAssertEqual(first.nextCursor?.eventID, "event-a")
        source.page = [event(id: "event-b")]
        let second = try await repository.feed(query, after: first.nextCursor)
        XCTAssertEqual(second.events.first?.id, "event-b")
        XCTAssertEqual(source.lastCursor, first.nextCursor)
        do { _ = try await repository.feed(EventFeedQuery(startsAtOrAfter: instant.addingTimeInterval(1), pageSize: 1), after: first.nextCursor); XCTFail() }
        catch { XCTAssertEqual(error as? EventReadFailure, .invalidCursor) }
    }
    func testOtherAccountCursorFailsBeforeAnySourceCall() async throws {
        let source = StubEventSource(); let query = EventFeedQuery(startsAtOrAfter: instant)
        let cursor = EventFeedCursor(scope: EventReadScope(uid: "other", companyID: "alpha"), query: query, startTime: instant, eventID: "event-a")
        do { _ = try await repository(source).feed(query, after: cursor); XCTFail() }
        catch { XCTAssertEqual(error as? EventReadFailure, .invalidCursor) }
        XCTAssertEqual(source.readCount, 0)
    }
    func testBoundsEmptyPageAndDuplicateOrdering() async throws {
        let source = StubEventSource(); let repository = repository(source)
        let empty = try await repository.feed(EventFeedQuery(startsAtOrAfter: instant))
        XCTAssertTrue(empty.events.isEmpty); XCTAssertNil(empty.nextCursor)
        for size in [0, 101] {
            do { _ = try await repository.feed(EventFeedQuery(startsAtOrAfter: instant, pageSize: size)); XCTFail() }
            catch { XCTAssertEqual(error as? EventReadFailure, .invalidQuery) }
        }
        source.page = [event(), event()]
        do { _ = try await repository.feed(EventFeedQuery(startsAtOrAfter: instant)); XCTFail() }
        catch { XCTAssertEqual(error as? EventReadFailure, .invalidDocument) }
    }
    func testCrossTenantRecordAndCancelledFeedAreRejected() async throws {
        let source = StubEventSource(); let repository = repository(source)
        source.page = [event(company: "beta")]
        do { _ = try await repository.feed(EventFeedQuery(startsAtOrAfter: instant)); XCTFail() }
        catch { XCTAssertEqual(error as? EventReadFailure, .invalidDocument) }
        var cancelled = event(); cancelled.status = "cancelled"; source.page = [cancelled]
        do { _ = try await repository.feed(EventFeedQuery(startsAtOrAfter: instant)); XCTFail() }
        catch { XCTAssertEqual(error as? EventReadFailure, .invalidDocument) }
    }
    func testSwitchingIdentityWhileReadIsPendingCannotReturnOldData() async throws {
        let source = StubEventSource(); source.suspendFeed = true
        var uid: String? = "member"
        let repository = MemberEventsRepository(scope: scope, source: source, currentUID: { uid })
        let task = Task { try await repository.feed(EventFeedQuery(startsAtOrAfter: instant)) }
        while source.pending == nil { await Task.yield() }
        uid = "another-account"
        source.pending?.resume(returning: [event()]); source.pending = nil
        do { _ = try await task.value; XCTFail() }
        catch { XCTAssertEqual(error as? EventReadFailure, .unauthenticated) }
        XCTAssertTrue(source.stopped)
    }
    func testMembershipInvalidationRejectsPendingResultEvenWhenUIDIsUnchanged() async throws {
        let source = StubEventSource(); source.suspendFeed = true
        let repository = repository(source)
        let task = Task { try await repository.feed(EventFeedQuery(startsAtOrAfter: instant)) }
        while source.pending == nil { await Task.yield() }
        repository.invalidate()
        source.pending?.resume(returning: [event()]); source.pending = nil
        do { _ = try await task.value; XCTFail() }
        catch { XCTAssertEqual(error as? EventReadFailure, .unauthenticated) }
    }
    func testDetailDoesNotSubstituteAnotherIDAndMissingIsExplicit() async throws {
        let source = StubEventSource(); let repository = repository(source)
        let missing = try await repository.detail("missing"); XCTAssertNil(missing)
        source.record = event(id: "different")
        do { _ = try await repository.detail("requested"); XCTFail() }
        catch { XCTAssertEqual(error as? EventReadFailure, .invalidDocument) }
        do { _ = try await repository.detail("../private"); XCTFail() }
        catch { XCTAssertEqual(error as? EventReadFailure, .invalidQuery) }
    }
    func testObservationRejectsCrossTenantChanges() async throws {
        let source = StubEventSource(); let repository = repository(source)
        let stream = repository.observeDetail("event-a")
        let task = Task { var iterator = stream.makeAsyncIterator(); return try await iterator.next() }
        source.observation?.yield(event(company: "beta"))
        do { _ = try await task.value; XCTFail() }
        catch { XCTAssertEqual(error as? EventReadFailure, .invalidDocument) }
    }
    func testInvalidationFinishesObservationAndStopsSource() async throws {
        let source = StubEventSource(); let repository = repository(source)
        let stream = repository.observeDetail("event-a")
        let task = Task { var iterator = stream.makeAsyncIterator(); return try await iterator.next() }
        repository.invalidate()
        do { _ = try await task.value; XCTFail() }
        catch { XCTAssertEqual(error as? EventReadFailure, .unauthenticated) }
        XCTAssertTrue(source.stopped)
    }
    func testInvalidScopeNeverConstructsASourceQuery() async throws {
        let source = StubEventSource()
        let repository = MemberEventsRepository(scope: EventReadScope(uid: "member", companyID: "../other"), source: source, currentUID: { "member" })
        do { _ = try await repository.feed(EventFeedQuery(startsAtOrAfter: instant)); XCTFail() }
        catch { XCTAssertEqual(error as? EventReadFailure, .invalidQuery) }
        XCTAssertEqual(source.readCount, 0)
    }
    func testObservedDeletionIsAnExplicitNilValueRatherThanEndOfStream() async throws {
        let source = StubEventSource(); let repository = repository(source)
        let stream = repository.observeDetail("event-a")
        let task = Task { var iterator = stream.makeAsyncIterator(); return try await iterator.next() }
        source.observation?.yield(nil)
        let value = try await task.value
        switch value { case .some(.none): break; default: XCTFail("Deletion must yield an explicit nil event") }
        repository.invalidate()
    }
    func testMetadataReusesStructuredDateLocationAndCostProjection() throws {
        let metadata = try MemberEventsRepository.metadata(event())
        XCTAssertEqual(metadata.durationMinutes, 60); XCTAssertEqual(metadata.costCents, 1250)
        XCTAssertEqual(metadata.address, "1 Main"); XCTAssertEqual(metadata.status, .scheduled)
        var bad = event(); bad.status = "unknown"
        XCTAssertThrowsError(try MemberEventsRepository.metadata(bad))
    }
}
@MainActor private final class StubEventSource: EventReadSource {
    var page: [DIPContracts.Event] = []
    var record: DIPContracts.Event?
    var lastCursor: EventFeedCursor?
    var readCount = 0
    var stopped = false
    var suspendFeed = false
    var pending: CheckedContinuation<[DIPContracts.Event], Error>?
    var observation: AsyncThrowingStream<DIPContracts.Event?, Error>.Continuation?
    func feed(scope: EventReadScope, query: EventFeedQuery, after: EventFeedCursor?) async throws -> [DIPContracts.Event] {
        readCount += 1; lastCursor = after
        if suspendFeed { return try await withCheckedThrowingContinuation { pending = $0 } }
        return page
    }
    func detail(scope: EventReadScope, eventID: String) async throws -> DIPContracts.Event? { record }
    func observeDetail(scope: EventReadScope, eventID: String) -> AsyncThrowingStream<DIPContracts.Event?, Error> { AsyncThrowingStream { observation = $0 } }
    func stop() { stopped = true; observation?.finish() }
}
