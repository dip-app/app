import DIPCore
import XCTest

final class EventCoverTests: XCTestCase {
    func testCatalogURLSelectsItsCategoryRegardlessOfTags() {
        XCTAssertEqual(DIPEventCover.resolve(coverImageURL: "catalog://default/hiking", tagIds: ["tag-cooking"]), .hiking)
        XCTAssertEqual(DIPEventCover.media(coverImageURL: "catalog://default/games", tagIds: []), .asset("cover_games"))
    }

    func testEveryCategoryRoundTripsThroughItsCatalogURL() {
        for cover in DIPEventCover.allCases {
            XCTAssertEqual(DIPEventCover(catalogURL: cover.catalogURL), cover)
            XCTAssertEqual(cover.assetName, "cover_\(cover.rawValue)")
        }
    }

    func testCatalogMatchesServerApprovedURLs() {
        // Mirrors APPROVED_COVER_URLS in gcp/functions/src/modules/organizer/domain/eventDraft.ts.
        let approved: Set<String> = ["catalog://default/fitness", "catalog://default/outdoors",
                                     "catalog://default/hiking", "catalog://default/games", "catalog://default/cooking"]
        XCTAssertEqual(Set(DIPEventCover.allCases.map(\.catalogURL)), approved)
    }

    func testUnknownOrForeignURLsFallBackToFirstKnownTag() {
        XCTAssertEqual(DIPEventCover.resolve(coverImageURL: "catalog://default/unknown", tagIds: ["tag-x", "tag-cooking", "tag-fitness"]), .cooking)
        XCTAssertEqual(DIPEventCover.resolve(coverImageURL: "https://example.com/a.jpg", tagIds: ["tag-social"]), .games)
        XCTAssertEqual(DIPEventCover.resolve(coverImageURL: "catalog://default/", tagIds: ["tag-outdoors"]), .outdoors)
        XCTAssertNil(DIPEventCover(catalogURL: "catalog://other/fitness"))
    }

    func testNoURLAndNoKnownTagUsesFixedFallback() {
        XCTAssertEqual(DIPEventCover.resolve(coverImageURL: nil, tagIds: []), DIPEventCover.fallback)
        XCTAssertEqual(DIPEventCover.resolve(coverImageURL: "", tagIds: ["tag-unknown"]), DIPEventCover.fallback)
    }

    func testFirstAlbumPhotoOverridesTheCatalogCoverOnlyWhenPresent() {
        let photo = Data([1, 2, 3])
        XCTAssertEqual(DIPEventCover.media(coverImageURL: "catalog://default/games", tagIds: [], photo: photo), .data(photo))
        XCTAssertEqual(DIPEventCover.media(coverImageURL: "catalog://default/games", tagIds: [], photo: nil), .asset("cover_games"))
        XCTAssertEqual(DIPEventCover.media(coverImageURL: "catalog://default/games", tagIds: [], photo: Data()), .asset("cover_games"))
    }

    func testLibraryCoverResolvesToHostedImageWithBundledFallback() {
        let url = URL(string: "https://letsdip.work/img/covers/theme-outdoors.webp")!
        XCTAssertEqual(DIPEventCover.media(coverImageURL: "catalog://cover/theme-outdoors", tagIds: ["tag-cooking"]),
                       .remoteCover(url, fallbackAsset: "cover_cooking"))
        XCTAssertEqual(DIPEventCover.media(coverImageURL: "catalog://cover/a1", tagIds: [], photo: nil),
                       .remoteCover(URL(string: "https://letsdip.work/img/covers/a1.webp")!, fallbackAsset: "cover_outdoors"))
        XCTAssertEqual(DIPEventCover.media(coverImageURL: "catalog://cover/theme-outdoors", tagIds: [], photo: Data([1])), .data(Data([1])))
    }

    func testInvalidLibraryKeysFallBack() {
        let bad = ["catalog://cover/", "catalog://cover/Theme-Outdoors", "catalog://cover/a/b", "catalog://cover/../x",
                   "catalog://cover/..", "catalog://cover/-a", "catalog://cover/a-", "catalog://cover/a--b", "catalog://cover/a_b",
                   "catalog://cover/a.webp", "catalog://cover/" + String(repeating: "a", count: 65), "catalog://cover/a%2Fb", "catalog://cover/a b"]
        for value in bad {
            XCTAssertNil(DIPEventCover.libraryImageURL(value), value)
            XCTAssertEqual(DIPEventCover.media(coverImageURL: value, tagIds: ["tag-games"]), .asset("cover_games"), value)
        }
        XCTAssertNotNil(DIPEventCover.libraryImageURL("catalog://cover/" + String(repeating: "a", count: 64)))
    }

    func testDynamicPixabayCoversResolveToTheDynamicPath() {
        XCTAssertEqual(DIPEventCover.libraryImageURL("catalog://cover/pixabay-1234567"),
                       URL(string: "https://letsdip.work/img/covers-dyn/pixabay-1234567.webp"))
        XCTAssertEqual(DIPEventCover.media(coverImageURL: "catalog://cover/pixabay-9", tagIds: ["tag-games"]),
                       .remoteCover(URL(string: "https://letsdip.work/img/covers-dyn/pixabay-9.webp")!, fallbackAsset: "cover_games"))
        XCTAssertNotNil(DIPEventCover.libraryImageURL("catalog://cover/pixabay-999999999999"))
        let bad = ["catalog://cover/pixabay-", "catalog://cover/pixabay-0", "catalog://cover/pixabay-01", "catalog://cover/pixabay-1234567890123",
                   "catalog://cover/pixabay-1a", "catalog://cover/pixabay-1/../x", "catalog://cover/pixabay-1/x", "catalog://cover/Pixabay-1",
                   "catalog://cover/pixabay-1.webp", "catalog://cover/pixabay-1-2", "catalog://cover/pixabay-\u{0661}"]
        for value in bad { XCTAssertNil(DIPEventCover.libraryImageURL(value), value) }
        XCTAssertEqual(DIPEventCover.libraryImageURL("catalog://cover/theme-outdoors")?.absoluteString, "https://letsdip.work/img/covers/theme-outdoors.webp")
    }

    func testLegacyURLsStayBundled() {
        XCTAssertEqual(DIPEventCover.media(coverImageURL: "catalog://default/fitness", tagIds: []), .asset("cover_fitness"))
    }
}
