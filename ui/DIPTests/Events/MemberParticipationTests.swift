import XCTest
import DIPContracts
import DIPCore
@preconcurrency import FirebaseFunctions
@testable import DIP

@MainActor final class MemberParticipationTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 2_000_000_000)

    func event(_ id: String, startsIn offset: TimeInterval = 100, attendees: Int = 3) -> DIPContracts.Event {
        DIPContracts.Event(id: id, companyId: "alpha", title: "Event \(id)", description: "Live", tagIds: [], coverImageURL: "",
            startTime: now.addingTimeInterval(offset), endTime: now.addingTimeInterval(offset + 3600),
            venue: Venue(name: "Cafe", address: "1 Main", locality: "Pittsburgh", latitude: 40, longitude: -79),
            costCents: 0, costNote: "", capacity: 20, pointsValue: 0, isOutdoor: false, status: "scheduled",
            attendeeCount: attendees, createdBy: "host", createdAt: now, revision: 1)
    }

    private func make(_ reads: ReadsStub, _ participation: ParticipationStub) -> MemberEventAppRepository {
        let repository = MemberEventsRepository(scope: EventReadScope(uid: "member", companyID: "alpha"), source: reads, currentUID: { "member" })
        let profile = DIPProfile(id: "member", displayName: "Member", department: "", city: "", interestTagIDs: [], interestCatalog: [],
                                 photo: .data(Data()), avatar: .data(Data()), favoriteMemories: [])
        return MemberEventAppRepository(reads: repository, profile: profile, participation: participation, clock: { self.now })
    }

    func testLiveRsvpListenerMarksJoinedEventsAndFillsMyEvents() async throws {
        let reads = ReadsStub(); reads.page = [event("yoga"), event("hike", startsIn: 7200)]
        let participation = ParticipationStub()
        let repository = make(reads, participation)
        let stream = await repository.observe(); var iterator = stream.makeAsyncIterator()
        _ = try await iterator.next()
        participation.joined?.yield(["yoga"])
        var found: DIPAppSnapshot?
        repeat { found = try await iterator.next() } while found.map { !($0.eventDetails["yoga"]?.isJoined == true) } ?? false
        let snapshot = try XCTUnwrap(found, "expected snapshot never arrived")
        XCTAssertEqual(snapshot.eventDetails["hike"]?.isJoined, false)
        XCTAssertEqual(DIPEventLists(snapshot: snapshot, now: now).upcoming.map(\.id), ["yoga"])
        repository.stop()
        XCTAssertTrue(participation.stopped)
    }

    func testJoinedPastEventOutsideTheFeedIsFetchedForMemories() async throws {
        let reads = ReadsStub(); reads.page = [event("yoga")]
        reads.extra = [event("kayak", startsIn: -10_000)]
        let participation = ParticipationStub()
        let repository = make(reads, participation)
        let stream = await repository.observe(); var iterator = stream.makeAsyncIterator()
        _ = try await iterator.next()
        participation.joined?.yield(["kayak"])
        var found: DIPAppSnapshot?
        repeat { found = try await iterator.next() } while found.map { !($0.eventDetails["kayak"] != nil) } ?? false
        let snapshot = try XCTUnwrap(found, "expected snapshot never arrived")
        let lists = DIPEventLists(snapshot: snapshot, now: now)
        XCTAssertEqual(lists.past.map(\.eventID), ["kayak"])
        XCTAssertFalse(lists.discovery.map(\.id).contains("kayak"))
        repository.stop()
    }

    func testJoinAndLeaveCallTheServerAndShowTheAcknowledgement() async throws {
        let reads = ReadsStub(); reads.page = [event("yoga", attendees: 3)]
        let participation = ParticipationStub(); participation.count = 4
        let repository = make(reads, participation)
        let stream = await repository.observe(); var iterator = stream.makeAsyncIterator()
        _ = try await iterator.next()
        try await repository.setRSVP(eventID: "yoga", going: true)
        var found: DIPAppSnapshot?
        repeat { found = try await iterator.next() } while found.map { !($0.eventDetails["yoga"]?.isJoined == true) } ?? false
        let snapshot = try XCTUnwrap(found, "expected snapshot never arrived")
        XCTAssertEqual(snapshot.eventDetails["yoga"]?.attendeeCount, 4)
        participation.count = 3
        try await repository.setRSVP(eventID: "yoga", going: false)
        repeat { found = try await iterator.next() } while found.map { !($0.eventDetails["yoga"]?.isJoined == false) } ?? false
        let left = try XCTUnwrap(found, "expected snapshot never arrived")
        XCTAssertEqual(left.eventDetails["yoga"]?.attendeeCount, 3)
        XCTAssertEqual(participation.calls.map(\.going), [true, false])
        XCTAssertEqual(participation.calls.map(\.eventID), ["yoga", "yoga"])
        repository.stop()
    }

    func testServerRefusalBecomesAReadableMessageAndChangesNothing() async throws {
        let reads = ReadsStub(); reads.page = [event("yoga")]
        let participation = ParticipationStub(); participation.failure = .full
        let repository = make(reads, participation)
        let stream = await repository.observe(); var iterator = stream.makeAsyncIterator()
        let initial = try await iterator.next()
        do { try await repository.setRSVP(eventID: "yoga", going: true); XCTFail("expected refusal") }
        catch { XCTAssertEqual(DIPPrototypeApp.rsvpMessage(error), "This event is full.") }
        XCTAssertEqual(initial?.eventDetails["yoga"]?.isJoined, false)
        repository.stop()
    }

    func testOpeningAnEventLoadsAttendeeSnapshots() async throws {
        let reads = ReadsStub(); reads.page = [event("yoga")]
        let participation = ParticipationStub()
        participation.people = [RsvpAttendee(userID: "u2", name: "Sam", department: "Design", avatarID: "avatar-02")]
        let repository = make(reads, participation)
        let stream = await repository.observe(); var iterator = stream.makeAsyncIterator()
        _ = try await iterator.next()
        repository.selectDetail("yoga")
        var found: DIPAppSnapshot?
        repeat { found = try await iterator.next() } while found.map { !($0.participants["yoga"] != nil) } ?? false
        let snapshot = try XCTUnwrap(found, "expected snapshot never arrived")
        XCTAssertEqual(snapshot.participants["yoga"]?.map(\.name), ["Sam"])
        XCTAssertEqual(snapshot.participants["yoga"]?.first?.department, "Design")
        repository.stop()
    }

    func testReadOnlyBridgeStillRefusesRsvpWithoutParticipation() async throws {
        let repository = MemberEventAppRepository(
            reads: MemberEventsRepository(scope: EventReadScope(uid: "member", companyID: "alpha"), source: ReadsStub(), currentUID: { "member" }),
            profile: DIPProfile(id: "member", displayName: "", department: "", city: "", interestTagIDs: [], interestCatalog: [],
                                photo: .data(Data()), avatar: .data(Data()), favoriteMemories: []))
        XCTAssertFalse(repository.supportsParticipation)
        do { try await repository.setRSVP(eventID: "yoga", going: true); XCTFail() }
        catch { XCTAssertEqual(DIPPrototypeApp.rsvpMessage(error), "RSVP isn’t available yet") }
        repository.stop()
    }

    // MARK: Firebase adapter mapping

    func testAttendeeRowsAreFilteredToWellFormedGoingRowsAndSorted() {
        let rows: [(id: String, fields: [String: Any])] = [
            (id: "u2", fields: ["companyId": "alpha", "eventId": "yoga", "userId": "u2", "status": "going", "userName": "sam"]),
            (id: "u1", fields: ["companyId": "alpha", "eventId": "yoga", "userId": "u1", "status": "going", "userName": "Alex", "userDepartment": "HR"]),
            (id: "u3", fields: ["companyId": "alpha", "eventId": "yoga", "userId": "u3", "status": "cancelled", "userName": "Gone"]),
            (id: "u4", fields: ["companyId": "beta", "eventId": "yoga", "userId": "u4", "status": "going", "userName": "Other"]),
            (id: "u5", fields: ["companyId": "alpha", "eventId": "yoga", "userId": "someone-else", "status": "going", "userName": "Forged"]),
        ]
        let people = FirebaseParticipationSource.attendees(rows, companyID: "alpha", eventID: "yoga")
        XCTAssertEqual(people.map(\.name), ["Alex", "sam"])
        XCTAssertEqual(people.first?.department, "HR")
    }

    func testCallableReasonsMapToUserFacingFailures() {
        func error(_ code: FunctionsErrorCode, _ reason: String?) -> NSError {
            NSError(domain: FunctionsErrorDomain, code: code.rawValue,
                    userInfo: reason.map { [FunctionsErrorDetailsKey: ["reason": $0]] } ?? [:])
        }
        XCTAssertEqual(FirebaseParticipationSource.failure(error(.resourceExhausted, "EVENT_FULL")), .full)
        XCTAssertEqual(FirebaseParticipationSource.failure(error(.failedPrecondition, "EVENT_CLOSED")), .closed)
        XCTAssertEqual(FirebaseParticipationSource.failure(error(.notFound, "EVENT_NOT_FOUND")), .notFound)
        XCTAssertEqual(FirebaseParticipationSource.failure(error(.permissionDenied, "MEMBERSHIP_CONFLICT")), .notMember)
        XCTAssertEqual(FirebaseParticipationSource.failure(error(.unavailable, nil)), .unavailable)
        XCTAssertEqual(FirebaseParticipationSource.failure(error(.internal, nil)), .unknown)
        XCTAssertEqual(RsvpFailure.full.message, "This event is full.")
    }
}

