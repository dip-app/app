import Foundation
import DIPContracts
import DIPCore

/// Tenant lease for weekly-theme reads: one UID and its server-owned company.
struct ChallengeReadScope: Hashable, Sendable {
    let uid: String
    let companyID: String
}

enum ChallengeReadFailure: Error, Equatable {
    case unauthenticated, permissionDenied, invalidQuery, invalidDocument, unavailable
}

/// Where a read is answered from. `.cache` is only consulted after the server is unreachable.
enum ChallengeReadOrigin: Equatable, Sendable { case server, cache }

/// Home query (spec section 4): `endDate >= endsAtOrAfter`, ordered by `endDate`, bounded.
/// A single-field range, so no composite index is needed.
struct ChallengeWindowQuery: Equatable, Sendable {
    static let homeLimit = 5
    let endsAtOrAfter: Date
    let limit: Int
    init(endsAtOrAfter: Date, limit: Int = Self.homeLimit) { self.endsAtOrAfter = endsAtOrAfter; self.limit = limit }
}

@MainActor protocol ChallengeReadSource: AnyObject {
    func challenges(scope: ChallengeReadScope, query: ChallengeWindowQuery, origin: ChallengeReadOrigin) async throws -> [DIPContracts.Challenge]
    func stop()
}

/// The current weekly theme and whether it came from the offline cache.
struct CurrentChallenge: Equatable, Sendable {
    let challenge: DIPWeeklyChallenge?
    let stale: Bool
}

/// One repository per observed membership, like MemberEventsRepository. Invalidation (sign-out,
/// account or company change) permanently ends the lease; a pending read cannot return old data.
@MainActor final class MemberChallengesRepository {
    let scope: ChallengeReadScope
    private let source: any ChallengeReadSource
    private let currentUID: () -> String?
    private var active = true
    var isActive: Bool { active }

    init(scope: ChallengeReadScope, source: any ChallengeReadSource, currentUID: @escaping () -> String?) {
        self.scope = scope; self.source = source; self.currentUID = currentUID
    }

    func invalidate() {
        guard active else { return }; active = false
        source.stop()
    }

    private func requireActive() throws {
        guard MemberEventsRepository.validID(scope.companyID), !scope.uid.isEmpty, !scope.uid.contains("/") else { invalidate(); throw ChallengeReadFailure.invalidQuery }
        guard active, currentUID() == scope.uid else { invalidate(); throw ChallengeReadFailure.unauthenticated }
    }

    /// Reads the server first. Only when it is unreachable does the device cache answer, and that
    /// answer is marked stale. An empty cache is an error, never "no theme this week".
    func current(now: Date) async throws -> CurrentChallenge {
        try requireActive()
        guard now.timeIntervalSince1970.isFinite else { throw ChallengeReadFailure.invalidQuery }
        let query = ChallengeWindowQuery(endsAtOrAfter: now)
        do {
            let records = try await read(query, origin: .server)
            return CurrentChallenge(challenge: DIPWeeklyChallengeSelection.current(records, now: now), stale: false)
        } catch ChallengeReadFailure.unavailable {
            let cached = try await read(query, origin: .cache)
            guard !cached.isEmpty else { throw ChallengeReadFailure.unavailable }
            return CurrentChallenge(challenge: DIPWeeklyChallengeSelection.current(cached, now: now), stale: true)
        }
    }

    private func read(_ query: ChallengeWindowQuery, origin: ChallengeReadOrigin) async throws -> [DIPWeeklyChallenge] {
        let records = try await source.challenges(scope: scope, query: query, origin: origin)
        try requireActive(); try Task.checkCancellation()
        guard records.count <= query.limit else { throw ChallengeReadFailure.invalidDocument }
        var previous: Date?
        return try records.map { record in
            let value = try Self.validated(record, scope: scope)
            // The source must honour the bound and the endDate order it was asked for.
            guard value.endDate >= query.endsAtOrAfter, previous.map({ value.endDate >= $0 }) ?? true else { throw ChallengeReadFailure.invalidDocument }
            previous = value.endDate
            return value
        }
    }

    /// Same limits as the server's ChallengeDraft validation (spec section 3); counts are server-owned.
    nonisolated static let maximumSpan: TimeInterval = 14 * 86_400

    nonisolated static func validated(_ record: DIPContracts.Challenge, scope: ChallengeReadScope) throws -> DIPWeeklyChallenge {
        guard record.companyId == scope.companyID, let id = record.id, MemberEventsRepository.validID(id),
              !record.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, record.title.count <= 60,
              !record.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, record.description.count <= 1000,
              !record.type.isEmpty, record.goal.isFinite, record.goal > 0, record.goal <= 10_000,
              (1...24).contains(record.goalUnit.count),
              record.endDate > record.startDate, record.endDate.timeIntervalSince(record.startDate) <= maximumSpan,
              (0...1000).contains(record.pointsReward), record.participantCount >= 0, record.completedCount >= 0,
              record.tagIds.allSatisfy(MemberEventsRepository.validID) else { throw ChallengeReadFailure.invalidDocument }
        return DIPWeeklyChallenge(
            id: id, title: record.title, description: record.description, type: record.type, goal: record.goal,
            goalUnit: record.goalUnit, coverImageURL: record.coverImageURL, startDate: record.startDate, endDate: record.endDate,
            pointsReward: record.pointsReward, participantCount: record.participantCount, completedCount: record.completedCount)
    }
}
