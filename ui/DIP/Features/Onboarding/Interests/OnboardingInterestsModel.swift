import DIPAccounts
import DIPContracts
import DIPCore
import Foundation
import Observation

/// State for onboarding step B5 "Interests" (proposal pending team approval).
///
/// Owns the selection, the bar action and the only real write in the tour. Saving goes through
/// the same `MemberProfileBridge` / `ProfileEditor` path as Profile, with the member's current
/// department and city, so only `interestTagIds` changes. UI-framework-free: the embedded
/// `DIPInterestPicker` is driven from `OnboardingInterestsModel+Picker.swift`.
@MainActor @Observable
final class OnboardingInterestsModel {
    /// What the step can show for the catalog.
    enum Catalog: Equatable {
        case loading
        /// No picker; message plus "Start exploring". Interests can be added in Profile later.
        case failed
        /// Nothing to choose from: the host skips this step.
        case empty
        case ready
    }

    /// What the bar's single action does when tapped.
    enum BarAction: Equatable {
        case saveAndStart, startExploring, saving, retry
    }

    struct Bar: Equatable {
        var action: BarAction
        var title: String
        /// `.accent` styling ("Save and start"); otherwise the standard ink bar.
        var isAccent: Bool
        var isEnabled: Bool
        var showsProgress: Bool
        static let identifier = "onboarding.interests.save"
    }

    enum Outcome: Equatable {
        /// The step finished. `saved` is true only when an interest write was acknowledged.
        case completed(saved: Bool)
        /// "Skip for now": nothing written.
        case skipped
    }

    static var catalogFailedMessage: String {
        String(localized: "onboarding.interests.catalogFailed",
               defaultValue: "Your interests couldn’t load. You can add them in Profile anytime.",
               comment: "Onboarding interests step: shown when the interest list fails to load")
    }
    static var saveFailedMessage: String {
        String(localized: "onboarding.interests.saveFailed",
               defaultValue: "Couldn’t save your interests. Your choices are kept.",
               comment: "Onboarding interests step: shown when saving the selected interests fails")
    }
    static let maximumSelection = InterestSelectionRules.maximumSelection

    private(set) var catalogState: InterestCatalog.State
    private(set) var selection: Set<String>
    private(set) var isSaving = false
    private(set) var saveErrorMessage: String?
    private(set) var outcome: Outcome?
    /// Polite announcement after each toggle, e.g. "3 interests selected".
    private(set) var announcement: String?
    /// Stored ids (stored order) the selection started from or was last saved as.
    private(set) var storedIDs: [String]

    @ObservationIgnored private let currentProfile: @MainActor () -> AppUser
    @ObservationIgnored private let saveEdit: @MainActor (ProfileEdit) async throws -> Void

    /// - Parameters:
    ///   - profile: the latest acknowledged profile; read at init for pre-selection and at save
    ///     time for department and city.
    ///   - save: writes one profile command (in the app: `MemberProfileBridge.save`).
    init(
        profile: @escaping @MainActor () -> AppUser,
        catalog: InterestCatalog.State = .idle,
        save: @escaping @MainActor (ProfileEdit) async throws -> Void
    ) {
        currentProfile = profile
        saveEdit = save
        catalogState = catalog
        let stored = Self.unique(profile().interestTagIds)
        storedIDs = stored
        selection = Set(stored)
    }

    /// The production wiring: the member's uid-bound editor, exactly like Profile's save.
    convenience init(editor: ProfileEditor, uid: String, catalog: InterestCatalog.State = .idle) {
        self.init(profile: { editor.profile }, catalog: catalog) { edit in
            try await MemberProfileBridge.save(edit, editor: editor, uid: uid)
        }
    }

    // MARK: Derived state

    var catalog: Catalog {
        switch catalogState {
        case .idle, .loading: .loading
        case .failed: .failed
        case .loaded(let tags): tags.isEmpty ? .empty : .ready
        }
    }

    /// True when the host should not show this step at all.
    var shouldSkipStep: Bool { catalog == .empty }