@MainActor private final class ReadsStub: EventReadSource {
    var page: [DIPContracts.Event] = []
    var extra: [DIPContracts.Event] = []
    func feed(scope: EventReadScope, query: EventFeedQuery, after: EventFeedCursor?) async throws -> [DIPContracts.Event] {
        page.filter { $0.startTime >= query.startsAtOrAfter }
    }
    func detail(scope: EventReadScope, eventID: String) async throws -> DIPContracts.Event? {
        (page + extra).first { $0.id == eventID }
    }
    func observeDetail(scope: EventReadScope, eventID: String) -> AsyncThrowingStream<DIPContracts.Event?, Error> { AsyncThrowingStream { _ in } }
    func stop() {}
}

@MainActor private final class ParticipationStub: ParticipationSource {
    var joined: AsyncThrowingStream<Set<String>, Error>.Continuation?
    var calls: [(eventID: String, going: Bool)] = []
    var count = 0
    var failure: RsvpFailure?
    var people: [RsvpAttendee] = []
    var stopped = false
    func setRsvp(scope: EventReadScope, eventID: String, going: Bool) async throws -> Int {
        if let failure { throw failure }
        calls.append((eventID, going)); return count
    }
    func observeMyGoingEventIDs(scope: EventReadScope) -> AsyncThrowingStream<Set<String>, Error> {
        AsyncThrowingStream { joined = $0 }
    }
    func attendees(scope: EventReadScope, eventID: String) async throws -> [RsvpAttendee] { people }
    func stop() { stopped = true; joined?.finish() }
}
