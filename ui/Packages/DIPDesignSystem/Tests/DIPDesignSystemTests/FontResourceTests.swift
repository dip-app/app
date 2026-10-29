#if canImport(SwiftUI)
    import XCTest
    import CoreText
    @testable import DIPDesignSystem

    final class FontResourceTests: XCTestCase {
        func testReferenceFontsResolveFromBundledFiles() {
            for (name, family) in [
                ("Figtree-Regular", "Figtree"),
                ("FjallaOne-Regular", "Fjalla One"),
                ("Inter-Regular", "Inter"),
                ("Inter-LightItalic", "Inter"),
                ("Inter-Medium", "Inter"),
            ] {
                _ = DIPReferenceAssets.font(name, size: 14)
                let font = CTFontCreateWithName(name as CFString, 14, nil)
                XCTAssertEqual(CTFontCopyPostScriptName(font) as String, name, "Silent fallback for \(name)")
                XCTAssertEqual(CTFontCopyFamilyName(font) as String, family)
            }
        }
    }
#endif
