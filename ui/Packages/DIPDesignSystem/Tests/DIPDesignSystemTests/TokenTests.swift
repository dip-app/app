import XCTest
@testable import DIPDesignSystem

final class TokenTests: XCTestCase {
    func testSemanticTextContrast() {
        let pairs: [(DIPDesignSystem.RGBColor, DIPDesignSystem.RGBColor)] = [
            (DIPTokens.Color.textPrimary, DIPTokens.Color.surfaceDefault),
            (DIPTokens.Color.textPrimary, DIPTokens.Color.surfaceMuted),
            (DIPTokens.Color.textInverse, DIPTokens.Color.navigationBackground)
        ]
        for (foreground, background) in pairs {
            XCTAssertGreaterThanOrEqual(contrast(foreground, background), 4.5)
        }
    }

    /// Owner rule: text on the periwinkle fill is always white. White on #7B88FA is about 3.2:1, which meets the 3:1
    /// large-text minimum (buttons and pills use 18 pt and larger); the owner accepted this trade-off.
    func testTextOnAccentIsWhiteAndMeetsLargeTextContrast() {
        XCTAssertEqual(DIPTokens.Color.textOnAccent.hex, "#FFFFFF")
        XCTAssertGreaterThanOrEqual(contrast(DIPTokens.Color.textOnAccent, DIPTokens.Color.actionPrimary), 3.0)
    }

    func testColorRepresentationPreservesReference() {
        XCTAssertEqual(DIPTokens.Color.actionPrimary.hex, "#7B88FA")
        XCTAssertEqual(DIPTokens.Color.actionPrimary.red, 123.0 / 255.0, accuracy: 0.0001)
        XCTAssertEqual(DIPTokens.Color.actionPrimary.green, 136.0 / 255.0, accuracy: 0.0001)
        XCTAssertEqual(DIPTokens.Color.actionPrimary.blue, 250.0 / 255.0, accuracy: 0.0001)
    }

    func testInteractionAndLayoutFoundations() {
        XCTAssertGreaterThanOrEqual(DIPTokens.Spacing.minimumTouchTarget, 44)
        XCTAssertEqual(DIPTokens.Spacing.contentInset, 20)
        XCTAssertGreaterThan(DIPTokens.Radius.navigation, DIPTokens.Radius.card)
        XCTAssertGreaterThanOrEqual(DIPTokens.Typography.body.referenceSize, 17)
        XCTAssertEqual(DIPTokens.supportedModes, ["light"])
        XCTAssertEqual(DIPTokens.darkModeStatus, "pending-design-review")
    }

    private func contrast(_ a: DIPDesignSystem.RGBColor, _ b: DIPDesignSystem.RGBColor) -> Double {
        func luminance(_ color: DIPDesignSystem.RGBColor) -> Double {
            func linear(_ value: Double) -> Double {
                value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
            }
            return 0.2126 * linear(color.red) + 0.7152 * linear(color.green) + 0.0722 * linear(color.blue)
        }
        let x = luminance(a), y = luminance(b)
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }
}
