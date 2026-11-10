import DIPAccounts
import DIPContracts
import DIPCore
import Foundation
import XCTest
@testable import DIP

/// Records writes; can fail a set number of times. Never publishes, like a listener that lags.
@MainActor private final class ScriptedAccountsRepository: AccountsRepository {
    var writes: [EditableProfile] = []
    var failuresRemaining = 0
    func observations() -> AsyncStream<AccountObservation> { AsyncStream { _ in } }
    func signInWithGoogle() async throws {}
    func signOut() async throws {}
    func refreshIdentity() async throws {}
    func resolveMembership() async throws -> ResolveMembershipResponse { .init(contractVersion: 1, companyId: "company-1", role: "member") }
    func updateProfile(uid: String, _ profile: EditableProfile) async throws {
        if failuresRemaining > 0 { failuresRemaining -= 1; throw AccountsFailure.unavailable }
        writes.append(profile)
    }
}

@MainActor
final class OnboardingInterestsModelTests: XCTestCase {
    private let tags: [InterestTag] = [
        .init(id: "tag-fitness", name: "Fitness", icon: "", sortOrder: 1),
        .init(id: "tag-outdoors", name: "Outdoors", icon: "", sortOrder: 2),
        .init(id: "tag-social", name: "Social", icon: "", sortOrder: 3),
        .init(id: "tag-food", name: "Food & Drink", icon: "", sortOrder: 4),
        .init(id: "tag-arts", name: "Arts", icon: "", sortOrder: 5),
    ]
    private var manyTags: [InterestTag] {
        (1...12).map { InterestTag(id: "tag-\($0)", name: "Interest \($0)", icon: "", sortOrder: $0) }
    }

    private func stored(interests: [String] = []) -> AppUser {
        AppUser(
            id: "member-1", companyId: "company-1", displayName: "Jordan Lee",
            email: "jordan@example.invalid", photoURL: "https://example.invalid/p.jpg", avatarId: "avatar-01",
            department: "Research", jobTitle: "Engineer", city: "Pittsburgh",
            role: "member", interestTagIds: interests, travelRadiusMiles: 40,
            availability: ["weekends", "unknown-option"], friendIds: [], favoritePhotoIds: [],
            pointsBalance: 700, createdAt: Date(timeIntervalSince1970: 123))
    }

    /// A model saving through the real editor/bridge path.
    private func makeModel(interests: [String] = [], catalog: InterestCatalog.State? = nil,
                           failures: Int = 0) throws -> (OnboardingInterestsModel, ScriptedAccountsRepository, ProfileEditor) {
        let repository = ScriptedAccountsRepository()
        repository.failuresRemaining = failures
        let editor = ProfileEditor(context: try MembershipContext(uid: "member-1", profile: stored(interests: interests)),
                                   repository: repository)
        let model = OnboardingInterestsModel(editor: editor, uid: "member-1", catalog: catalog ?? .loaded(tags))
        return (model, repository, editor)
    }

    // MARK: Pre-selection and selection rules

    func testPreselectsStoredInterestsAndStartsClean() throws {
        let (model, _, _) = try makeModel(interests: ["tag-social", "tag-fitness"])
        XCTAssertEqual(model.selection, ["tag-social", "tag-fitness"])
        XCTAssertFalse(model.isDirty)
        XCTAssertEqual(model.bar.action, .saveAndStart)
        XCTAssertEqual(model.bar.title, "Save and start")
        XCTAssertTrue(model.bar.isAccent)
    }

    func testTitleSwitchesWithSelection() throws {
        let (model, _, _) = try makeModel()
        XCTAssertEqual(model.bar.title, "Start exploring")
        XCTAssertFalse(model.bar.isAccent)
        model.toggle("tag-arts")
        XCTAssertEqual(model.bar.title, "Save and start")
        XCTAssertEqual(model.announcement, "1 interest selected")
        model.toggle("tag-food")
        XCTAssertEqual(model.announcement, "2 interests selected")
        model.toggle("tag-arts"); model.toggle("tag-food")
        XCTAssertEqual(model.bar.title, "Start exploring")
        XCTAssertFalse(model.isDirty)
    }

    func testSelectionStopsAtTenAndBindingCannotExceedIt() throws {
        let (model, _, _) = try makeModel(catalog: .loaded(manyTags))
        for index in 1...12 { model.toggle("tag-\(index)") }
        XCTAssertEqual(model.selection.count, 10)
        XCTAssertFalse(model.selection.contains("tag-11"))
        model.setSelection(Set((1...11).map { "tag-\($0)" }))
        XCTAssertEqual(model.selection.count, 10, "binding writes above the maximum are ignored")
        model.toggle("tag-1")
        model.toggle("tag-12")
        XCTAssertTrue(model.selection.contains("tag-12"), "removing one frees a slot")
    }

