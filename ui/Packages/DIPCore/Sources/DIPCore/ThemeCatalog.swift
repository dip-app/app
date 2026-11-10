import Foundation

/// Accent of a weekly theme, named by its semantic design token. DIPCore has no UI dependency,
/// so the app resolves the colour (`challenge` -> `challengeAccent`, `neutral` -> `surfaceMuted`).
public enum DIPThemeAccent: String, Equatable, Sendable {
    /// `challengeAccent` (#FB72E4) with a white display title, as in the Home reference.
    case challenge
    /// `surfaceMuted` with a dark title: the fallback for a theme this client does not know.
    case neutral
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

    /// Approved themes, in organizer picker order.
    public static let themes: [DIPTheme] = [fitness]

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
