import XCTest

@testable import DIPDesignSystem

final class DIPAvatarStyleTests: XCTestCase {
    func testSameUserIDGivesSameAvatarAndKnownValuesAreStable() {
        XCTAssertEqual(DIPAvatarStyle.assigned(forUserID: "uid-123"), DIPAvatarStyle.assigned(forUserID: "uid-123"))
        // Pinned so a change to the hash (which would reshuffle every user's avatar) is deliberate.
        XCTAssertEqual(DIPAvatarStyle.fnv1a64(""), 0xcbf2_9ce4_8422_2325)
        XCTAssertEqual(DIPAvatarStyle.fnv1a64("a"), 0xaf63_dc4c_8601_ec8c)
        XCTAssertEqual(
            DIPAvatarStyle.assigned(forUserID: "pNVpp3OusRvgfUV8hv5R"),
            DIPAvatarStyle.assigned(forUserID: "pNVpp3OusRvgfUV8hv5R"))
    }

    func testEmptyIDStillMapsToAValidAvatar() {
        let style = DIPAvatarStyle.assigned(forUserID: "")
        XCTAssertTrue(DIPAvatarStyle.Figure.allCases.contains(style.figure))
        XCTAssertTrue(DIPAvatarStyle.Palette.allCases.contains(style.palette))
    }

    func testDistributionCoversEveryShapeMoodAndColour() {
        var combos = Set<DIPAvatarStyle>()
        for index in 0..<20_000 { combos.insert(.assigned(forUserID: "user-\(index)")) }
        XCTAssertEqual(Set(combos.map(\.figure)).count, DIPAvatarStyle.Figure.allCases.count)
        XCTAssertEqual(Set(combos.map(\.mood)).count, DIPAvatarStyle.Mood.allCases.count)
        XCTAssertEqual(Set(combos.map(\.palette)).count, DIPAvatarStyle.Palette.allCases.count)
        XCTAssertEqual(combos.count, DIPAvatarStyle.combinationCount, "every combination is reachable")
    }

    func testAssignmentIsRoughlyEven() {
        var counts: [DIPAvatarStyle.Palette: Int] = [:]
        let total = 12_000
        for index in 0..<total { counts[DIPAvatarStyle.assigned(forUserID: "member-\(index)").palette, default: 0] += 1 }
        let expected = Double(total) / Double(DIPAvatarStyle.Palette.allCases.count)
        for palette in DIPAvatarStyle.Palette.allCases {
            XCTAssertEqual(Double(counts[palette] ?? 0), expected, accuracy: expected * 0.15, "\(palette)")
        }
    }

    func testNeighbouringIDsDoNotShareAnAvatar() {
        let styles = (0..<50).map { DIPAvatarStyle.assigned(forUserID: "uid\($0)") }
        XCTAssertGreaterThan(Set(styles).count, 20)
    }

    func testEveryPaletteHasStrongContrastAgainstTheInk() {
        for palette in DIPAvatarStyle.Palette.allCases {
            let ratio = DIPAvatarStyle(figure: .round, mood: .happy, palette: palette).contrastRatio
            XCTAssertGreaterThanOrEqual(ratio, 4.5, "\(palette) contrast \(ratio)")
        }
    }
}
