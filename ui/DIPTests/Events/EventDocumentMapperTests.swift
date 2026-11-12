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
    func testOnlyTenantIDAndStartTimeAreRequired() {
        var f = fields(); f["companyId"] = "beta"; XCTAssertThrowsError(try decode(f))
        f = fields(); f.removeValue(forKey: "startTime"); XCTAssertThrowsError(try decode(f))
        f = fields(); f["startTime"] = "2033-05-18T00:00:00Z"; XCTAssertThrowsError(try decode(f))
        XCTAssertThrowsError(try EventDocumentMapper.decode(id: "bad/id", companyID: "alpha", fields: fields()))
    }
    func testOddCountersFallBackInsteadOfHidingTheEvent() throws {
        var f = fields()
        f["costCents"] = true; f["capacity"] = 2.5; f["attendeeCount"] = -1; f["revision"] = 0; f["pointsValue"] = Double.infinity; f["isOutdoor"] = 1
        let event = try XCTUnwrap(decode(f))
        XCTAssertEqual(event.costCents, 0)
        XCTAssertEqual(event.capacity, 3, "2.5 rounds to a whole capacity")
        XCTAssertEqual(event.attendeeCount, 0)
        XCTAssertEqual(event.revision, 1)
        XCTAssertEqual(event.pointsValue, 0)
        XCTAssertFalse(event.isOutdoor)
        XCTAssertEqual(try MemberEventsRepository.metadata(event).revision, 1)
    }
    func testStringAndIntegerCoordinatesAndStringNumbersAreAccepted() throws {
        var f = fields(); f["pointsValue"] = "50"; f["capacity"] = "12"
        f["venue"] = ["name": "Cafe", "address": "1 Main", "locality": "Pittsburgh", "latitude": "40.5", "longitude": -79] as [String: Any]
        let event = try XCTUnwrap(decode(f))
        XCTAssertEqual(event.venue.latitude, 40.5)
        XCTAssertEqual(event.venue.longitude, -79)
        XCTAssertEqual(event.pointsValue, 50)
        XCTAssertEqual(event.capacity, 12)
    }
    func testMissingVenueFieldsAndCoordinatesStillProduceAnEvent() throws {
        var f = fields(); f.removeValue(forKey: "venue")
        var event = try XCTUnwrap(decode(f))
        XCTAssertEqual(event.venue.name, ""); XCTAssertEqual(event.venue.latitude, 0)
        for patch in [["latitude": 91.0], ["longitude": Double.nan], ["latitude": true], ["website": 123]] as [[String: Any]] {
            f = fields(); var venue = f["venue"] as! [String: Any]; venue.merge(patch) { _, new in new }; f["venue"] = venue
            event = try XCTUnwrap(decode(f))
            XCTAssertEqual(event.venue.name, "Cafe")
            XCTAssertNil(event.venue.website)
        }
    }
    func testMissingOptionalFieldsUseDefaults() throws {
        var f = fields()
        for key in ["title", "description", "tagIds", "coverImageURL", "costNote", "createdBy", "createdAt", "endTime", "status", "isOutdoor", "revision", "pointsValue", "attendeeCount", "capacity", "costCents"] { f.removeValue(forKey: key) }
        let event = try XCTUnwrap(decode(f))
        XCTAssertEqual(event.title, "Untitled activity")
        XCTAssertEqual(event.status, "scheduled")
        XCTAssertEqual(event.endTime.timeIntervalSince(event.startTime), 3600)
        XCTAssertEqual(event.capacity, 10000)
        XCTAssertEqual(event.tagIds, [])
        XCTAssertNoThrow(try MemberEventsRepository.metadata(event))
    }
    func testUnknownStatusIsScheduledAndSpellingVariantsAreNormalized() throws {
        for (raw, expected) in [("mystery", "scheduled"), ("canceled", "cancelled"), ("COMPLETED", "completed"), ("", "scheduled")] {
            var f = fields(); f["status"] = raw
            XCTAssertEqual(try decode(f)?.status, expected, raw)
        }
        var f = fields(); f["status"] = 7
        XCTAssertEqual(try decode(f)?.status, "scheduled")
    }
    func testEndNotAfterStartGetsADefaultDuration() throws {
        var f = fields(); f["endTime"] = f["startTime"]
        let event = try XCTUnwrap(decode(f))
        XCTAssertGreaterThan(event.endTime, event.startTime)
    }
    func testPointsAndChangeLogAreMappedAndMalformedEntriesSkipped() throws {
        var f = fields(); f["pointsValue"] = 50
        f["changeLog"] = [
            ["at": Timestamp(seconds: 1_900_000_100, nanoseconds: 0), "by": "organizer", "revision": 2,
             "changes": [["field": "venue.name", "from": "Cafe", "to": "Park"], ["field": "capacity", "from": "20", "to": NSNull()]]],
            ["at": "not a timestamp", "revision": 3, "changes": [["field": "title"]]],
            ["at": Timestamp(seconds: 1_900_000_200, nanoseconds: 0), "revision": 4, "changes": []],
        ] as [[String: Any]]
        let event = try XCTUnwrap(decode(f))
        XCTAssertEqual(event.pointsValue, 50)
        let log = try XCTUnwrap(event.changeLog)
        XCTAssertEqual(log.count, 1)
        XCTAssertEqual(log[0].changes.map(\.field), ["venue.name", "capacity"])
        XCTAssertNil(log[0].changes[1].to)
        let metadata = try MemberEventsRepository.metadata(event)
        XCTAssertEqual(metadata.pointsValue, 50)
        XCTAssertEqual(metadata.changeLog.count, 1)
        XCTAssertNil(try decode(fields())?.changeLog, "An event never edited has no changeLog")
        // A junk element does not drop the log; duplicate revisions keep the newest delivery.
        var g = fields()
        let at = Timestamp(seconds: 1_900_000_100, nanoseconds: 0)
        g["changeLog"] = ["junk", ["at": at, "revision": 2, "changes": [["field": "title", "from": "a", "to": "b"]]],
                          ["at": at, "revision": 2, "changes": [["field": "title", "from": "a", "to": "c"]]]] as [Any]
        let deduped = try XCTUnwrap(decode(g)?.changeLog)
        XCTAssertEqual(deduped.count, 1)
        XCTAssertEqual(deduped[0].changes[0].to, "c")
    }
    func testCancelledDetailsAndNullOptionalFieldsRemainReadable() throws {
        var f = fields(); f["status"] = "cancelled"
        var venue = f["venue"] as! [String: Any]; venue["website"] = NSNull(); f["venue"] = venue
        XCTAssertEqual(try decode(f)?.status, "cancelled")
    }
}
