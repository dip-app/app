import Foundation

/// The app-assigned avatar (a Crew character on a dark disc) for a user id. A pure, stable
/// mapping: the same id gives the same avatar on every launch and device. Shape, expression and
/// colour are drawn from independent parts of a 64-bit FNV-1a hash (with a final avalanche mix),
/// never from Swift's per-process randomised `hashValue`.
///
/// Colours are brand tokens only and every one has strong contrast against the dark ink used for
/// the disc and the face features (see `contrastRatio`).
public struct DIPAvatarStyle: Equatable, Hashable, Sendable {
    public enum Figure: Int, CaseIterable, Sendable { case round, square, pill }
    public enum Mood: Int, CaseIterable, Sendable { case happy, calm, wink }
    public enum Palette: Int, CaseIterable, Sendable {
        case periwinkle, yellow, pink, orchid, grey, white

        public var token: RGBColor {
            switch self {
            case .periwinkle: DIPTokens.Color.actionPrimary
            case .yellow: DIPTokens.Color.notificationAccent
            case .pink: DIPTokens.Color.eventsAccent
            case .orchid: DIPTokens.Color.challengeAccent
            case .grey: DIPTokens.Color.surfaceMuted
            case .white: DIPTokens.Color.surfaceDefault
            }
        }
    }

    public let figure: Figure
    public let mood: Mood
    public let palette: Palette

    public init(figure: Figure, mood: Mood, palette: Palette) {
        self.figure = figure
        self.mood = mood
        self.palette = palette
    }

    /// Every distinct avatar the app can assign.
    public static var combinationCount: Int { Figure.allCases.count * Mood.allCases.count * Palette.allCases.count }

    /// Stable assignment for a user id. An empty id still maps to a valid avatar.
    public static func assigned(forUserID id: String) -> DIPAvatarStyle {
        var value = mixed(fnv1a64(id))
        func take(_ count: Int) -> Int {
            let part = Int(value % UInt64(count))
            value /= UInt64(count)
            return part
        }
        let figure = Figure(rawValue: take(Figure.allCases.count)) ?? .round
        let mood = Mood(rawValue: take(Mood.allCases.count)) ?? .happy
        let palette = Palette(rawValue: take(Palette.allCases.count)) ?? .periwinkle
        return DIPAvatarStyle(figure: figure, mood: mood, palette: palette)
    }

    /// WCAG contrast of the character fill against the ink used for the disc and features.
    public var contrastRatio: Double {
        Self.contrast(palette.token, DIPTokens.Color.textPrimary)
    }

    // MARK: Hashing

    static func fnv1a64(_ text: String) -> UInt64 {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01b3
        }
        return hash
    }

    /// SplitMix64 finaliser: spreads FNV's weak low bits so near-identical ids diverge.
    static func mixed(_ input: UInt64) -> UInt64 {
        var z = input &+ 0x9e37_79b9_7f4a_7c15
        z = (z ^ (z >> 30)) &* 0xbf58_476d_1ce4_e5b9
        z = (z ^ (z >> 27)) &* 0x94d0_49bb_1331_11eb
        return z ^ (z >> 31)
    }

    static func contrast(_ a: RGBColor, _ b: RGBColor) -> Double {
        func luminance(_ color: RGBColor) -> Double {
            func channel(_ value: Double) -> Double {
                value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
            }
            return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue)
        }
        let (high, low) = (max(luminance(a), luminance(b)), min(luminance(a), luminance(b)))
        return (high + 0.05) / (low + 0.05)
    }
}

#if canImport(SwiftUI)
    import SwiftUI

    extension DIPCrewFace {
        /// A Crew character in the avatar style assigned to `style`.
        public init(style: DIPAvatarStyle) {
            self.init(
                fill: style.palette.token.swiftUIColor,
                figure: style.figure == .round ? .round : (style.figure == .square ? .square : .pill),
                mood: style.mood == .happy ? .happy : (style.mood == .calm ? .calm : .wink))
        }
    }

    /// The app-assigned avatar for a user id: the same character everywhere it is shown.
    public struct DIPAssignedAvatar: View {
        private let style: DIPAvatarStyle
        private let size: CGFloat

        public init(userID: String, size: CGFloat = 40) {
            self.style = .assigned(forUserID: userID)
            self.size = size
        }

        public var body: some View {
            DIPCrewFace(style: style).frame(width: size, height: size)
        }
    }
#endif
