import UIKit
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
        // The rail lives in the sensor column, so list and detail share the whole free width.
        XCTAssertEqual(DIPDuoPaneLayout.listWidth + DIPDuoPaneLayout.dividerWidth + detail, free)
        XCTAssertEqual(detail, 473)
        // The detail pane has to hold the event page: never narrower than a 44 pt target row plus its 20 pt insets.
        XCTAssertGreaterThanOrEqual(detail, 360)
        XCTAssertEqual(DIPDuoPaneLayout.detailWidth(total: 100), 0)
    }

    func testSensorColumnFollowsTheSafeAreaSide() {
        // Landscape: island on the right. Rotated 180: it mirrors to the left. The rail follows it.
        XCTAssertEqual(DIPDuoSensor.resolve(safeLeading: 0, safeTrailing: 84), DIPDuoSensor(onTrailing: true, width: 84))
        XCTAssertEqual(DIPDuoSensor.resolve(safeLeading: 84, safeTrailing: 0), DIPDuoSensor(onTrailing: false, width: 84))
        XCTAssertNil(DIPDuoSensor.resolve(safeLeading: 0, safeTrailing: 0))
        XCTAssertNil(DIPDuoSensor.resolve(safeLeading: -3, safeTrailing: 0))
    }

    func testRailFitsTheSensorColumnBelowThePill() {
        // 4 tabs + bell at 56 pt, 10 pt gaps, divider, capsule padding: must fit under the pill in a 669 pt window.
        let rail: CGFloat = 5 * 56 + 5 * 10 + 1 + 20
        XCTAssertLessThanOrEqual(DIPDuoSensor.pillClearance + rail, 669)
        XCTAssertGreaterThanOrEqual(84, 56 + 12)
    }

    func testFoldedOuterDisplayRailStartsBelowItsTallerPill() {
        // Outer display, portrait 466x678: camera, clock and the wifi pill reach y 151 pt; 84 pt column on either side.
        let right = DIPDuoSensor.resolve(safeLeading: 0, safeTrailing: 84, open: false)
        XCTAssertEqual(right, DIPDuoSensor(onTrailing: true, width: 84, topClearance: DIPDuoSensor.outerPillClearance))
        XCTAssertEqual(DIPDuoSensor.resolve(safeLeading: 84, safeTrailing: 0, open: false)?.onTrailing, false)
        XCTAssertGreaterThan(DIPDuoSensor.outerPillClearance, 151)
        XCTAssertEqual(DIPDuoSensor.resolve(safeLeading: 0, safeTrailing: 84)?.topClearance, DIPDuoSensor.pillClearance)
        // Tabs only (the phone header keeps the bell): 4 x 56 + 3 x 10 + capsule padding, above the 34 pt home indicator.
        let rail = DIPDuoRail.track.restingOrigin(index: 3) + DIPDuoRail.item + 20
        XCTAssertLessThanOrEqual(DIPDuoSensor.outerPillClearance + rail, 678 - 34)
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

    // MARK: Hysteresis, latch, regular iPhones

    func testOpenPostureHasHysteresisAroundTheThreshold() {
        // Not open yet: needs the full open width.
        XCTAssertFalse(DIPDuoLayout.isOpen(hingeAvailable: true, width: 759, wasOpen: false))
        XCTAssertTrue(DIPDuoLayout.isOpen(hingeAvailable: true, width: 760, wasOpen: false))
        // Already open: stays open down to the close width, closes below it.
        XCTAssertTrue(DIPDuoLayout.isOpen(hingeAvailable: true, width: 745, wasOpen: true))
        XCTAssertTrue(DIPDuoLayout.isOpen(hingeAvailable: true, width: 740, wasOpen: true))
        XCTAssertFalse(DIPDuoLayout.isOpen(hingeAvailable: true, width: 739, wasOpen: true))
        // Jitter around 750 never flips an open shell.
        var open = true
        for width in [752.0, 748, 755, 742, 751] { open = DIPDuoLayout.isOpen(hingeAvailable: true, width: width, wasOpen: open) }
        XCTAssertTrue(open)
        XCTAssertLessThan(DIPDuoLayout.closeBelowWidth, DIPDuoLayout.openMinWidth)
    }

    func testRegularIPhonesAreNeverDuoWhateverTheHistory() {
        // SE, 17 Pro, Pro Max portrait and landscape (and a tablet width): no hinge, so never open and no insets.
        let sizes: [(CGFloat, CGFloat)] = [(375, 667), (402, 874), (440, 956), (667, 375), (874, 402), (956, 440), (1024, 768)]
        for (width, _) in sizes {
            XCTAssertFalse(DIPDuoLayout.isOpen(hingeAvailable: false, width: width, wasOpen: false), "width \(width)")
            XCTAssertFalse(DIPDuoLayout.isOpen(hingeAvailable: false, width: width, wasOpen: true), "width \(width)")
            XCTAssertEqual(DIPDuoLayout.resolve(hingeAvailable: false, safeLeading: 59, safeTrailing: 59, containerWidth: width), .none)
        }
        // Without a hinge update ever seen the latch stays false.
        XCTAssertFalse(DIPDuoLayout.latchedHinge(seen: false, update: false))
    }

    func testHingeAvailabilityLatchesOnceSeen() {
        XCTAssertTrue(DIPDuoLayout.latchedHinge(seen: false, update: true))
        XCTAssertTrue(DIPDuoLayout.latchedHinge(seen: true, update: false), "a transient nil update must not swap the subtree back")
        XCTAssertTrue(DIPDuoLayout.latchedHinge(seen: true, update: true))
    }

    // MARK: Selection ordering, route dedupe

    func testDefaultEventUsesTheHomeGridOrdering() {
        // Home shows calendar-friendly events first; the detail pane opens the first card, not the first id.
        XCTAssertEqual(DIPDuoPaneLayout.defaultSelection(in: ["a", "b", "c"], conflicted: ["a"]), "b")
        XCTAssertEqual(DIPDuoPaneLayout.defaultSelection(in: ["a", "b"], conflicted: ["a", "b"]), "a")
        XCTAssertEqual(DIPDuoPaneLayout.defaultSelection(in: ["a", "b"], conflicted: []), "a")
        XCTAssertNil(DIPDuoPaneLayout.defaultSelection(in: [], conflicted: ["a"]))
    }

    func testRapidDoubleTapDoesNotStackTheSameRouteTwice() {
        XCTAssertEqual(DIPDuoPaneLayout.appending("album", to: ["event"]), ["event", "album"])
        XCTAssertEqual(DIPDuoPaneLayout.appending("album", to: ["event", "album"]), ["event", "album"])
        XCTAssertEqual(DIPDuoPaneLayout.appending("album", to: []), ["album"])
        // The same page may be revisited deeper in the stack.
        XCTAssertEqual(DIPDuoPaneLayout.appending("event", to: ["event", "album"]), ["event", "album", "event"])
    }

    func testRemovedSelectionFallsBackToTheDefault() {
        XCTAssertEqual(DIPDuoPaneLayout.resolvedSelection(selected: "gone", exists: { $0 == "a" }, fallback: "a"), "a")
        XCTAssertEqual(DIPDuoPaneLayout.resolvedSelection(selected: "a", exists: { $0 == "a" }, fallback: "b"), "a")
        XCTAssertNil(DIPDuoPaneLayout.resolvedSelection(selected: nil, exists: { _ in true }, fallback: nil))
    }

    // MARK: Orientation

    func testOuterDisplayIsPortraitOnly() {
        // Folded: hinge closed and the 466x678 outer screen, whichever orientation the device last had.
        XCTAssertEqual(DIPDuoOrientation.supported(hingeAvailable: true, hingeClosed: true, screenLongSide: 678,
                                                   defaultMask: .allButUpsideDown), .portrait)
        // The outer screen alone decides it too (a half-open angle iOS shows on the outer display).
        XCTAssertEqual(DIPDuoOrientation.supported(hingeAvailable: true, hingeClosed: false, screenLongSide: 678,
                                                   defaultMask: .allButUpsideDown), .portrait)
    }

    func testInnerDisplayKeepsTheDefaultSet() {
        // Unfolded 951x669 inner display: landscape stays available (the open shell is a landscape layout).
        let mask = DIPDuoOrientation.supported(hingeAvailable: true, hingeClosed: false, screenLongSide: 951,
                                               defaultMask: .allButUpsideDown)
        XCTAssertEqual(mask, .allButUpsideDown)
        XCTAssertTrue(mask.contains(.landscapeLeft) && mask.contains(.landscapeRight))
    }

    func testRegularIPhonesAndIPadsAreUnchanged() {
        for side in [CGFloat(568), 874, 956, 1366] {
            XCTAssertEqual(DIPDuoOrientation.supported(hingeAvailable: false, hingeClosed: false, screenLongSide: side,
                                                       defaultMask: .allButUpsideDown), .allButUpsideDown)
            XCTAssertEqual(DIPDuoOrientation.supported(hingeAvailable: false, hingeClosed: true, screenLongSide: side,
                                                       defaultMask: .all), .all)
        }
    }

    func testDefaultMaskFollowsTheInfoPlist() {
        // No key (the app today): UIKit's default for the idiom.
        XCTAssertEqual(DIPDuoOrientation.infoPlistMask([:], idiom: .phone), .allButUpsideDown)
        XCTAssertEqual(DIPDuoOrientation.infoPlistMask([:], idiom: .pad), .all)
        let portraitOnly = ["UISupportedInterfaceOrientations": ["UIInterfaceOrientationPortrait"]]
        XCTAssertEqual(DIPDuoOrientation.infoPlistMask(portraitOnly, idiom: .phone), .portrait)
        let phoneSpecific: [String: Any] = [
            "UISupportedInterfaceOrientations": ["UIInterfaceOrientationPortrait"],
            "UISupportedInterfaceOrientations~iphone": ["UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"]
        ]
        XCTAssertEqual(DIPDuoOrientation.infoPlistMask(phoneSpecific, idiom: .phone), .landscape)
    }

    @MainActor func testAppDelegateAnswersTheOrientationQuery() {
        let delegate = DIPAppDelegate()
        XCTAssertTrue(delegate.responds(to: #selector(UIApplicationDelegate.application(_:supportedInterfaceOrientationsFor:))))
        // This test host is not a hinge device: the app's default set, as before.
        XCTAssertEqual(delegate.application(UIApplication.shared, supportedInterfaceOrientationsFor: nil),
                       DIPDuoOrientation.infoPlistMask(idiom: UIDevice.current.userInterfaceIdiom))
    }
}
