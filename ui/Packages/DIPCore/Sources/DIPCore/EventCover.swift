import Foundation

/// V1 category-based default event imagery (V1-08). V1 has no uploads: events store one of the
/// approved `catalog://default/<category>` URLs (validated by createEventV1/updateEventV1, see
/// gcp/functions/src/modules/organizer/domain/eventDraft.ts), and the app shows the bundled image
/// for that category. Unknown or legacy values fall back to the event's tags, then a fixed default,
/// so a card never renders an empty image.
public enum DIPEventCover: String, CaseIterable, Sendable {
    case fitness, outdoors, hiking, games, cooking

    public static let catalogPrefix = "catalog://default/"
    public static let fallback: DIPEventCover = .outdoors

    /// Bundled asset name in DIPDesignSystem's EventCovers.xcassets.
    public var assetName: String { "cover_\(rawValue)" }
    public var catalogURL: String { Self.catalogPrefix + rawValue }

    /// Tag IDs (`tags/{tagId}`) that imply a category when the cover URL is not a catalog entry.
    static let tagCategories: [String: DIPEventCover] = [
        "tag-fitness": .fitness, "tag-energetic": .fitness, "tag-hype": .fitness, "tag-wellness": .fitness,
        "tag-outdoors": .outdoors, "tag-hiking": .hiking,
        "tag-games": .games, "tag-social": .games, "tag-chill": .games,
        "tag-cooking": .cooking, "tag-food": .cooking,
    ]

    public init?(catalogURL: String) {
        guard catalogURL.hasPrefix(Self.catalogPrefix) else { return nil }
        self.init(rawValue: String(catalogURL.dropFirst(Self.catalogPrefix.count)))
    }

    /// The stored catalog URL wins; otherwise the first tag with a known category; otherwise the fallback.
    public static func resolve(coverImageURL: String?, tagIds: [String]) -> DIPEventCover {
        if let url = coverImageURL, let cover = DIPEventCover(catalogURL: url) { return cover }
        return tagIds.lazy.compactMap { tagCategories[$0] }.first ?? fallback
    }

    /// Cover library entries (`catalog://cover/<key>`) are hosted images, not bundled ones.
    public static let libraryPrefix = "catalog://cover/"
    public static let libraryBaseURL = "https://letsdip.work/img/covers/"

    /// The hosted full-size image for a valid library URL (key `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 64 chars), else nil.
    public static func libraryImageURL(_ coverImageURL: String?) -> URL? {
        guard let value = coverImageURL, value.hasPrefix(libraryPrefix) else { return nil }
        let key = String(value.dropFirst(libraryPrefix.count))
        guard !key.isEmpty, key.utf8.count <= 64 else { return nil }
        for part in key.split(separator: "-", omittingEmptySubsequences: false) {
            guard !part.isEmpty, part.utf8.allSatisfy({ ($0 >= 97 && $0 <= 122) || ($0 >= 48 && $0 <= 57) }) else { return nil }
        }
        return URL(string: libraryBaseURL + key + ".webp")
    }

    /// Library covers load remotely with the tag-based bundled cover as placeholder/fallback; everything else is bundled.
    public static func media(coverImageURL: String?, tagIds: [String]) -> MediaReference {
        let bundled = resolve(coverImageURL: coverImageURL, tagIds: tagIds).assetName
        if let url = libraryImageURL(coverImageURL) { return .remoteCover(url, fallbackAsset: bundled) }
        return .asset(bundled)
    }

    /// A real per-event cover (the event's first album photo, already downloaded) wins over the catalog image;
    /// without one, or with empty bytes, the catalog cover applies so a card never renders blank.
    public static func media(coverImageURL: String?, tagIds: [String], photo: Data?) -> MediaReference {
        if let photo, !photo.isEmpty { return .data(photo) }
        return media(coverImageURL: coverImageURL, tagIds: tagIds)
    }
}
