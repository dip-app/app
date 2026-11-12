import XCTest
@testable import DIPDesignSystem

final class DIPBadgeCountTests: XCTestCase {
    func testTheBellBadgeCapsAtNinePlus() {
        XCTAssertEqual(DIPBadgeCount.text(0), "0")
        XCTAssertEqual(DIPBadgeCount.text(1), "1")
        XCTAssertEqual(DIPBadgeCount.text(9), "9")
        XCTAssertEqual(DIPBadgeCount.text(10), "9+")
        XCTAssertEqual(DIPBadgeCount.text(50), "9+")
        XCTAssertEqual(DIPBadgeCount.text(-3), "0")
    }
}
