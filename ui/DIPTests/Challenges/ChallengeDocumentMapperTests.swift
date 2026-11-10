import XCTest
import DIPContracts
@preconcurrency import FirebaseFirestore
@testable import DIP

final class ChallengeDocumentMapperTests: XCTestCase {
    /// Monday Nov 9 2026 00:00 America/New_York, to the following Monday minus one second.
    let start = Timestamp(seconds: 1_794_200_400, nanoseconds: 250_000_000)
    func fields() -> [String: Any] {
        ["companyId": "alpha", "title": "Fitness", "description": "Get moving with coworkers this week.", "tagIds": ["tag-fitness"],
         "type": "weekly", "goal": 3, "goalUnit": "workouts", "coverImageURL": "catalog://theme/fitness",
         "startDate": start, "endDate": Timestamp(seconds: 1_794_200_400 + 7 * 86_400 - 1, nanoseconds: 0),
         "pointsReward": 50, "participantCount": 128, "completedCount": 0,
         // Additive optional fields from the backend are tolerated and not mapped.
         "createdBy": "organizer", "createdAt": Timestamp(seconds: 1_794_000_000, nanoseconds: 0), "revision": 2]
    }
    func decode(_ fields: [String: Any]?, id: String = "weekly-fitness-20261109") throws -> DIPContracts.Challenge? {
        try ChallengeDocumentMapper.decode(id: id, companyID: "alpha", fields: fields)
    }

    func testValidDocumentMapsToDTOWithSnapshotIDAndTimestampPrecision() throws {
        var f = fields(); f["id"] = "spoofed"
        let challenge = try XCTUnwrap(decode(f))
        XCTAssertEqual(challenge.id, "weekly-fitness-20261109")
        XCTAssertEqual(challenge.companyId, "alpha")
        XCTAssertEqual(challenge.title, "Fitness"); XCTAssertEqual(challenge.type, "weekly")
        XCTAssertEqual(challenge.goal, 3); XCTAssertEqual(challenge.goalUnit, "workouts")
        XCTAssertEqual(challenge.coverImageURL, "catalog://theme/fitness")
        XCTAssertEqual(challenge.startDate.timeIntervalSince1970, 1_794_200_400.25, accuracy: 0.000001)
        XCTAssertEqual(challenge.pointsReward, 50); XCTAssertEqual(challenge.participantCount, 128)
        XCTAssertEqual(try decode(fields().merging(["goal": 2.5]) { $1 })?.goal, 2.5)
    }

    func testMissingDocumentIsDistinctFromMalformedOrOtherTenant() throws {
        XCTAssertNil(try decode(nil))
        var f = fields(); f["companyId"] = "beta"; XCTAssertThrowsError(try decode(f))
        f = fields(); f.removeValue(forKey: "companyId"); XCTAssertThrowsError(try decode(f))
        XCTAssertThrowsError(try decode(fields(), id: "bad/id"))
        XCTAssertThrowsError(try decode(fields(), id: ""))
    }

    func testRequiredFieldsAreTypedAndBounded() {
        let invalid: [(String, Any?)] = [
            ("title", nil), ("title", ""), ("title", "   "), ("title", String(repeating: "x", count: 61)), ("title", 7),
            ("description", nil), ("description", String(repeating: "x", count: 1001)),
            ("tagIds", nil), ("tagIds", ["ok", "no/slash"]), ("tagIds", "tag-fitness"),
            ("type", nil), ("type", ""),
            ("goal", nil), ("goal", 0), ("goal", -1), ("goal", 10_001), ("goal", true), ("goal", Double.nan), ("goal", "3"),
            ("goalUnit", nil), ("goalUnit", ""), ("goalUnit", String(repeating: "x", count: 25)),
            ("coverImageURL", nil), ("coverImageURL", ""),
            ("startDate", nil), ("startDate", "2026-11-09T05:00:00Z"), ("endDate", Date()),
            ("pointsReward", nil), ("pointsReward", -1), ("pointsReward", 1001), ("pointsReward", 2.5), ("pointsReward", false),
            ("participantCount", nil), ("participantCount", -1), ("participantCount", 1.5), ("participantCount", true),
            ("completedCount", nil), ("completedCount", -3),
        ]
        for (key, value) in invalid {
            var f = fields(); f[key] = value
            XCTAssertThrowsError(try decode(f), "Unexpected acceptance of \(key) = \(String(describing: value))")
        }
    }

    func testWindowMustBeOrderedAndAtMostFourteenDays() {
        var f = fields(); f["endDate"] = start; XCTAssertThrowsError(try decode(f), "empty window")
        f["endDate"] = Timestamp(seconds: start.seconds - 1, nanoseconds: 0); XCTAssertThrowsError(try decode(f), "reversed window")
        f["endDate"] = Timestamp(seconds: start.seconds + 14 * 86_400 + 1, nanoseconds: 0); XCTAssertThrowsError(try decode(f), "over 14 days")
        f["endDate"] = Timestamp(seconds: start.seconds + 14 * 86_400, nanoseconds: 250_000_000); XCTAssertNoThrow(try decode(f))
    }

    func testUnknownThemeAndFutureTypeStillDecode() throws {
        // The catalog, not the mapper, decides presentation: an unknown key renders the fallback.
        var f = fields(); f["coverImageURL"] = "catalog://theme/sleep"; f["type"] = "monthly"
        XCTAssertEqual(try decode(f)?.coverImageURL, "catalog://theme/sleep")
    }

    func testFirestoreErrorsMapToReadFailures() {
        func error(_ code: FirestoreErrorCode.Code) -> NSError { NSError(domain: FirestoreErrorDomain, code: code.rawValue) }
        XCTAssertEqual(FirebaseChallengeReadSource.failure(error(.permissionDenied)), .permissionDenied)
        XCTAssertEqual(FirebaseChallengeReadSource.failure(error(.unauthenticated)), .unauthenticated)
        XCTAssertEqual(FirebaseChallengeReadSource.failure(error(.unavailable)), .unavailable)
        XCTAssertEqual(FirebaseChallengeReadSource.failure(ChallengeReadFailure.invalidDocument), .invalidDocument)
        XCTAssertEqual(FirebaseChallengeReadSource.failure(URLError(.notConnectedToInternet)), .unavailable)
    }
}
