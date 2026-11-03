import Testing
import Foundation
import DIPContracts
@testable import DIPAccounts

@MainActor private final class ProfileFakeRepository: AccountsRepository, InterestCatalogRepository {
    var saved: [(uid: String, profile: EditableProfile)] = []
    var saveFailure: AccountsFailure?
    var tags: [InterestTag] = []
    var tagFailure: AccountsFailure?
    var tagLoads = 0
    func observations() -> AsyncStream<AccountObservation> { AsyncStream { _ in } }
    func signInWithGoogle() async throws {}
    func signOut() async throws {}
    func refreshIdentity() async throws {}
    func resolveMembership() async throws -> ResolveMembershipResponse { .init(contractVersion: 1, companyId: "company", role: "member") }
    func updateProfile(uid: String, _ profile: EditableProfile) async throws {
        if let saveFailure { throw saveFailure }
        saved.append((uid, profile))
    }
    func interestTags() async throws -> [InterestTag] {
        tagLoads += 1
        if let tagFailure { throw tagFailure }
        return tags
    }
}

private func member(_ uid: String = "one", department: String = "Design", interests: [String] = ["tag-social"]) -> MembershipContext {
    let profile = AppUser(id: uid, companyId: "company", displayName: "Jordan Lee", email: "jordan@example.test",
                          photoURL: "", avatarId: "avatar-01", department: department, jobTitle: "Designer",
                          city: "Pittsburgh, PA", role: "member", interestTagIds: interests, travelRadiusMiles: 20,
                          availability: ["weekends"], friendIds: [], favoritePhotoIds: [], pointsBalance: 300,
                          createdAt: Date(timeIntervalSince1970: 0))
    return try! MembershipContext(uid: uid, profile: profile)
}

@Test @MainActor func editorStartsCleanFromTheStoredProfile() {
    let editor = ProfileEditor(context: member(), repository: ProfileFakeRepository())
    #expect(editor.draft == EditableProfile(member().profile))
    #expect(!editor.isDirty)
    #expect(editor.profile.displayName == "Jordan Lee") // shown, but not editable
}

@Test @MainActor func savingWritesOnlyTheNormalizedEditableFieldsForTheBoundUid() async {
    let fake = ProfileFakeRepository()
    let editor = ProfileEditor(context: member(), repository: fake)
    editor.draft.department = "  Product Design "
    editor.toggleInterest("tag-fitness")
    editor.toggleAvailability("weekday-evenings")
    #expect(editor.isDirty)
    #expect(await editor.save())
    #expect(fake.saved.count == 1)
    #expect(fake.saved.first?.uid == "one")
    #expect(fake.saved.first?.profile.department == "Product Design")
    #expect(fake.saved.first?.profile.interestTagIds == ["tag-social", "tag-fitness"])
    #expect(fake.saved.first?.profile.availability == ["weekends", "weekday-evenings"])
    #expect(!editor.isDirty)
    #expect(editor.profile.department == "Product Design")
    #expect(editor.profile.pointsBalance == 300 && editor.profile.role == "member")
}

@Test @MainActor func unchangedDraftDoesNotWrite() async {
    let fake = ProfileFakeRepository()
    let editor = ProfileEditor(context: member(), repository: fake)
    editor.draft.city = "Pittsburgh, PA  " // whitespace only: not a change
    #expect(!editor.isDirty)
    #expect(await editor.save())
    #expect(fake.saved.isEmpty)
}

@Test @MainActor func invalidDraftIsRefusedLocallyAndKept() async {
    let fake = ProfileFakeRepository()
    let editor = ProfileEditor(context: member(), repository: fake)
    editor.draft.jobTitle = String(repeating: "x", count: 121)
    #expect(await editor.save() == false)
    #expect(editor.saveError == .invalidInput)
    #expect(fake.saved.isEmpty)
    #expect(editor.draft.jobTitle.count == 121)
    editor.draft.jobTitle = "Lead" // editing clears the error
    #expect(editor.saveError == nil)
}

