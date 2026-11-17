import XCTest
@testable import DIP

final class DuoLayoutTests: XCTestCase {
    func testNonHingeDevicesGetNoInsetsEvenWithSideSafeAreas() {
        // A regular iPhone in landscape reports side insets (59 pt notch); they must never be re-applied.
        let layout = DIPDuoLayout.resolve(hingeAvailable: false, safeLeading: 59, safeTrailing: 59, containerWidth: 874)
        XCTAssertEqual(layout, .none)
        XCTAssertEqual(DIPDuoLayout.resolve(hingeAvailable: false, safeLeading: 0, safeTrailing: 0, containerWidth: 402), .none)
    }

    func testFoldedPortraitKeepsContentLeftOfTheSensorIsland() {
        let layout = DIPDuoLayout.resolve(hingeAvailable: true, safeLeading: 0, safeTrailing: 84, containerWidth: 466)
        XCTAssertEqual(layout, DIPDuoLayout(leading: 0, trailing: 84))
        XCTAssertEqual(466 - layout.leading - layout.trailing, 382)
    }

    func testFoldedLandscapeMirrorsTheIslandInset() {
        let right = DIPDuoLayout.resolve(hingeAvailable: true, safeLeading: 84, safeTrailing: 0, containerWidth: 678)
        // 678 - 84 leaves 594 pt, wider than a phone, so the 430 pt column is centred in what the island leaves free.
        XCTAssertEqual(right.leading, 84 + 82)
        XCTAssertEqual(right.trailing, 82)
        XCTAssertEqual(678 - right.leading - right.trailing, DIPDuoLayout.maxColumnWidth, accuracy: 0.001)
    }

    func testOpenPostureCentresOneColumnNoWiderThanAPhone() {
        let layout = DIPDuoLayout.resolve(hingeAvailable: true, safeLeading: 0, safeTrailing: 0, containerWidth: 669)
        let column = 669 - layout.leading - layout.trailing
        XCTAssertEqual(column, DIPDuoLayout.maxColumnWidth, accuracy: 0.001)
        XCTAssertEqual(layout.leading, layout.trailing, accuracy: 0.001)
    }

    func testNegativeInsetsAreIgnored() {
        let layout = DIPDuoLayout.resolve(hingeAvailable: true, safeLeading: -4, safeTrailing: 10, containerWidth: 400)
        XCTAssertEqual(layout, DIPDuoLayout(leading: 0, trailing: 10))
    }
}
