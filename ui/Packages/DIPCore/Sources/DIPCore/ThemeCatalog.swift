import Foundation

/// Accent of a weekly theme, named by its semantic design token. DIPCore has no UI dependency,
/// so the app resolves the colour (`challenge` -> `challengeAccent`, `neutral` -> `surfaceMuted`).
public enum DIPThemeAccent: Equatable, Sendable {
    /// `challengeAccent` (#FB72E4). The title is ink (white measures 2.43:1 on it).
    case challenge
    /// `surfaceMuted` with a dark title: the fallback for a theme this client does not know.
    case neutral
    /// A catalog theme's own background colour (`#RRGGBB`), taken from the theme art set so the card blends with its illustration.
    case themed(hex: String)
}

extension DIPThemeAccent {
    /// The brand purple. Owner rule: text on it is always white, even though ink would measure higher.
    public static let brandPurpleHex = "#7B88FA"
    /// `challengeAccent` and `ink`, mirrored here because DIPCore cannot see the design tokens.
    public static let challengeHex = "#FB72E4"
    static let inkHex = "#1E212B"

    /// Whether the card title is white (true) or ink (false) on this accent: whichever has the higher WCAG
    /// contrast, except white stays on the brand purple (locked owner decision).
    public var prefersLightTitle: Bool {
        switch self {
        case .neutral: false
        case .challenge: Self.prefersLightTitle(onHex: Self.challengeHex)
        case .themed(let hex): Self.prefersLightTitle(onHex: hex)
        }
    }

    public static func prefersLightTitle(onHex hex: String) -> Bool {
        if hex.uppercased() == brandPurpleHex { return true }
        guard let background = relativeLuminance(hex: hex), let ink = relativeLuminance(hex: inkHex) else { return false }
        return contrast(1.0, background) > contrast(ink, background)
    }

    /// WCAG contrast ratio of the title on this accent (white or ink per `prefersLightTitle`).
    public static func titleContrast(onHex hex: String) -> Double? {
        guard let background = relativeLuminance(hex: hex), let ink = relativeLuminance(hex: inkHex) else { return nil }
        return contrast(prefersLightTitle(onHex: hex) ? 1.0 : ink, background)
    }

    private static func contrast(_ a: Double, _ b: Double) -> Double { (max(a, b) + 0.05) / (min(a, b) + 0.05) }

    static func relativeLuminance(hex: String) -> Double? {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        func lin(_ shift: UInt32) -> Double {
            let c = Double((value >> shift) & 0xFF) / 255
            return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * lin(16) + 0.7152 * lin(8) + 0.0722 * lin(0)
    }
}

/// One bundled weekly-theme presentation. The stored challenge only carries
/// `coverImageURL = catalog://theme/<key>`; artwork and colour live in each client.
public struct DIPTheme: Equatable, Sendable {
    public let key: String
    public let displayName: String
    /// Bundled illustration asset; nil for the neutral fallback (title only, never a photo).
    public let illustration: MediaReference?
    public let accent: DIPThemeAccent
    /// Suggestions for organizers; members only see the stored goal unit.
    public let goalUnitSuggestions: [String]
    /// False for the fallback produced for an unknown or malformed key.
    public let isKnown: Bool
}

/// Client-side weekly-theme catalog (spec section 2). Mirrors the admin `src/lib/themes.ts`
/// and the server's APPROVED_THEME_URLS. Unknown keys resolve to a neutral fallback so a
/// future theme never crashes or mis-renders an older client.
public enum DIPThemeCatalog {
    public static let catalogPrefix = "catalog://theme/"

    /// Reuses the existing Home `Mascot` artwork (blue character lifting a barbell).
    public static let fitness = DIPTheme(
        key: "fitness", displayName: "Fitness", illustration: .asset("Mascot"), accent: .challenge,
        goalUnitSuggestions: ["workouts", "classes", "walks", "active minutes"], isKnown: true)

    public static let outdoors = DIPTheme(
        key: "outdoors", displayName: "Outdoors", illustration: .asset("MascotOutdoors"), accent: .themed(hex: "#6BE5D0"),
        goalUnitSuggestions: ["outings", "hours"], isKnown: true)
    public static let food = DIPTheme(
        key: "food", displayName: "Food & Drink", illustration: .asset("MascotFood"), accent: .themed(hex: "#FF7C73"),
        goalUnitSuggestions: ["gatherings", "meals", "tastings"], isKnown: true)
    public static let arts = DIPTheme(
        key: "arts", displayName: "Arts & Crafts", illustration: .asset("MascotArts"), accent: .themed(hex: "#7B88FA"),
        goalUnitSuggestions: ["creations", "projects", "sessions"], isKnown: true)
    public static let games = DIPTheme(
        key: "games", displayName: "Games", illustration: .asset("MascotGames"), accent: .themed(hex: "#FFCC3E"),
        goalUnitSuggestions: ["games", "sessions", "rounds"], isKnown: true)
    public static let music = DIPTheme(
        key: "music", displayName: "Music", illustration: .asset("MascotMusic"), accent: .themed(hex: "#66D9FF"),
        goalUnitSuggestions: ["songs", "events", "sessions"], isKnown: true)
    public static let learning = DIPTheme(
        key: "learning", displayName: "Learning", illustration: .asset("MascotLearning"), accent: .themed(hex: "#6BFF9B"),
        goalUnitSuggestions: ["lessons", "sessions", "chapters"], isKnown: true)
    public static let volunteering = DIPTheme(
        key: "volunteering", displayName: "Volunteering", illustration: .asset("MascotVolunteering"), accent: .themed(hex: "#1E212B"),
        goalUnitSuggestions: ["shifts", "hours", "events"], isKnown: true)
    public static let wellness = DIPTheme(
        key: "wellness", displayName: "Wellness", illustration: .asset("MascotWellness"), accent: .themed(hex: "#FF7C73"),
        goalUnitSuggestions: ["sessions", "minutes", "breaks"], isKnown: true)

    /// Approved themes, in organizer picker order. Copy and defaults: docs/design/theme-catalog.md.
    public static let themes: [DIPTheme] = [fitness, outdoors, food, arts, games, music, learning, volunteering, wellness]

    public static func catalogURL(for key: String) -> String { catalogPrefix + key }

    /// The theme key from a `catalog://theme/<key>` URL, or nil for any other value.
    public static func key(coverImageURL: String) -> String? {
        guard coverImageURL.hasPrefix(catalogPrefix) else { return nil }
        let key = String(coverImageURL.dropFirst(catalogPrefix.count))
        guard !key.isEmpty, key.count <= 64, key.range(of: "^[a-z0-9-]+$", options: .regularExpression) != nil else { return nil }
        return key
    }

    public static func theme(key: String) -> DIPTheme {
        themes.first { $0.key == key } ?? fallback(key: key)
    }

    /// Resolves a stored cover URL. Anything that is not an approved catalog URL (an https photo,
    /// a legacy value, an unknown key) gets the neutral fallback: no illustration, gray accent.
    public static func theme(coverImageURL: String) -> DIPTheme {
        guard let key = key(coverImageURL: coverImageURL) else { return fallback(key: "") }
        return theme(key: key)
    }

    public static func fallback(key: String) -> DIPTheme {
        DIPTheme(key: key, displayName: "Weekly theme", illustration: nil, accent: .neutral,
                 goalUnitSuggestions: [], isKnown: false)
    }
}
