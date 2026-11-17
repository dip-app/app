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

    func testInnerDisplayPortraitStillGetsAPhoneColumn() {
        let layout = DIPDuoLayout.resolve(hingeAvailable: true, safeLeading: 0, safeTrailing: 0, containerWidth: 669)
        let column = 669 - layout.leading - layout.trailing
        XCTAssertEqual(column, DIPDuoLayout.maxColumnWidth, accuracy: 0.001)
        XCTAssertEqual(layout.leading, layout.trailing, accuracy: 0.001)
        XCTAssertFalse(DIPDuoLayout.isOpen(hingeAvailable: true, width: column))
    }

    func testInnerDisplayLandscapeSpansTheWholeFreeWidth() {
        // 951 pt wide, 84 pt island on the trailing edge: the open posture uses all 867 pt.
        let layout = DIPDuoLayout.resolve(hingeAvailable: true, safeLeading: 0, safeTrailing: 84, containerWidth: 951)
        XCTAssertEqual(layout, DIPDuoLayout(leading: 0, trailing: 84))
        XCTAssertTrue(DIPDuoLayout.isOpen(hingeAvailable: true, width: 951 - layout.leading - layout.trailing))
    }

    func testOpenPostureIsNeverTrueWithoutAHinge() {
        // Regular iPhones in landscape (874 pt, Pro Max) and every iPad width stay on their existing layouts.
        for width in [393.0, 430, 874, 932, 1024, 1366] {
            XCTAssertFalse(DIPDuoLayout.isOpen(hingeAvailable: false, width: width), "width \(width)")
        }
        XCTAssertFalse(DIPDuoLayout.isOpen(hingeAvailable: true, width: 466))
        XCTAssertFalse(DIPDuoLayout.isOpen(hingeAvailable: true, width: 594))
    }

    func testNegativeInsetsAreIgnored() {
        let layout = DIPDuoLayout.resolve(hingeAvailable: true, safeLeading: -4, safeTrailing: 10, containerWidth: 400)
        XCTAssertEqual(layout, DIPDuoLayout(leading: 0, trailing: 10))
    }

    // MARK: Open posture panes

    func testPanesFillTheOpenInnerDisplayExactly() {
        let free: CGFloat = 951 - 84
        let detail = DIPDuoPaneLayout.detailWidth(total: free)
        XCTAssertEqual(DIPDuoPaneLayout.railWidth + DIPDuoPaneLayout.listWidth + DIPDuoPaneLayout.dividerWidth + detail, free)
        // The detail pane has to hold the event page: never narrower than a 44 pt target row plus its 20 pt insets.
        XCTAssertGreaterThanOrEqual(detail, 360)
        XCTAssertEqual(DIPDuoPaneLayout.detailWidth(total: 100), 0)
    }

    func testListPaneIsAPhonesWidthSoPhoneCardsKeepTheirDesignedGeometry() {
        XCTAssertEqual(DIPDuoPaneLayout.listWidth - 40, 353)
    }

    func testPhoneInsetsAreUnchangedWhenNotOpen() {
        XCTAssertEqual(DIPDuoPaneLayout.topInset(open: false), 60)
        XCTAssertEqual(DIPDuoPaneLayout.bottomClearance(open: false), 120)
        XCTAssertEqual(DIPDuoPaneLayout.bottomClearance(open: false, phone: 150), 150)
        XCTAssertEqual(DIPDuoPaneLayout.topInset(open: true), 20)
    }

    func testDetailPaneOpensTheFirstListedEvent() {
        XCTAssertEqual(DIPDuoPaneLayout.defaultSelection(in: ["a", "b"]), "a")
        XCTAssertNil(DIPDuoPaneLayout.defaultSelection(in: []))
    }
}
