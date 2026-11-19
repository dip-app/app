import CoreGraphics
import XCTest
@testable import DIPDesignSystem

final class DIPTabMarkerTrackTests: XCTestCase {
    /// The phone bar keeps its previous geometry exactly: 353 pt bar, four tabs, slot step (353 - 80) / 3 = 91.
    func testFloatingBarMatchesThePhoneGeometry() {
        let track = DIPTabMarkerTrack.floatingBar(width: 353, count: 4)
        XCTAssertEqual(track.step, 91, accuracy: 0.001)
        XCTAssertEqual(track.restingOrigin(index: 0), 10)
        XCTAssertEqual(track.restingOrigin(index: 3), 283, accuracy: 0.001)
        // Old drag formula: x = clamp(location - 40, 10, 10 + 3 * step); index = round((x - 10) / step).
        for location in stride(from: CGFloat(-50), through: 420, by: 7) {
            let old = min(max(location - 40, 10), 10 + 3 * track.step)
            XCTAssertEqual(track.origin(forFinger: location), old, accuracy: 0.0001)
            XCTAssertEqual(track.index(forOrigin: old), min(max(Int(((old - 10) / track.step).rounded()), 0), 3))
        }
    }

    func testFingerIsClampedToTheFirstAndLastSlot() {
        let track = DIPTabMarkerTrack.rail(count: 4, item: 56, spacing: 10)
        XCTAssertEqual(track.origin(forFinger: -100), 0)
        XCTAssertEqual(track.origin(forFinger: 10_000), 3 * 66)
        XCTAssertEqual(track.index(forOrigin: track.origin(forFinger: -100)), 0)
        XCTAssertEqual(track.index(forOrigin: track.origin(forFinger: 10_000)), 3)
    }

    /// The rail is the same track on the vertical axis: the finger holds the disc's centre, and each tab is selected
    /// once the disc is past the midpoint between two slots.
    func testRailSelectsTheTabUnderTheFinger() {
        let track = DIPTabMarkerTrack.rail(count: 4, item: 56, spacing: 10)
        XCTAssertEqual(track.step, 66)
        for index in 0..<4 {
            let centre = CGFloat(index) * 66 + 28
            XCTAssertEqual(track.restingOrigin(index: index), CGFloat(index) * 66)
            XCTAssertEqual(track.index(forOrigin: track.origin(forFinger: centre)), index)
        }
        XCTAssertEqual(track.index(forOrigin: track.origin(forFinger: 28 + 32)), 0)
        XCTAssertEqual(track.index(forOrigin: track.origin(forFinger: 28 + 34)), 1)
    }

    func testDegenerateTracksNeverCrashOrLeaveTheSlots() {
        let single = DIPTabMarkerTrack.floatingBar(width: 80, count: 1)
        XCTAssertEqual(single.index(forOrigin: 500), 0)
        let empty = DIPTabMarkerTrack(count: 0, firstOrigin: 0, step: 0, grabOffset: 0)
        XCTAssertEqual(empty.count, 1)
        XCTAssertEqual(empty.index(forOrigin: 40), 0)
        XCTAssertEqual(empty.restingOrigin(index: 7), 0)
    }
}
