import DIPCore
import DIPMockData
import XCTest

final class ConversationScrollTests: XCTestCase {
    func testIncomingMessagesRespectHistoryButOwnSendsStayVisible() throws {
        let incoming = try XCTUnwrap(DIPMockFixtures.reference.messages["puppy-yoga"]?.first)
        XCTAssertFalse(DIPConversationScrollPolicy.shouldFollow(isNearBottom: false, previousIDs: [], messages: [incoming], currentUserID: "me"))
        XCTAssertTrue(DIPConversationScrollPolicy.shouldFollow(isNearBottom: true, previousIDs: [], messages: [incoming], currentUserID: "me"))
        XCTAssertTrue(DIPConversationScrollPolicy.shouldFollow(isNearBottom: false, previousIDs: [], messages: [incoming], currentUserID: incoming.authorID))
        XCTAssertFalse(DIPConversationScrollPolicy.shouldFollow(isNearBottom: true, previousIDs: [incoming.id], messages: [incoming], currentUserID: incoming.authorID))
    }
}
