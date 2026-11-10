import XCTest
import DIPContracts
import DIPCore
@testable import DIP

@MainActor final class StubChallengeSource: ChallengeReadSource {
    var server: Result<[DIPContracts.Challenge], ChallengeReadFailure> = .success([])
    var cache: Result<[DIPContracts.Challenge], ChallengeReadFailure> = .success([])
    var suspend = false
    var pending: CheckedContinuation<[DIPContracts.Challenge], Error>?
    private(set) var reads: [(ChallengeReadScope, ChallengeWindowQuery, ChallengeReadOrigin)] = []
    private(set) var stopped = false
    func challenges(scope: ChallengeReadScope, query: ChallengeWindowQuery, origin: ChallengeReadOrigin) async throws -> [DIPContracts.Challenge] {
        reads.append((scope, query, origin))
        if suspend && origin == .server { return try await withCheckedThrowingContinuation { pending = $0 } }
        return try (origin == .server ? server : cache).get()
    }
    func stop() { stopped = true }
}

enum ChallengeFixture {
    static let start = Date(timeIntervalSince1970: 1_794_200_400)
    static let week: TimeInterval = 7 * 86_400
    static func record(_ id: String = "weekly-fitness-20261109", company: String = "alpha", start: Date = start,
                       end: Date? = nil, count: Int = 128, type: String = "weekly") -> DIPContracts.Challenge {
        DIPContracts.Challenge(id: id, companyId: company, title: "Fitness", description: "Get moving.", tagIds: ["tag-fitness"],
            type: type, goal: 3, goalUnit: "workouts", coverImageURL: "catalog://theme/fitness",
            startDate: start, endDate: end ?? start.addingTimeInterval(week - 1), pointsReward: 50,
            participantCount: count, completedCount: 0)
    }
}

@MainActor final class MemberChallengeReadTests: XCTestCase {
    let scope = ChallengeReadScope(uid: "member", companyID: "alpha")
    let now = ChallengeFixture.start.addingTimeInterval(2 * 86_400)
    func repository(_ source: StubChallengeSource, uid: @escaping () -> String? = { "member" }) -> MemberChallengesRepository {
        MemberChallengesRepository(scope: scope, source: source, currentUID: uid)
    }

    func testQueryIsTheSpecHomeQueryAndPicksTheCurrentWindow() async throws {
        let source = StubChallengeSource()
        let next = ChallengeFixture.record("next", start: ChallengeFixture.start.addingTimeInterval(ChallengeFixture.week))
        source.server = .success([ChallengeFixture.record(), next])
        let result = try await repository(source).current(now: now)
        XCTAssertEqual(result.challenge?.id, "weekly-fitness-20261109"); XCTAssertFalse(result.stale)
        XCTAssertEqual(source.reads.count, 1)
        XCTAssertEqual(source.reads[0].0, scope)
        XCTAssertEqual(source.reads[0].1, ChallengeWindowQuery(endsAtOrAfter: now, limit: 5))
        XCTAssertEqual(source.reads[0].2, .server)
    }

    func testFutureOnlyAndEmptyResultsMeanNoThemeThisWeek() async throws {
        let source = StubChallengeSource()
        source.server = .success([ChallengeFixture.record("next", start: ChallengeFixture.start.addingTimeInterval(ChallengeFixture.week))])
        let future = try await repository(source).current(now: now)
        XCTAssertNil(future.challenge)
        source.server = .success([])
        let empty = try await repository(source).current(now: now)
        XCTAssertNil(empty.challenge)
    }

    func testRecordsViolatingTenantBoundOrderOrLimitFailClosed() async {
        let cases: [[DIPContracts.Challenge]] = [
            [ChallengeFixture.record(company: "beta")],
            [ChallengeFixture.record(end: now.addingTimeInterval(-1), count: 1)].map { var r = $0; r.startDate = now.addingTimeInterval(-3600); return r },
            [ChallengeFixture.record("b", start: ChallengeFixture.start.addingTimeInterval(ChallengeFixture.week)), ChallengeFixture.record("a")],
            Array(repeating: ChallengeFixture.record(), count: 6),
            [ChallengeFixture.record(count: -1)],
            [ChallengeFixture.record(end: ChallengeFixture.start.addingTimeInterval(15 * 86_400))],
        ]
        for records in cases {
            let source = StubChallengeSource(); source.server = .success(records)
            do { _ = try await repository(source).current(now: now); XCTFail("accepted \(records.map(\.id))") }
            catch { XCTAssertEqual(error as? ChallengeReadFailure, .invalidDocument) }
        }
    }

