#if canImport(SwiftUI)
import XCTest
@testable import DIPDesignSystem

@MainActor
final class MessageComposerStateTests: XCTestCase {
    func testSendIsDisabledUntilThereIsTextWithinTheLimit() {
        XCTAssertEqual(DIPMessageComposer.sendState(text: "", isSending: false), .disabled)
        XCTAssertEqual(DIPMessageComposer.sendState(text: "   \n ", isSending: false), .disabled)
        XCTAssertEqual(DIPMessageComposer.sendState(text: "Nice photo", isSending: false), .ready)
        XCTAssertEqual(DIPMessageComposer.sendState(text: String(repeating: "a", count: DIPMessageComposer.maximumLength), isSending: false), .ready)
        XCTAssertEqual(DIPMessageComposer.sendState(text: String(repeating: "a", count: DIPMessageComposer.maximumLength + 1), isSending: false), .disabled)
    }

    func testSendingWinsOverEverythingElse() {
        XCTAssertEqual(DIPMessageComposer.sendState(text: "Nice photo", isSending: true), .sending)
        XCTAssertEqual(DIPMessageComposer.sendState(text: "", isSending: true), .sending)
    }

    func testComposerHonoursItsOwnMaximumLength() {
        let chatLimit = 1_000
        XCTAssertEqual(DIPMessageComposer.sendState(text: String(repeating: "a", count: chatLimit), isSending: false, maximumLength: chatLimit), .ready)
        XCTAssertEqual(DIPMessageComposer.sendState(text: String(repeating: "a", count: chatLimit + 1), isSending: false, maximumLength: chatLimit), .disabled)
        // Comments keep the default 2,000.
        XCTAssertEqual(DIPMessageComposer.sendState(text: String(repeating: "a", count: chatLimit + 1), isSending: false), .ready)
        XCTAssertEqual(DIPMessageComposer.maximumLength, 2_000)
    }
}
#endif
