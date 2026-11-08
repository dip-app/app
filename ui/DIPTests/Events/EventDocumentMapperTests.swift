import XCTest
import DIPContracts
@preconcurrency import FirebaseFirestore
@testable import DIP

final class EventDocumentMapperTests: XCTestCase {
    func fields() -> [String: Any] {
        ["companyId": "alpha", "title": "Lunch", "description": "Team lunch", "tagIds": ["fitness"], "coverImageURL": "fixture", "startTime": Timestamp(seconds: 2_000_000_000, nanoseconds: 123_000_000), "endTime": Timestamp(seconds: 2_000_003_600, nanoseconds: 0), "venue": ["name": "Cafe", "address": "1 Main", "locality": "Pittsburgh", "latitude": 40.0, "longitude": -79.0], "costCents": 1250, "costNote": "", "capacity": 20, "pointsValue": 0, "isOutdoor": false, "status": "scheduled", "attendeeCount": 1, "createdBy": "host", "createdAt": Timestamp(seconds: 1_900_000_000, nanoseconds: 0), "revision": 1]
    }
    func decode(_ fields: [String: Any]?) throws -> DIPContracts.Event? { try EventDocumentMapper.decode(id: "event", companyID: "alpha", fields: fields) }
    func testSnapshotIDWinsAndTimestampPrecisionIsPreserved() throws {
        var f = fields(); f["id"] = "wrong-id"
        let event = try XCTUnwrap(decode(f))
        XCTAssertEqual(event.id, "event")
        XCTAssertEqual(event.startTime.timeIntervalSince1970, 2_000_000_000.123, accuracy: 0.000001)
        XCTAssertNil(event.venue.website)
    }
    func testMissingDocumentIsDistinctFromMalformedOrOtherTenant() throws {
        XCTAssertNil(try decode(nil))
        var f = fields(); f["companyId"] = "beta"; XCTAssertThrowsError(try decode(f))
        f = fields(); f.removeValue(forKey: "venue"); XCTAssertThrowsError(try decode(f))
        f = fields(); f["startTime"] = "2033-05-18T00:00:00Z"; XCTAssertThrowsError(try decode(f))
    }
    func testBooleanAndFractionalCountersAreNotIntegers() {
        for (key, value) in [("costCents", true as Any), ("capacity", 2.5 as Any), ("attendeeCount", -1 as Any), ("revision", 0 as Any), ("pointsValue", Double.infinity as Any), ("isOutdoor", 1 as Any)] {
            var f = fields(); f[key] = value; XCTAssertThrowsError(try decode(f), "Unexpected acceptance of \(key)")
        }
    }
    func testInvalidStatusDatesCoordinatesAndOptionalTypesFailClosed() {
        var f = fields(); f["status"] = "mystery"; XCTAssertThrowsError(try decode(f))
        f = fields(); f["endTime"] = f["startTime"]; XCTAssertThrowsError(try decode(f))
        for patch in [["latitude": 91.0], ["longitude": Double.nan], ["latitude": true], ["website": 123]] as [[String: Any]] {
            f = fields(); var venue = f["venue"] as! [String: Any]; venue.merge(patch) { _, new in new }; f["venue"] = venue
            XCTAssertThrowsError(try decode(f))
        }
    }
    func testCancelledDetailsAndNullOptionalFieldsRemainReadable() throws {
        var f = fields(); f["status"] = "cancelled"
        var venue = f["venue"] as! [String: Any]; venue["website"] = NSNull(); f["venue"] = venue
        XCTAssertEqual(try decode(f)?.status, "cancelled")
    }
}