    /// Catalog interests in catalog order, then stored ids the catalog no longer has, so they
    /// stay visible and removable instead of being silently erased (profile-interests.md).
    var options: [DIPInterest] {
        guard case .loaded(let tags) = catalogState else { return [] }
        let catalog = InterestSelectionRules.unique(tags.map {
            DIPInterest(id: $0.id, name: $0.name, icon: $0.icon, sortOrder: $0.sortOrder)
        })
        let known = Set(catalog.map(\.id))
        let missing = storedIDs.filter { !known.contains($0) }.map {
            DIPInterest(id: $0, name: String(localized: "onboarding.interests.unavailable", defaultValue: "Unavailable interest",
                         comment: "Name shown for a stored interest that is no longer in the catalog"), sortOrder: Int.max)
        }
        return catalog + missing
    }

    var isDirty: Bool { selection != Set(storedIDs) }

    /// The ids a save writes, in catalog order.
    var orderedSelection: [String] { InterestSelectionRules.ordered(selection, options: options) }

    var canEdit: Bool { catalog == .ready && !isSaving && outcome == nil }
    var canSkip: Bool { !isSaving && outcome == nil }

    var bar: Bar {
        if isSaving {
            return Bar(action: .saving, title: String(localized: "onboarding.interests.bar.saving", defaultValue: "Saving…",
                                                      comment: "Onboarding interests bottom bar while saving"),
                       isAccent: true, isEnabled: false, showsProgress: true)
        }
        if saveErrorMessage != nil {
            return Bar(action: .retry, title: String(localized: "onboarding.interests.bar.retry", defaultValue: "Try again",
                                                     comment: "Onboarding interests bottom bar after a failed save"),
                       isAccent: false, isEnabled: outcome == nil, showsProgress: false)
        }
        if catalog == .ready, !selection.isEmpty {
            return Bar(action: .saveAndStart, title: String(localized: "onboarding.interests.bar.saveAndStart", defaultValue: "Save and start",
                                                            comment: "Onboarding interests bottom bar when interests are selected"),
                       isAccent: true, isEnabled: outcome == nil, showsProgress: false)
        }
        return Bar(action: .startExploring, title: String(localized: "onboarding.interests.bar.startExploring", defaultValue: "Start exploring",
                                                          comment: "Onboarding interests bottom bar when nothing is selected"),
                   isAccent: false,
                   isEnabled: outcome == nil, showsProgress: false)
    }

    // MARK: Inputs

    /// Feed the shared `InterestCatalog.state` whenever it changes.
    func updateCatalog(_ state: InterestCatalog.State) {
        catalogState = state
    }

    /// A newer stored profile arrived. Untouched selections follow it; edits are kept.
    func receiveProfile() {
        guard !isSaving, outcome == nil, !isDirty else { return }
        storedIDs = Self.unique(currentProfile().interestTagIds)
        selection = Set(storedIDs)
    }

    func toggle(_ id: String) {
        setSelection(InterestSelectionRules.toggling(id, in: selection))
    }

    /// Replaces the selection (the embedded picker's binding). Ignored while saving, once the
    /// step finished, without a ready catalog, or above the maximum. Clears a save error so
    /// the bar offers "Save and start" for the changed choice.
    func setSelection(_ newValue: Set<String>) {
        guard canEdit, newValue != selection, newValue.count <= Self.maximumSelection else { return }
        selection = newValue
        saveErrorMessage = nil
        announcement = String(localized: "onboarding.interests.selectedCount", defaultValue: "\(newValue.count) interests selected",
                              comment: "VoiceOver announcement after toggling an interest; %lld = number of selected interests")
    }

    /// The bar's one action: save (or retry the save) when there is a change, otherwise finish.
    func performBarAction() async {
        guard !isSaving, outcome == nil else { return }
        guard catalog == .ready, isDirty else {
            outcome = .completed(saved: false)
            return
        }
        await save()
    }

    /// "Skip for now": leaves the stored profile unchanged.
    func skip() {
        guard canSkip else { return }
        outcome = .skipped
    }

    private func save() async {
        isSaving = true
        saveErrorMessage = nil
        defer { isSaving = false }
        let profile = currentProfile()
        let ids = orderedSelection
        // department and city are non-optional in ProfileEdit and written as given, so carry
        // the current values; jobTitle/availability/radius stay nil = unchanged.
        let edit = ProfileEdit(department: profile.department, city: profile.city, interestTagIDs: ids)
        do {
            try await saveEdit(edit)
            storedIDs = ids
            outcome = .completed(saved: true)
        } catch {
            saveErrorMessage = Self.saveFailedMessage
        }
    }

    private static func unique(_ ids: [String]) -> [String] {
        var seen = Set<String>()
        return ids.filter { seen.insert($0).inserted }
    }
}