    func testOfflineFallsBackToCacheAsStaleAndEmptyCacheIsAnError() async throws {
        let source = StubChallengeSource()
        source.server = .failure(.unavailable); source.cache = .success([ChallengeFixture.record()])
        let stale = try await repository(source).current(now: now)
        XCTAssertEqual(stale.challenge?.id, "weekly-fitness-20261109"); XCTAssertTrue(stale.stale)
        XCTAssertEqual(source.reads.map(\.2), [.server, .cache])
        source.cache = .success([])
        do { _ = try await repository(source).current(now: now); XCTFail() }
        catch { XCTAssertEqual(error as? ChallengeReadFailure, .unavailable) }
    }

    func testPermissionDeniedDoesNotConsultTheCache() async {
        let source = StubChallengeSource(); source.server = .failure(.permissionDenied); source.cache = .success([ChallengeFixture.record()])
        do { _ = try await repository(source).current(now: now); XCTFail() }
        catch { XCTAssertEqual(error as? ChallengeReadFailure, .permissionDenied) }
        XCTAssertEqual(source.reads.map(\.2), [.server])
    }

    func testSignedOutOrOtherAccountFailsBeforeAnyRead() async {
        for uid in [nil, "someone-else"] as [String?] {
            let source = StubChallengeSource()
            do { _ = try await repository(source, uid: { uid }).current(now: now); XCTFail() }
            catch { XCTAssertEqual(error as? ChallengeReadFailure, .unauthenticated) }
            XCTAssertTrue(source.reads.isEmpty); XCTAssertTrue(source.stopped)
        }
    }

    func testAccountChangeWhileReadIsPendingCannotReturnOldTenantData() async {
        let source = StubChallengeSource(); source.suspend = true
        var uid: String? = "member"
        let repository = repository(source, uid: { uid })
        let task = Task { try await repository.current(now: now) }
        while source.pending == nil { await Task.yield() }
        uid = "another-account"
        source.pending?.resume(returning: [ChallengeFixture.record()]); source.pending = nil
        do { _ = try await task.value; XCTFail() }
        catch { XCTAssertEqual(error as? ChallengeReadFailure, .unauthenticated) }
        XCTAssertTrue(source.stopped); XCTAssertFalse(repository.isActive)
    }

    func testMembershipInvalidationEndsTheLeasePermanently() async {
        let source = StubChallengeSource(); source.suspend = true
        let repository = repository(source)
        let task = Task { try await repository.current(now: now) }
        while source.pending == nil { await Task.yield() }
        repository.invalidate()
        source.pending?.resume(returning: [ChallengeFixture.record()]); source.pending = nil
        do { _ = try await task.value; XCTFail() } catch { XCTAssertEqual(error as? ChallengeReadFailure, .unauthenticated) }
        source.suspend = false
        do { _ = try await repository.current(now: now); XCTFail() } catch { XCTAssertEqual(error as? ChallengeReadFailure, .unauthenticated) }
    }

    func testInvalidScopeIsRejected() async {
        let source = StubChallengeSource()
        let bad = MemberChallengesRepository(scope: ChallengeReadScope(uid: "member", companyID: "a/b"), source: source, currentUID: { "member" })
        do { _ = try await bad.current(now: now); XCTFail() } catch { XCTAssertEqual(error as? ChallengeReadFailure, .invalidQuery) }
        XCTAssertTrue(source.reads.isEmpty)
    }
}

/// Card state machine: what Home shows for each repository outcome.
@MainActor final class WeeklyChallengeFeedTests: XCTestCase {
    let scope = ChallengeReadScope(uid: "member", companyID: "alpha")
    var now = ChallengeFixture.start.addingTimeInterval(2 * 86_400)
    func feed(_ source: StubChallengeSource, uid: @escaping () -> String? = { "member" }) -> WeeklyChallengeFeed {
        WeeklyChallengeFeed(repository: MemberChallengesRepository(scope: scope, source: source, currentUID: uid), clock: { [unowned self] in now })
    }

