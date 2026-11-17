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

    @MainActor func testWriteThatOutlastsTheTimeoutIsPendingNotFailed() async throws {
        // Firestore keeps the write queued; failing it would show a ghost message and a duplicate after an edit.
        let outcome = try await FirebaseParticipationSource.write(timeout: .milliseconds(30)) { _ in }
        XCTAssertEqual(outcome, .pending)
    }

    @MainActor func testAcknowledgedWriteIsCommittedAndRealErrorsStillThrow() async throws {
        let committed = try await FirebaseParticipationSource.write(timeout: .seconds(5)) { done in done(nil) }
        XCTAssertEqual(committed, .committed)
        do {
            try await FirebaseParticipationSource.write(timeout: .seconds(5)) { done in done(ChatFailure.notGoing) }
            XCTFail("a denied write must surface")
        } catch { XCTAssertEqual(error as? ChatFailure, .notGoing) }
    }
}
