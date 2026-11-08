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

    public static func media(coverImageURL: String?, tagIds: [String]) -> MediaReference {
        .asset(resolve(coverImageURL: coverImageURL, tagIds: tagIds).assetName)
    }
}
