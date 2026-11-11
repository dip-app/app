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
}
