import DIPAccounts
import DIPContracts
import DIPCore
import DIPMockData
import Foundation
import XCTest
@testable import DIP

final class MemberProfileBridgeTests: XCTestCase {
    private func stored(photoURL: String = "https://example.invalid/portrait.jpg") -> AppUser {
        AppUser(
            id: "member-1", companyId: "company-1", displayName: "Jordan Lee",
            email: "jordan@example.invalid", photoURL: photoURL, avatarId: "avatar-01",
            department: "Research", jobTitle: "Engineer", city: "Pittsburgh",
            role: "admin", interestTagIds: ["tag-fitness", "retired-1", "retired-2"],
            travelRadiusMiles: 40, availability: ["weekends", "unknown-option"],
            friendIds: ["friend-1"], favoritePhotoIds: ["favorite-1"], pointsBalance: 700,
            createdAt: Date(timeIntervalSince1970: 123)
        )
    }

    func testMapsObservedIdentityAndStableCatalogWithoutFixtureMemories() throws {
        let context = try MembershipContext(uid: "member-1", profile: stored())
        let tags: [InterestTag] = [
            .init(id: "tag-social", name: "Social", icon: "🎉", sortOrder: 2),
            .init(id: "tag-fitness", name: "Movement", icon: "🏋️", sortOrder: 1),
            .init(id: "tag-fitness", name: "Duplicate ignored", icon: "", sortOrder: 0),
        ]
        let profile = MemberProfileBridge.profile(context: context, tags: tags)
        XCTAssertEqual(profile.id, context.uid)
        XCTAssertEqual(profile.displayName, "Jordan Lee")
        XCTAssertEqual(profile.department, "Research")
        XCTAssertEqual(profile.interestTagIDs, context.profile.interestTagIds)
        XCTAssertEqual(profile.interestCatalog.map(\.id), ["tag-fitness", "tag-social"])
        XCTAssertEqual(profile.selectedInterests.map(\.id), ["tag-fitness", "retired-1", "retired-2"])
        XCTAssertEqual(profile.selectedInterests.map(\.name), ["Movement", "Unavailable interest", "Unavailable interest"])
        XCTAssertTrue(profile.favoriteMemories.isEmpty, "A real account must not inherit fixture favorites")
        XCTAssertEqual(profile.photo, .remote(try XCTUnwrap(URL(string: context.profile.photoURL))))
    }

    func testHeaderHidesInterestPillsUntilTheCatalogCanNameThem() throws {
        let context = try MembershipContext(uid: "member-1", profile: stored())
        // Catalog loading or failed: no catalog yet, so nothing may be labelled unavailable.
        let unloaded = MemberProfileBridge.profile(context: context, tags: [])
        XCTAssertTrue(DIPProfileScreen.headerInterests(unloaded, catalogReady: false).isEmpty)
        XCTAssertEqual(unloaded.interestTagIDs, context.profile.interestTagIds, "stored selection is kept")
        // Loaded: known ids are named, ids missing from a loaded catalog really are unavailable.
        let loaded = MemberProfileBridge.profile(context: context, tags: [
            .init(id: "tag-fitness", name: "Movement", icon: "🏋️", sortOrder: 1),
        ])
        XCTAssertEqual(DIPProfileScreen.headerInterests(loaded, catalogReady: true).map(\.name),
                       ["Movement", "Unavailable interest", "Unavailable interest"])
    }

    func testEmptyOrInvalidPortraitUsesNeutralAvatarInsteadOfAnotherPerson() throws {
        for photoURL in ["", "not-a-url", "file:///private/photo.jpg", "https:missing-host"] {
            let context = try MembershipContext(uid: "member-1", profile: stored(photoURL: photoURL))
            let profile = MemberProfileBridge.profile(context: context, tags: [])
            XCTAssertEqual(profile.photo, .asset("AvatarTeal"))
            XCTAssertEqual(profile.avatar, .asset("AvatarTeal"))
            XCTAssertEqual(profile.interestTagIDs, stored().interestTagIds)
        }
    }

    func testProfileCommandPreservesOtherEditableAndServerOwnedValues() {
        let original = stored()
        let requested = ProfileEdit(department: "Design", city: "Boston", interestTagIDs: ["retired-1", "tag-social"])
        let command = MemberProfileBridge.edits(requested, preserving: original)
        XCTAssertEqual(command.department, "Design")
        XCTAssertEqual(command.city, "Boston")
        XCTAssertEqual(command.interestTagIds, ["retired-1", "tag-social"])
        XCTAssertEqual(command.photoURL, original.photoURL)
        XCTAssertEqual(command.avatarId, original.avatarId)
        XCTAssertEqual(command.jobTitle, original.jobTitle)
        XCTAssertEqual(command.travelRadiusMiles, original.travelRadiusMiles)
        XCTAssertEqual(command.availability, original.availability)
        let applied = command.applied(to: original)
        XCTAssertEqual(applied.displayName, original.displayName)
        XCTAssertEqual(applied.email, original.email)
        XCTAssertEqual(applied.companyId, original.companyId)
        XCTAssertEqual(applied.role, original.role)
        XCTAssertEqual(applied.pointsBalance, original.pointsBalance)
        XCTAssertEqual(applied.createdAt, original.createdAt)
        XCTAssertEqual(applied.favoritePhotoIds, original.favoritePhotoIds)
    }

    func testAccountSeedPreservesEventFixturesButReplacesProfileAndAvatar() throws {
        let context = try MembershipContext(uid: "member-1", profile: stored(photoURL: ""))
        let seed = MemberProfileBridge.seed(context: context)
        let reference = DIPMockFixtures.reference
        XCTAssertEqual(seed.profile.id, context.uid)
        XCTAssertEqual(seed.home.profileAvatar, seed.profile.avatar)
        XCTAssertTrue(seed.profile.favoriteMemories.isEmpty)
        XCTAssertEqual(seed.home.events, reference.home.events)
        XCTAssertEqual(seed.eventDetails, reference.eventDetails)
        XCTAssertEqual(seed.albums, reference.albums)
    }
}
