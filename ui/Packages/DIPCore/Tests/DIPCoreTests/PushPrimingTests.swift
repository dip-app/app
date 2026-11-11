import DIPCore
import Foundation
import XCTest

final class PushPrimingTests: XCTestCase {
    func testPrimesOnlyAfterTheFirstJoinOnceAndWhenUndecided() {
        XCTAssertTrue(DIPPushPriming.shouldPrime(featureEnabled: true, authorization: .notDetermined, alreadyPrimed: false, justJoined: true))
        XCTAssertFalse(DIPPushPriming.shouldPrime(featureEnabled: false, authorization: .notDetermined, alreadyPrimed: false, justJoined: true))
        XCTAssertFalse(DIPPushPriming.shouldPrime(featureEnabled: true, authorization: .notDetermined, alreadyPrimed: false, justJoined: false),
                       "Never at launch: only right after joining")
        XCTAssertFalse(DIPPushPriming.shouldPrime(featureEnabled: true, authorization: .notDetermined, alreadyPrimed: true, justJoined: true))
        for decided in [DIPPushAuthorization.denied, .authorized, .provisional, .ephemeral] {
            XCTAssertFalse(DIPPushPriming.shouldPrime(featureEnabled: true, authorization: decided, alreadyPrimed: false, justJoined: true))
        }
    }

    func testCanReceiveCoversEveryGrantedState() {
        XCTAssertTrue(DIPPushPriming.canReceive(.authorized))
        XCTAssertTrue(DIPPushPriming.canReceive(.provisional))
        XCTAssertTrue(DIPPushPriming.canReceive(.ephemeral))
        XCTAssertFalse(DIPPushPriming.canReceive(.denied))
        XCTAssertFalse(DIPPushPriming.canReceive(.notDetermined))
    }

    func testDeepLinkDestinationsIncludeTheChatFlag() {
        XCTAssertEqual(DIPShareLink.destination(from: URL(string: "dip://events/abc123")!), .init(eventID: "abc123", opensChat: false))
        XCTAssertEqual(DIPShareLink.destination(from: URL(string: "dip://events/abc123/chat")!), .init(eventID: "abc123", opensChat: true))
        XCTAssertEqual(DIPShareLink.destination(from: URL(string: "https://team05-dip.web.app/e/abc123")!), .init(eventID: "abc123", opensChat: false))
        XCTAssertNil(DIPShareLink.destination(from: URL(string: "dip://events/abc123/photos")!))
        // "chat" as the only segment is an event id, not the chat flag.
        XCTAssertEqual(DIPShareLink.destination(from: URL(string: "dip://events/chat")!), .init(eventID: "chat", opensChat: false))
        XCTAssertNil(DIPShareLink.destination(from: URL(string: "dip://other/abc123")!))
        XCTAssertNil(DIPShareLink.destination(from: URL(string: "https://evil.example/e/abc123")!))
    }
}