    func testStartsLoadingThenShowsCurrentCardWithCatalogArtwork() async {
        let source = StubChallengeSource(); source.server = .success([ChallengeFixture.record(count: 0)])
        let feed = feed(source)
        XCTAssertEqual(feed.state, .loading)
        await feed.load()
        let summary = feed.state.summary
        XCTAssertEqual(summary?.category, "Fitness"); XCTAssertEqual(summary?.artwork, .asset("Mascot"))
        XCTAssertEqual(summary?.accent, .challenge); XCTAssertEqual(summary?.avatars, [])
        XCTAssertEqual(summary?.participationText, "Be the first this week")
        XCTAssertFalse(feed.state.isStale)
        let detail = feed.detail("weekly-fitness-20261109")
        XCTAssertEqual(detail?.goalText, "3 workouts"); XCTAssertEqual(detail?.rewardText, "+50 points")
        XCTAssertNil(feed.detail("other-id"))
    }

    func testNoThemeThisWeekIsTheEmptyState() async {
        let source = StubChallengeSource()
        let feed = feed(source); await feed.load()
        XCTAssertEqual(feed.state, .none); XCTAssertNil(feed.current)
    }

    func testFailureWithNothingShownRetriesInPlace() async {
        let source = StubChallengeSource(); source.server = .failure(.unavailable)
        let feed = feed(source); await feed.load()
        XCTAssertEqual(feed.state, .failed(DIPChallengeText.failure))
        source.server = .success([ChallengeFixture.record()])
        await feed.load()
        XCTAssertEqual(feed.state.summary?.participantCount, 128)
    }

    func testFailedRefreshKeepsTheCardAsStaleUntilItsWeekEnds() async {
        let source = StubChallengeSource(); source.server = .success([ChallengeFixture.record()])
        let feed = feed(source); await feed.load()
        source.server = .failure(.unavailable)
        await feed.load()
        XCTAssertTrue(feed.state.isStale); XCTAssertEqual(feed.state.summary?.participantCount, 128)
        now = ChallengeFixture.start.addingTimeInterval(ChallengeFixture.week + 60)
        await feed.load()
        XCTAssertEqual(feed.state, .failed(DIPChallengeText.failure), "an expired week is not shown as current")
        XCTAssertNil(feed.current)
    }

    func testOfflineColdStartShowsCachedCardAsStale() async {
        let source = StubChallengeSource(); source.server = .failure(.unavailable); source.cache = .success([ChallengeFixture.record()])
        let feed = feed(source); await feed.load()
        XCTAssertTrue(feed.state.isStale); XCTAssertNotNil(feed.state.summary)
    }

    func testRefreshDropsAThemeWhoseWindowEnded() async {
        let source = StubChallengeSource(); source.server = .success([ChallengeFixture.record()])
        let feed = feed(source); await feed.load()
        now = ChallengeFixture.start.addingTimeInterval(ChallengeFixture.week + 60)
        source.server = .success([])
        await feed.load()
        XCTAssertEqual(feed.state, .none)
    }

    func testSignOutClearsTheCardAndIgnoresLaterLoads() async {
        let source = StubChallengeSource(); source.server = .success([ChallengeFixture.record()])
        var uid: String? = "member"
        let feed = feed(source, uid: { uid }); await feed.load()
        XCTAssertNotNil(feed.state.summary)
        uid = nil
        await feed.load()
        XCTAssertEqual(feed.state, .none); XCTAssertNil(feed.current); XCTAssertTrue(feed.stopped)
        XCTAssertNil(feed.detail("weekly-fitness-20261109"))
        uid = "member"; await feed.load()
        XCTAssertEqual(feed.state, .none, "a stopped feed never reloads; the host makes a new one per membership")
    }

    func testStopDuringPendingLoadDiscardsTheResult() async {
        let source = StubChallengeSource(); source.suspend = true
        let feed = feed(source)
        let task = Task { await feed.load() }
        while source.pending == nil { await Task.yield() }
        feed.stop()
        source.pending?.resume(returning: [ChallengeFixture.record()]); source.pending = nil
        await task.value
        XCTAssertEqual(feed.state, .none); XCTAssertNil(feed.current); XCTAssertTrue(source.stopped)
    }

    func testMissingRepositoryShowsFailureNotFixtureData() {
        let feed = WeeklyChallengeFeed()
        feed.attach(nil)
        XCTAssertEqual(feed.state, .failed(DIPChallengeText.failure))
    }
}
