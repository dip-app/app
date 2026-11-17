#if canImport(SwiftUI)
    import SwiftUI
    import XCTest
    import CoreText
    @testable import DIPDesignSystem

    final class DIPAdaptiveSizingTests: XCTestCase {
        func testFixedSizesHoldUpToTheLargestNormalSize() {
            for size in DynamicTypeSize.allCases where !size.isAccessibilitySize {
                XCTAssertFalse(DIPAdaptiveSizing.isRelaxed(size), "\(size)")
                XCTAssertEqual(DIPAdaptiveSizing.lineLimit(1, size: size), 1, "\(size)")
            }
        }

        func testFixedSizesRelaxAtEveryAccessibilitySize() {
            for size in DynamicTypeSize.allCases where size.isAccessibilitySize {
                XCTAssertTrue(DIPAdaptiveSizing.isRelaxed(size), "\(size)")
                XCTAssertNil(DIPAdaptiveSizing.lineLimit(1, size: size), "\(size)")
            }
        }

        func testBoldVariantStepsUpAndKeepsHeaviestFaces() {
            XCTAssertEqual(DIPReferenceAssets.boldVariant(of: "Figtree-Regular"), "Figtree-Bold")
            XCTAssertEqual(DIPReferenceAssets.boldVariant(of: "Inter-Regular"), "Inter-Medium")
            XCTAssertEqual(DIPReferenceAssets.boldVariant(of: "Inter-Light"), "Inter-Regular")
            XCTAssertEqual(DIPReferenceAssets.boldVariant(of: "Figtree-Bold"), "Figtree-Bold")
            XCTAssertEqual(DIPReferenceAssets.boldVariant(of: "FjallaOne-Regular"), "FjallaOne-Regular")
        }

        func testEveryBoldVariantResolvesToABundledFace() {
            for name in ["Figtree-Regular", "Inter-Regular", "Inter-Light", "Inter-LightItalic"] {
                let variant = DIPReferenceAssets.boldVariant(of: name)
                _ = DIPReferenceAssets.font(variant, size: 14)
                let font = CTFontCreateWithName(variant as CFString, 14, nil)
                XCTAssertEqual(CTFontCopyPostScriptName(font) as String, variant, "No bundled face for \(variant)")
            }
        }
    }
#endif
