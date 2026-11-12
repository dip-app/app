import DIPCore
import XCTest
@testable import DIP

final class NotificationDocumentMapperTests: XCTestCase {
    private let created = Date(timeIntervalSince1970: 1_900_000_000)

    private func fields(_ overrides: [String: Any] = [:]) -> [String: Any] {
        var base: [String: Any] = [
            "userId": "me", "companyId": "alpha", "type": "event_cancelled", "title": "Board Game Night",
            "body": "This activity was cancelled.", "targetType": "event", "targetId": "e4", "isRead": false, "createdAt": created,
        ]
        for (key, value) in overrides { base[key] = value }
        return base
    }

    func testAServerCreatedEventNoticeMapsToKindDestinationAndTime() {
        let item = NotificationDocumentMapper.notification(id: "event_e4_3", fields: fields(), uid: "me")
        XCTAssertEqual(item?.kind, .eventCancelled)
        XCTAssertEqual(item?.destination, .event("e4"))
        XCTAssertEqual(item?.createdAt, created)
        XCTAssertEqual(item?.isRead, false)
    }

    func testInviteAndChallengeNoticesRoute() {
        XCTAssertEqual(NotificationDocumentMapper.notification(
            id: "invite_x", fields: fields(["type": "invite", "targetType": "invite", "targetId": "x"]), uid: "me")?.destination, .invitations)
        XCTAssertEqual(NotificationDocumentMapper.notification(
            id: "c", fields: fields(["type": "challenge_approved", "targetType": "challenge", "targetId": "week1"]), uid: "me")?.destination, .challenge("week1"))
    }

    func testAnotherRecipientsOrMalformedDocumentIsDropped() {
        XCTAssertNil(NotificationDocumentMapper.notification(id: "a", fields: fields(["userId": "someone-else"]), uid: "me"))
        XCTAssertNil(NotificationDocumentMapper.notification(id: "b", fields: fields(["title": ""]), uid: "me"))
        XCTAssertNil(NotificationDocumentMapper.notification(id: "c", fields: fields(["type": 7]), uid: "me"))
    }

    func testMissingOptionalFieldsDefaultSafely() {
        let item = NotificationDocumentMapper.notification(
            id: "d", fields: ["type": "mystery", "title": "Hello"], uid: "me")
        XCTAssertEqual(item?.kind, .other)
        XCTAssertEqual(item?.destination, DIPNotificationDestination.none)
        XCTAssertEqual(item?.body, "")
        XCTAssertEqual(item?.isRead, false)
    }
}
