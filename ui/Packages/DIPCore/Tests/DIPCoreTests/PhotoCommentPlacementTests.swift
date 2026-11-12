import CoreGraphics
import DIPCore
import XCTest

final class PhotoCommentPlacementTests: XCTestCase {
    private let landscape = CGSize(width: 359, height: 262)
    private let portrait = CGSize(width: 359, height: 480)
    private let bubble = DIPPhotoCommentPlacement.defaultBubble

    private func ids(_ count: Int) -> [String] { (0..<count).map { "comment-\($0)" } }
    private func frame(_ item: DIPPhotoCommentPlacement.Item) -> CGRect {
        CGRect(x: item.center.x - bubble.width / 2, y: item.center.y - bubble.height / 2, width: bubble.width, height: bubble.height)
    }
    private func centre(_ size: CGSize) -> CGRect {
        let f = DIPPhotoCommentPlacement.centreFraction
        return CGRect(x: size.width * (1 - f) / 2, y: size.height * (1 - f) / 2, width: size.width * f, height: size.height * f)
    }

    func testBubblesStayInsetFromEveryEdgeAndNeverHugACorner() {
        for size in [landscape, portrait, CGSize(width: 300, height: 300)] {
            for count in 1...8 {
                for item in DIPPhotoCommentPlacement.layout(ids: ids(count), photo: size).items {
                    let f = frame(item)
                    XCTAssertGreaterThanOrEqual(f.minX, 16 - 0.001, "\(count) comments on \(size)")
                    XCTAssertGreaterThanOrEqual(f.minY, 16 - 0.001)
                    XCTAssertLessThanOrEqual(f.maxX, size.width - 16 + 0.001)
                    XCTAssertLessThanOrEqual(f.maxY, size.height - 16 + 0.001)
                }
            }
        }
    }

    func testBubblesNeverOverlapEachOtherOrThePill() {
        for size in [landscape, portrait] {
            for count in 1...12 {
                let result = DIPPhotoCommentPlacement.layout(ids: ids(count), photo: size)
                var frames = result.items.map(frame)
                if let pill = result.overflowCenter, result.overflowCount > 0 {
                    let s = DIPPhotoCommentPlacement.overflowPill
                    frames.append(CGRect(x: pill.x - s.width / 2, y: pill.y - s.height / 2, width: s.width, height: s.height))
                }
                for i in frames.indices {
                    for j in frames.indices where j > i {
                        XCTAssertFalse(frames[i].intersects(frames[j]), "overlap with \(count) comments on \(size)")
                    }
                }
            }
        }
    }

    func testTheCentralAreaStaysFreeOfBubbles() {
        for size in [landscape, portrait] {
            for count in 1...12 {
                for item in DIPPhotoCommentPlacement.layout(ids: ids(count), photo: size).items {
                    XCTAssertFalse(frame(item).intersects(centre(size)), "\(count) comments on \(size) cover the subject area")
                }
            }
        }
    }

    func testEveryCommentIsEitherShownOrCountedInThePill() {
        for size in [landscape, portrait] {
            for count in 1...12 {
                let result = DIPPhotoCommentPlacement.layout(ids: ids(count), photo: size)
                XCTAssertEqual(result.items.count + result.overflowCount, count, "\(count) on \(size)")
                XCTAssertLessThanOrEqual(result.items.count, DIPPhotoCommentPlacement.maxVisible)
                XCTAssertEqual(result.overflowCount > 0, result.overflowCenter != nil)
            }
        }
        XCTAssertEqual(DIPPhotoCommentPlacement.layout(ids: ids(3), photo: portrait).overflowCount, 0)
        XCTAssertGreaterThan(DIPPhotoCommentPlacement.layout(ids: ids(8), photo: landscape).overflowCount, 0)
        XCTAssertTrue(DIPPhotoCommentPlacement.layout(ids: [], photo: landscape).items.isEmpty)
    }

    func testTheNewestCommentsGetTheRoom() {
        let result = DIPPhotoCommentPlacement.layout(ids: ids(8), photo: landscape)
        XCTAssertTrue(result.items.map(\.id).contains("comment-7"))
        XCTAssertFalse(result.items.map(\.id).contains("comment-0"))
    }

    func testASingleCommentSitsInTheLowerThirdNotDeadCentre() {
        for size in [landscape, portrait] {
            let item = DIPPhotoCommentPlacement.layout(ids: ["only"], photo: size).items[0]
            XCTAssertGreaterThan(item.center.y, size.height * 2 / 3 - 0.5, "lower third on \(size)")
        }
    }

    func testPlacementIsDeterministic() {
        XCTAssertEqual(DIPPhotoCommentPlacement.layout(ids: ids(3), photo: landscape), DIPPhotoCommentPlacement.layout(ids: ids(3), photo: landscape))
        XCTAssertEqual(DIPPhotoCommentPlacement.stableHash("abc"), DIPPhotoCommentPlacement.stableHash("abc"))
        XCTAssertNotEqual(DIPPhotoCommentPlacement.stableHash("abc"), DIPPhotoCommentPlacement.stableHash("abd"))
    }

    func testReservedRectanglesAreAvoided() {
        let tag = CGRect(x: 80, y: 0, width: 200, height: 32)
        for count in 1...6 {
            let result = DIPPhotoCommentPlacement.layout(ids: ids(count), photo: landscape, reserved: [tag])
            for item in result.items { XCTAssertFalse(frame(item).intersects(tag), "\(count) comments") }
        }
    }

    func testDuplicateIdsCountOnceAndTinyPhotosNeverCrash() {
        XCTAssertEqual(DIPPhotoCommentPlacement.layout(ids: ["a", "a", "b"], photo: landscape).items.map(\.id).sorted(), ["a", "b"])
        let tiny = DIPPhotoCommentPlacement.layout(ids: ids(3), photo: CGSize(width: 120, height: 80))
        XCTAssertEqual(tiny.items.count + tiny.overflowCount, 3)
        XCTAssertTrue(DIPPhotoCommentPlacement.layout(ids: ids(2), photo: .zero).items.isEmpty)
    }
}
