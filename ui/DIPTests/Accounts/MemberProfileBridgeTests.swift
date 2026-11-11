import DIPAccounts
import DIPContracts
import DIPCore
import DIPMockData
import Foundation
import XCTest
@testable import DIP

/// Records profile writes; never publishes, like a membership listener that has not caught up yet.
@MainActor private final class RecordingAccountsRepository: AccountsRepository {
    var writes: [EditableProfile] = []
    func observations() -> AsyncStream<AccountObservation> { AsyncStream { _ in } }
    func signInWithGoogle() async throws {}
    func signOut() async throws {}
    func refreshIdentity() async throws {}
    func resolveMembership() async throws -> ResolveMembershipResponse { .init(contractVersion: 1, companyId: "company-1", role: "member") }
    func updateProfile(uid: String, _ profile: EditableProfile) async throws { writes.append(profile) }
}

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

    func testAccountProfilesCarryDetailsSoTheScreenShowsThem() throws {
        let context = try MembershipContext(uid: "member-1", profile: stored())
        let profile = MemberProfileBridge.profile(context: context, tags: [])
        XCTAssertTrue(profile.hasAccountDetails)
        XCTAssertEqual(profile.jobTitle, "Engineer")
        XCTAssertEqual(profile.availability, ["weekends", "unknown-option"])
        XCTAssertEqual(profile.travelRadiusMiles, 40)
        XCTAssertFalse(DIPMockFixtures.reference.profile.hasAccountDetails, "fixture screens stay unchanged")
    }

    func testDetailsCommandChangesOnlyProvidedFields() {
        let original = stored()
        let interestsOnly = MemberProfileBridge.edits(
            ProfileEdit(department: "Research", city: "Pittsburgh", interestTagIDs: []), preserving: original)
        XCTAssertEqual(interestsOnly.jobTitle, "Engineer")
        XCTAssertEqual(interestsOnly.availability, original.availability)
        XCTAssertEqual(interestsOnly.travelRadiusMiles, 40)
        let details = MemberProfileBridge.edits(
            ProfileEdit(department: "Research", city: "Pittsburgh", interestTagIDs: [],
                        jobTitle: "Lead", availability: ["weekday-lunch"], travelRadiusMiles: 10), preserving: original)
        XCTAssertEqual(details.jobTitle, "Lead")
        XCTAssertEqual(details.availability, ["weekday-lunch"])
        XCTAssertEqual(details.travelRadiusMiles, 10)
    }

    @MainActor
    func testBackToBackSavesBuildOnTheLatestSavedProfile() async throws {
        let context = try MembershipContext(uid: "member-1", profile: stored())
        let repository = RecordingAccountsRepository()
        let editor = ProfileEditor(context: context, repository: repository)
        try await MemberProfileBridge.save(
            ProfileEdit(department: "Research", city: "Pittsburgh", interestTagIDs: ["tag-fitness"],
                        jobTitle: "Lead", availability: ["weekends"], travelRadiusMiles: 10),
            editor: editor, uid: "member-1")
        // The listener has not delivered the first save; the interest picker saves next.
        try await MemberProfileBridge.save(
            ProfileEdit(department: "Research", city: "Pittsburgh", interestTagIDs: ["tag-social"]),
            editor: editor, uid: "member-1")
        XCTAssertEqual(repository.writes.count, 2)
        XCTAssertEqual(repository.writes.last?.jobTitle, "Lead", "first save must not be reverted")
        XCTAssertEqual(repository.writes.last?.travelRadiusMiles, 10)
        XCTAssertEqual(repository.writes.last?.availability, ["weekends"])
        XCTAssertEqual(repository.writes.last?.interestTagIds, ["tag-social"])
    }

    @MainActor
    func testSaveRefusesAnotherAccount() async throws {
        let context = try MembershipContext(uid: "member-1", profile: stored())
        let repository = RecordingAccountsRepository()
        let editor = ProfileEditor(context: context, repository: repository)
        do {
            try await MemberProfileBridge.save(ProfileEdit(department: "", city: "", interestTagIDs: []), editor: editor, uid: "member-2")
            XCTFail("saved for another account")
        } catch { XCTAssertEqual(error as? AccountsFailure, .unauthenticated) }
        XCTAssertTrue(repository.writes.isEmpty)
    }

    func testAvailabilityAndRadiusPresentation() {
        XCTAssertEqual(DIPProfileScreen.availabilityLabels(["weekends", "unknown-option", "weekday-mornings"]),
                       ["Weekday mornings", "Weekends"])
        XCTAssertEqual(DIPProfileScreen.orderedAvailability(["weekends", "unknown-option", "weekday-mornings"]),
                       ["weekday-mornings", "weekends", "unknown-option"], "unknown stored ids are kept")
        XCTAssertEqual(DIPProfileScreen.radiusChoices(including: 20), [5, 10, 20, 50, 100])
        XCTAssertEqual(DIPProfileScreen.radiusChoices(including: 35), [5, 10, 20, 35, 50, 100])
        XCTAssertEqual(DIPProfileScreen.radiusLabel(1), "Within 1 mile")
        XCTAssertEqual(DIPProfileScreen.radiusLabel(20), "Within 20 miles")
        XCTAssertEqual(DIPProfileScreen.radiusPhrase(1), "Events within 1 mile")
        XCTAssertEqual(DIPProfileScreen.radiusPhrase(20), "Events within 20 miles")
    }

    func testEmptyOrInvalidPortraitUsesNeutralAvatarInsteadOfAnotherPerson() throws {
        for photoURL in ["", "not-a-url", "file:///private/photo.jpg", "https:missing-host"] {
            let context = try MembershipContext(uid: "member-1", profile: stored(photoURL: photoURL))
            let profile = MemberProfileBridge.profile(context: context, tags: [])
            XCTAssertEqual(profile.photo, .generatedAvatar(userID: "member-1"))
            XCTAssertEqual(profile.avatar, .generatedAvatar(userID: "member-1"))
            XCTAssertEqual(profile.interestTagIDs, stored().interestTagIds)
        }
    }

    func testOAuthPhotoFillsMissingStoredPortrait() throws {
        let context = try XCTUnwrap(try? MembershipContext(uid: "u", profile: AppUser(
            id: "u", companyId: "c", displayName: "A", email: "a@x.com", photoURL: "", avatarId: "",
            department: "", jobTitle: "", city: "", role: "member", interestTagIds: [], travelRadiusMiles: 0,
            availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0, createdAt: Date())))
        let profile = MemberProfileBridge.profile(context: context, tags: [], oauthPhotoURL: "https://lh3.example.com/a=s400-c")
        XCTAssertEqual(profile.photo, .remote(URL(string: "https://lh3.example.com/a=s400-c")!))
        XCTAssertEqual(profile.avatar, .generatedAvatar(userID: "u"), "Small avatars never use the real photo")
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