    func testSavedOrderFollowsCatalogAndKeepsUnavailableStoredIDs() throws {
        let (model, _, _) = try makeModel(interests: ["retired-1", "tag-social"])
        XCTAssertEqual(model.options.last?.id, "retired-1")
        XCTAssertEqual(model.options.last?.name, "Unavailable interest")
        model.toggle("tag-arts"); model.toggle("tag-fitness")
        XCTAssertEqual(model.orderedSelection, ["tag-fitness", "tag-social", "tag-arts", "retired-1"])
    }

    // MARK: Save

    func testSaveWritesInterestsWithCurrentDepartmentCityAndKeepsOtherFields() async throws {
        let (model, repository, editor) = try makeModel(interests: ["tag-social"])
        model.toggle("tag-arts")
        await model.performBarAction()
        XCTAssertEqual(model.outcome, .completed(saved: true))
        let write = try XCTUnwrap(repository.writes.last)
        XCTAssertEqual(repository.writes.count, 1)
        XCTAssertEqual(write.interestTagIds, ["tag-social", "tag-arts"])
        XCTAssertEqual(write.department, "Research")
        XCTAssertEqual(write.city, "Pittsburgh")
        XCTAssertEqual(write.jobTitle, "Engineer")
        XCTAssertEqual(write.availability, ["weekends", "unknown-option"])
        XCTAssertEqual(write.travelRadiusMiles, 40)
        XCTAssertEqual(write.photoURL, "https://example.invalid/p.jpg")
        XCTAssertEqual(write.avatarId, "avatar-01")
        XCTAssertEqual(editor.profile.interestTagIds, ["tag-social", "tag-arts"])
    }

    func testSaveUsesDepartmentAndCityFromTheLatestProfile() async throws {
        var current = stored()
        var edits: [ProfileEdit] = []
        let model = OnboardingInterestsModel(profile: { current }, catalog: .loaded(tags)) { edits.append($0) }
        current.department = "Design"; current.city = "Boston"
        model.toggle("tag-fitness")
        await model.performBarAction()
        XCTAssertEqual(edits, [ProfileEdit(department: "Design", city: "Boston", interestTagIDs: ["tag-fitness"])])
        XCTAssertNil(edits.first?.jobTitle); XCTAssertNil(edits.first?.availability); XCTAssertNil(edits.first?.travelRadiusMiles)
    }

    func testFailedSaveKeepsChoicesAndRetrySucceeds() async throws {
        let (model, repository, _) = try makeModel(failures: 1)
        model.toggle("tag-food"); model.toggle("tag-arts")
        await model.performBarAction()
        XCTAssertNil(model.outcome)
        XCTAssertEqual(model.selection, ["tag-food", "tag-arts"])
        XCTAssertEqual(model.saveErrorMessage, OnboardingInterestsModel.saveFailedMessage)
        XCTAssertEqual(model.bar.action, .retry)
        XCTAssertEqual(model.bar.title, "Try again")
        XCTAssertFalse(model.bar.isAccent)
        XCTAssertTrue(model.canSkip, "Skip for now stays available")
        XCTAssertEqual(model.pickerState.errorMessage, OnboardingInterestsModel.saveFailedMessage)
        await model.performBarAction()
        XCTAssertEqual(model.outcome, .completed(saved: true))
        XCTAssertEqual(repository.writes.map(\.interestTagIds), [["tag-food", "tag-arts"]])
        XCTAssertNil(model.saveErrorMessage)
    }

    func testChangingSelectionAfterAFailureReturnsToSave() async throws {
        let (model, _, _) = try makeModel(failures: 1)
        model.toggle("tag-food")
        await model.performBarAction()
        XCTAssertEqual(model.bar.action, .retry)
        model.toggle("tag-arts")
        XCTAssertNil(model.saveErrorMessage)
        XCTAssertEqual(model.bar.action, .saveAndStart)
    }

    func testSavingStateBlocksEditsSkipAndSecondSave() async throws {
        var release: CheckedContinuation<Void, Never>?
        var calls = 0
        let model = OnboardingInterestsModel(profile: { self.stored() }, catalog: .loaded(tags)) { _ in
            calls += 1
            await withCheckedContinuation { release = $0 }
        }
        model.toggle("tag-fitness")
        let save = Task { await model.performBarAction() }
        while release == nil { await Task.yield() }
        XCTAssertTrue(model.isSaving)
        XCTAssertEqual(model.bar, .init(action: .saving, title: "Saving…", isAccent: true, isEnabled: false, showsProgress: true))
        XCTAssertTrue(model.pickerState.isSaving)
        model.toggle("tag-arts"); model.skip()
        await model.performBarAction()
        XCTAssertEqual(model.selection, ["tag-fitness"])
        XCTAssertNil(model.outcome)
        release?.resume()
        await save.value
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(model.outcome, .completed(saved: true))
    }

    func testUnchangedSelectionFinishesWithoutWriting() async throws {
        let (preselected, repository, _) = try makeModel(interests: ["tag-fitness"])
        await preselected.performBarAction()
        XCTAssertEqual(preselected.outcome, .completed(saved: false))
        let (empty, emptyRepository, _) = try makeModel()
        await empty.performBarAction()
        XCTAssertEqual(empty.outcome, .completed(saved: false))
        XCTAssertTrue(repository.writes.isEmpty); XCTAssertTrue(emptyRepository.writes.isEmpty)
    }

