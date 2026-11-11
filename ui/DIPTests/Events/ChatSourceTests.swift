import XCTest
@testable import DIP

final class ChatSourceTests: XCTestCase {
    func testTextMustBeTrimmedAndWithinRuleLimits() throws {
        XCTAssertEqual(try ChatFailure.validated("  hello  "), "hello")
        XCTAssertThrowsError(try ChatFailure.validated("   \n")) { XCTAssertEqual($0 as? ChatFailure, .invalidText) }
        XCTAssertEqual(try ChatFailure.validated(String(repeating: "a", count: 1_000)).count, 1_000)
        XCTAssertThrowsError(try ChatFailure.validated(String(repeating: "a", count: 1_001)))
    }

    func testMessageIDsMatchTheDocumentIDRule() {
        XCTAssertTrue(ChatFailure.validMessageID(UUID().uuidString))
        XCTAssertTrue(ChatFailure.validMessageID("abc_DEF-123"))
        XCTAssertFalse(ChatFailure.validMessageID("short"))
        XCTAssertFalse(ChatFailure.validMessageID("has space in it"))
        XCTAssertFalse(ChatFailure.validMessageID(String(repeating: "a", count: 129)))
    }

    func testFailuresHaveClearUserMessages() {
        for failure in [ChatFailure.invalidText, .notGoing, .closed, .unauthenticated, .unavailable, .unknown] {
            XCTAssertFalse(failure.message.isEmpty)
        }
        XCTAssertTrue(ChatFailure.closed.message.contains("24 hours"))
    }
}
