import DIPCore
import XCTest
@preconcurrency import FirebaseFunctions
@testable import DIP

final class InviteDocumentMapperTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 2_000_000_000)

    private func fields(_ patch: [String: Any] = [:]) -> [String: Any] {
        var base: [String: Any] = [
            "companyId": "alpha", "eventId": "event", "eventTitle": "Pasta Night", "eventStartTime": start,
            "fromUserId": "sender", "fromUserName": "Sam Sender", "toUserId": "me", "toUserName": "Me Myself",
            "message": "Join us", "status": "pending", "createdAt": Date(timeIntervalSince1970: 1_999_000_000),
        ]
        for (key, value) in patch { base[key] = value }
        return base
    }

    func testReceivedShowsTheSenderAndSentShowsTheRecipient() throws {
        let received = try XCTUnwrap(InviteDocumentMapper.invite(id: "event_me", fields: fields(), companyID: "alpha", uid: "me", direction: .received))
        XCTAssertEqual(received.personID, "sender")
        XCTAssertEqual(received.personName, "Sam Sender")
        XCTAssertEqual(received.eventStart, start)
        XCTAssertEqual(received.message, "Join us")
        XCTAssertEqual(received.status, .pending)
        let sent = try XCTUnwrap(InviteDocumentMapper.invite(id: "event_me", fields: fields(["fromUserId": "me", "toUserId": "other", "toUserName": "Olive"]),
                                                              companyID: "alpha", uid: "me", direction: .sent))
        XCTAssertEqual(sent.personID, "other")
        XCTAssertEqual(sent.personName, "Olive")
    }

    func testRowsOfAnotherUserOrTenantAreDropped() {
        XCTAssertNil(InviteDocumentMapper.invite(id: "x", fields: fields(), companyID: "beta", uid: "me", direction: .received))
        XCTAssertNil(InviteDocumentMapper.invite(id: "x", fields: fields(), companyID: "alpha", uid: "someone-else", direction: .received))
        XCTAssertNil(InviteDocumentMapper.invite(id: "x", fields: fields(), companyID: "alpha", uid: "me", direction: .sent))
    }

    func testMalformedDocumentsAreSkippedNotFatal() {
        for patch: [String: Any] in [["status": "maybe"], ["eventStartTime": "tomorrow"], ["eventId": ""], ["eventTitle": 5]] {
            XCTAssertNil(InviteDocumentMapper.invite(id: "x", fields: fields(patch), companyID: "alpha", uid: "me", direction: .received), "\(patch)")
        }
    }

    func testMissingNamesFallBackAndMissingCreatedAtUsesTheEventStart() throws {
        var f = fields(["fromUserName": ""]); f.removeValue(forKey: "createdAt")
        let invite = try XCTUnwrap(InviteDocumentMapper.invite(id: "x", fields: f, companyID: "alpha", uid: "me", direction: .received))
        XCTAssertEqual(invite.personName, "A coworker")
        XCTAssertEqual(invite.createdAt, start)
    }

    func testCoworkerRowsKeepOnlyTheMinimalDirectoryFields() throws {
        let row: [String: Any] = ["userId": "u1", "displayName": "Priya Shah", "avatarId": "a", "department": "Design", "state": "invited", "email": "leak@x.com"]
        let coworker = try XCTUnwrap(InviteDocumentMapper.coworker(row))
        XCTAssertEqual(coworker.id, "u1"); XCTAssertEqual(coworker.name, "Priya Shah"); XCTAssertEqual(coworker.team, "Design")
        XCTAssertEqual(coworker.state, .invited)
        XCTAssertEqual(coworker.avatar, .generatedAvatar(userID: "u1"))
        XCTAssertNil(InviteDocumentMapper.coworker(["userId": "", "displayName": "x"]))
        XCTAssertNil(InviteDocumentMapper.coworker(["userId": "u", "displayName": ""]))
        XCTAssertEqual(InviteDocumentMapper.coworker(["userId": "u", "displayName": "N", "state": "weird"])?.state, .available)
    }

    func testCallableReasonsMapToActionableFailures() {
        func error(_ reason: String, _ code: FunctionsErrorCode) -> NSError {
            NSError(domain: FunctionsErrorDomain, code: code.rawValue, userInfo: [FunctionsErrorDetailsKey: ["reason": reason]])
        }
        let cases: [(String, FunctionsErrorCode, DIPInviteFailure)] = [
            ("ALREADY_INVITED", .failedPrecondition, .alreadyInvited), ("ALREADY_GOING", .failedPrecondition, .alreadyGoing),
            ("EVENT_FULL", .resourceExhausted, .full), ("EVENT_CLOSED", .failedPrecondition, .closed),
            ("EVENT_CANCELLED", .failedPrecondition, .cancelled), ("INVITE_NOT_FOUND", .notFound, .notFound),
            ("RATE_LIMITED", .resourceExhausted, .rateLimited), ("MEMBERSHIP_CONFLICT", .permissionDenied, .notMember),
        ]
        for (reason, code, expected) in cases {
            XCTAssertEqual(FirebaseInvitesRepository.failure(error(reason, code)), expected, reason)
        }
        XCTAssertEqual(FirebaseInvitesRepository.failure(NSError(domain: FunctionsErrorDomain, code: FunctionsErrorCode.unavailable.rawValue)), .offline)
        XCTAssertEqual(FirebaseInvitesRepository.failure(NSError(domain: FunctionsErrorDomain, code: FunctionsErrorCode.unauthenticated.rawValue)), .unauthenticated)
        XCTAssertEqual(FirebaseInvitesRepository.failure(NSError(domain: NSURLErrorDomain, code: NSURLErrorNotConnectedToInternet)), .offline)
        XCTAssertEqual(FirebaseInvitesRepository.failure(NSError(domain: "x", code: 1)), .unknown)
    }
}