@Test @MainActor func failedSaveKeepsTheDraftAndReportsTheFailure() async {
    let fake = ProfileFakeRepository(); fake.saveFailure = .permissionDenied
    let editor = ProfileEditor(context: member(), repository: fake)
    editor.draft.city = "Boston, MA"
    #expect(await editor.save() == false)
    #expect(editor.saveError == .permissionDenied)
    #expect(editor.draft.city == "Boston, MA")
    #expect(editor.profile.city == "Pittsburgh, PA")
    #expect(!editor.isSaving)
}

@Test @MainActor func liveUpdatesFollowACleanDraftButNeverOverwriteEdits() {
    let editor = ProfileEditor(context: member(), repository: ProfileFakeRepository())
    editor.receive(member(department: "Research"))
    #expect(editor.draft.department == "Research")
    editor.draft.city = "Boston, MA"
    editor.receive(member(department: "Sales"))
    #expect(editor.profile.department == "Sales")
    #expect(editor.draft.department == "Research") // unsaved edits are kept as typed
    #expect(editor.draft.city == "Boston, MA")
    editor.discardChanges()
    #expect(editor.draft == EditableProfile(member(department: "Sales").profile))
}

@Test @MainActor func editorIgnoresProfilesFromAnotherAccount() async {
    let fake = ProfileFakeRepository()
    let editor = ProfileEditor(context: member("one"), repository: fake)
    editor.receive(member("two", department: "Other company data"))
    #expect(editor.profile.department == "Design")
    #expect(editor.uid == "one")
}

@Test @MainActor func interestAndAvailabilityListsStopAtTheRuleLimit() {
    let editor = ProfileEditor(context: member(interests: (0..<10).map { "tag-\($0)" }), repository: ProfileFakeRepository())
    #expect(!editor.canAddInterest)
    editor.toggleInterest("tag-new")
    #expect(editor.draft.interestTagIds.count == 10)
    editor.toggleInterest("tag-3")
    #expect(!editor.draft.interestTagIds.contains("tag-3"))
    #expect(editor.canAddInterest)
}

@Test @MainActor func sessionWritesProfilesOnlyForTheCurrentMember() async {
    let fake = ProfileFakeRepository()
    let session = AccountsSession(repository: fake)
    await session.updateProfile(EditableProfile(member().profile))
    #expect(session.commandError == .unauthenticated)
    #expect(fake.saved.isEmpty)
}

@Test @MainActor func catalogLoadsSortedUniqueTagsAndResolvesStoredIds() async {
    let fake = ProfileFakeRepository()
    fake.tags = [
        .init(id: "tag-social", name: "Social", icon: "🎉", sortOrder: 3),
        .init(id: "tag-fitness", name: "Fitness", icon: "🏋️", sortOrder: 1),
        .init(id: "tag-arts", name: "Arts", icon: "🎨", sortOrder: 3),
        .init(id: "tag-fitness", name: "Duplicate", icon: "x", sortOrder: 0),
    ]
    let catalog = InterestCatalog(repository: fake)
    #expect(catalog.tags.isEmpty)
    await catalog.load()
    #expect(catalog.tags.map(\.id) == ["tag-fitness", "tag-arts", "tag-social"])
    #expect(catalog.tags(for: ["tag-social", "missing", "tag-fitness"]).map(\.name) == ["Social", "Fitness"])
    await catalog.load()
    #expect(fake.tagLoads == 1) // loaded once
}

@Test @MainActor func catalogFailureCanBeRetried() async {
    let fake = ProfileFakeRepository(); fake.tagFailure = .unavailable
    let catalog = InterestCatalog(repository: fake)
    await catalog.load()
    #expect(catalog.state == .failed(.unavailable))
    fake.tagFailure = nil; fake.tags = [.init(id: "tag-social", name: "Social", icon: "🎉", sortOrder: 1)]
    await catalog.load()
    #expect(catalog.tags.map(\.id) == ["tag-social"])
}

@Test func availabilityOptionsUseStableUniqueIds() {
    let ids = AvailabilityOption.all.map(\.id)
    #expect(Set(ids).count == ids.count)
    #expect(ids.contains("weekday-evenings") && ids.contains("weekends")) // values already in sample data
}
