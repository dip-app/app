import Foundation
import CoreFoundation
import DIPContracts
@preconcurrency import FirebaseFirestore

/// `companies/{companyId}/challenges/{challengeId}` -> `Challenge` DTO. Firestore stores
/// Timestamps (wire DTOs use RFC3339 strings); the ID comes from snapshot metadata.
/// Fails closed on any missing, mistyped or out-of-range field, like EventDocumentMapper.
/// Additive optional fields (createdBy, createdAt, updatedAt, revision) are not read.
enum ChallengeDocumentMapper {
    static func decode(id: String, companyID: String, fields: [String: Any]?) throws -> DIPContracts.Challenge? {
        guard let f = fields else { return nil }
        func string(_ key: String, maximum: Int) throws -> String {
            guard let value = f[key] as? String, value.count <= maximum else { throw ChallengeReadFailure.invalidDocument }
            return value
        }
        func text(_ key: String, maximum: Int) throws -> String {
            let value = try string(key, maximum: maximum)
            guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw ChallengeReadFailure.invalidDocument }
            return value
        }
        func number(_ key: String) throws -> Double {
            guard let number = f[key] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                  number.doubleValue.isFinite else { throw ChallengeReadFailure.invalidDocument }
            return number.doubleValue
        }
        func integer(_ key: String, range: ClosedRange<Int>) throws -> Int {
            let value = try number(key)
            guard value.rounded() == value, let result = Int(exactly: value), range.contains(result) else { throw ChallengeReadFailure.invalidDocument }
            return result
        }
        func date(_ key: String) throws -> Date {
            guard let value = f[key] as? Timestamp else { throw ChallengeReadFailure.invalidDocument }
            return value.dateValue()
        }
        guard MemberEventsRepository.validID(id), try string("companyId", maximum: 128) == companyID,
              let tags = f["tagIds"] as? [String], tags.count <= 20, tags.allSatisfy(MemberEventsRepository.validID)
        else { throw ChallengeReadFailure.invalidDocument }
        let goal = try number("goal")
        let start = try date("startDate"), end = try date("endDate")
        let coverImageURL = try text("coverImageURL", maximum: 2048)
        guard goal > 0, goal <= 10_000, end > start,
              end.timeIntervalSince(start) <= MemberChallengesRepository.maximumSpan else { throw ChallengeReadFailure.invalidDocument }
        return DIPContracts.Challenge(
            id: id, companyId: companyID, title: try text("title", maximum: 60),
            description: try text("description", maximum: 1000), tagIds: tags, type: try text("type", maximum: 32),
            goal: goal, goalUnit: try text("goalUnit", maximum: 24), coverImageURL: coverImageURL,
            startDate: start, endDate: end, pointsReward: try integer("pointsReward", range: 0...1000),
            participantCount: try integer("participantCount", range: 0...Int(Int32.max)),
            completedCount: try integer("completedCount", range: 0...Int(Int32.max)))
    }
}