    func testClearingStoredInterestsIsSavedOnStartExploring() async throws {
        let (model, repository, _) = try makeModel(interests: ["tag-fitness"])
        model.toggle("tag-fitness")
        XCTAssertEqual(model.bar.title, "Start exploring")
        await model.performBarAction()
        XCTAssertEqual(repository.writes.map(\.interestTagIds), [[]])
        XCTAssertEqual(model.outcome, .completed(saved: true))
    }

    func testSkipWritesNothingAndEndsTheStep() throws {
        let (model, repository, _) = try makeModel()
        model.toggle("tag-arts")
        model.skip()
        XCTAssertEqual(model.outcome, .skipped)
        model.toggle("tag-food")
        XCTAssertEqual(model.selection, ["tag-arts"])
        XCTAssertFalse(model.bar.isEnabled)
        XCTAssertTrue(repository.writes.isEmpty)
    }

    // MARK: Catalog states

    func testCatalogLoadingFailedEmptyAndReady() throws {
        let (model, _, _) = try makeModel(interests: ["tag-fitness"], catalog: .idle)
        XCTAssertEqual(model.catalog, .loading)
        XCTAssertEqual(model.pickerState.catalog, .loading)
        XCTAssertEqual(model.bar.title, "Start exploring", "nothing can be saved before the catalog")
        model.toggle("tag-arts")
        XCTAssertEqual(model.selection, ["tag-fitness"], "no edits without a catalog")

        model.updateCatalog(.failed(.unavailable))
        XCTAssertEqual(model.catalog, .failed)
        XCTAssertEqual(model.pickerState.catalog, .failed(OnboardingInterestsModel.catalogFailedMessage))
        XCTAssertEqual(OnboardingInterestsModel.catalogFailedMessage,
                       "Your interests couldn’t load. You can add them in Profile anytime.")
        XCTAssertEqual(model.bar.title, "Start exploring")
        XCTAssertFalse(model.shouldSkipStep)

        model.updateCatalog(.loaded([]))
        XCTAssertEqual(model.catalog, .empty)
        XCTAssertTrue(model.shouldSkipStep)

        model.updateCatalog(.loaded(tags))
        XCTAssertEqual(model.catalog, .ready)
        XCTAssertEqual(model.pickerState, .init(isSaving: false, errorMessage: nil, catalog: .ready))
        XCTAssertEqual(model.bar.title, "Save and start")
    }

    func testFailedCatalogStartExploringNeverWritesStoredInterests() async throws {
        let (model, repository, _) = try makeModel(interests: ["tag-fitness"], catalog: .failed(.unavailable))
        await model.performBarAction()
        XCTAssertEqual(model.outcome, .completed(saved: false))
        XCTAssertTrue(repository.writes.isEmpty)
    }

    func testNewerProfileUpdatesAnUntouchedSelectionOnly() throws {
        var current = stored(interests: ["tag-fitness"])
        let model = OnboardingInterestsModel(profile: { current }, catalog: .loaded(tags)) { _ in }
        current.interestTagIds = ["tag-social"]
        model.receiveProfile()
        XCTAssertEqual(model.selection, ["tag-social"])
        model.toggle("tag-arts")
        current.interestTagIds = ["tag-food"]
        model.receiveProfile()
        XCTAssertEqual(model.selection, ["tag-social", "tag-arts"], "edits are kept")
    }

    // MARK: Embedded picker via the model

    func testEmbeddedBindingAppliesTheModelRules() throws {
        let (model, _, _) = try makeModel()
        let binding = model.selectionBinding
        binding.wrappedValue = ["tag-arts"]
        XCTAssertEqual(model.selection, ["tag-arts"])
        model.skip()
        binding.wrappedValue = ["tag-arts", "tag-food"]
        XCTAssertEqual(model.selection, ["tag-arts"], "finished step ignores picker writes")
        // The embedded initializer builds without a save callback or dismiss path.
        _ = DIPInterestPicker(options: model.options, selection: binding, embedded: model.pickerState)
    }

    func testSharedRulesMatchTheStandalonePicker() {
        XCTAssertEqual(DIPInterestPicker.maximumSelection, 10)
        XCTAssertEqual(InterestSelectionRules.maximumSelection, EditableProfile.maximumListCount)
        let options = [DIPInterest(id: "a", name: "Arts"), DIPInterest(id: "a", name: "Dup"), DIPInterest(id: "b", name: "Food & Drink")]
        XCTAssertEqual(InterestSelectionRules.unique(options).map(\.name), ["Arts", "Food & Drink"])
        XCTAssertEqual(InterestSelectionRules.filtered(options, query: "  food ").map(\.id), ["b"])
        XCTAssertEqual(InterestSelectionRules.ordered(["b", "a"], options: InterestSelectionRules.unique(options)), ["a", "b"])
        XCTAssertEqual(InterestSelectionRules.toggling("c", in: Set((1...10).map(String.init))).count, 10)
    }
}
