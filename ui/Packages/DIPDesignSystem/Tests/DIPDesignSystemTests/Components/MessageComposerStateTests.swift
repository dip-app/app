#if canImport(SwiftUI)
import XCTest
@testable import DIPDesignSystem

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
}
#endif
