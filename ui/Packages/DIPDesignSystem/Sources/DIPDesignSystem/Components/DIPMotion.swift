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

        /// The icon circle on an action state pops in with a little overshoot (opacity only with Reduce Motion).
        public static func affordance(reduceMotion: Bool = false) -> Animation {
            reduceMotion
                ? .linear(duration: reducedMotionDuration)
                : .spring(response: 0.45, dampingFraction: 0.68)
        }

        /// A content swap driven by a filter toggle: short ease, plain cross-fade (no slide) with Reduce Motion.
        public static let filterDuration = 0.25
        public static func filter(reduceMotion: Bool = false) -> Animation {
            reduceMotion
                ? .linear(duration: reducedMotionDuration)
                : .easeInOut(duration: filterDuration)
        }

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
        /// Optional design-system image shown in a white circle at the trailing edge of the action.
        public let icon: String?
        /// Work in flight: `DIPProgressIndicator` (a wheel of member faces by default) turns in the trailing white
        /// icon circle; under Reduce Motion one still face, no loop. Presentation only; activation is the host's call.
        public let showsProgress: Bool
        /// Whether pressing the action changes something (`commit`: Join, Save, Send; felt as a slight haptic)
        /// or only moves somewhere (`navigate`: open chat, view album; silent). See `DIPHaptics`.
        public let kind: Kind

        public enum Kind: Equatable, Sendable { case navigate, commit }

        public init(
            title: String, style: Style = .standard, identifier: String, value: String? = nil,
            icon: String? = nil, showsProgress: Bool = false, kind: Kind = .navigate
        ) {
            self.kind = kind
            self.title = title
            self.style = style
            self.identifier = identifier
            self.value = value
            self.icon = icon
            self.showsProgress = showsProgress
        }
    }
#endif
