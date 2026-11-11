import XCTest

@testable import DIPDesignSystem

final class DIPSegmentedToggleTests: XCTestCase {
    private let geometry = DIPSegmentedGeometry(trackWidth: 362, trackHeight: 50, segmentCount: 2, inset: 5)

    func testThumbCoversExactlyOneSegmentWithUniformInset() {
        XCTAssertEqual(geometry.segmentWidth, 181)
        XCTAssertEqual(geometry.thumbWidth, 171)
        XCTAssertEqual(geometry.thumbHeight, 40)
        XCTAssertEqual(geometry.thumbX(for: 0), 5)
        XCTAssertEqual(geometry.thumbX(for: 1), 186)
        // Right edge of the last thumb leaves the same 5pt inset at the track end.
        XCTAssertEqual(362 - (geometry.thumbX(for: 1) + geometry.thumbWidth), 5)
    }

    func testDraggedThumbIsClampedAndSnapsToTheNearestSegment() {
        XCTAssertEqual(geometry.clampedThumbX(-40), 5)
        XCTAssertEqual(geometry.clampedThumbX(500), 186)
        XCTAssertEqual(geometry.nearestIndex(thumbX: 5), 0)
        XCTAssertEqual(geometry.nearestIndex(thumbX: 80), 0)
        XCTAssertEqual(geometry.nearestIndex(thumbX: 100), 1)
        XCTAssertEqual(geometry.nearestIndex(thumbX: 186), 1)
    }

    func testIndexIsAlwaysValid() {
        XCTAssertEqual(geometry.thumbX(for: 7), 186)
        XCTAssertEqual(DIPSegmentedGeometry(trackWidth: 0).nearestIndex(thumbX: 10), 0)
    }
}
