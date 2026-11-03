#if canImport(SwiftUI)
    import SwiftUI

    /// Shared prototype timing. Interactive Figma transitions use 0.3s EASE_OUT.
    /// The Active/Memories SLOW preset exports its 0.625061s duration but no spring coefficients.
    public enum DIPMotion {
        public static let navigationDuration = 0.3
        public static let sectionDuration = 0.6250614523887634
        public static let reducedMotionDuration = 0.12

        public static func navigation(reduceMotion: Bool = false) -> Animation {
            reduceMotion
                ? .linear(duration: reducedMotionDuration)
                : .easeOut(duration: navigationDuration)
        }

        /// The navigation marker settles like a physical selector rather than easing linearly.
        public static let marker: Animation = .spring(response: 0.38, dampingFraction: 0.82)

        public static func section(reduceMotion: Bool = false) -> Animation {
            reduceMotion
                ? .linear(duration: reducedMotionDuration)
                : .smooth(duration: sectionDuration, extraBounce: 0)
        }
    }

    /// An overlay state of the persistent navigation component, not a second navigation bar.
    public struct DIPBottomBarAction: Equatable {
        public enum Style: Equatable {
            case standard, accent, complete
        }

        public let title: String
        public let style: Style
        public let identifier: String
        public let value: String?

        public init(
            title: String, style: Style = .standard, identifier: String, value: String? = nil
        ) {
            self.title = title
            self.style = style
            self.identifier = identifier
            self.value = value
        }
    }
#endif
