#if canImport(SwiftUI)
    import SwiftUI

    extension RGBColor {
        public var swiftUIColor: Color { Color(.sRGB, red: red, green: green, blue: blue, opacity: 1) }
    }

    /// Reviewed light palette; this does not imply a dark theme has been designed.
    enum DIPComponentTheme {
        static let surface = DIPTokens.Color.surfaceDefault.swiftUIColor
        static let muted = DIPTokens.Color.surfaceMuted.swiftUIColor
        static let ink = DIPTokens.Color.textPrimary.swiftUIColor
        static let inverse = DIPTokens.Color.textInverse.swiftUIColor
        static let accent = DIPTokens.Color.actionPrimary.swiftUIColor
        static let onAccent = DIPTokens.Color.textOnAccent.swiftUIColor
    }
#endif
