import Foundation
import Observation
import DIPContracts

/// One entry of the shared, company-independent interest catalog (`tags/{tagId}`).
public struct InterestTag: Equatable, Hashable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let icon: String
    public let sortOrder: Int
    public init(id: String, name: String, icon: String, sortOrder: Int) {
        self.id = id; self.name = name; self.icon = icon; self.sortOrder = sortOrder
    }
}

/// Read-only access to the interest catalog. Verified users only (firestore.rules `tags`).
@MainActor public protocol InterestCatalogRepository: AnyObject {
    func interestTags() async throws -> [InterestTag]
}

/// A value the profile can store in `availability`. Stored values are stable ids;
/// labels are presentation text. Unknown stored ids are preserved, never dropped.
public struct AvailabilityOption: Equatable, Hashable, Sendable, Identifiable {
    public let id: String
    public let label: String
    public init(id: String, label: String) { self.id = id; self.label = label }

    /// V1 choices offered by the profile editor.
    public static let all: [AvailabilityOption] = [
        .init(id: "weekday-mornings", label: "Weekday mornings"),
        .init(id: "weekday-lunch", label: "Weekday lunch"),
        .init(id: "weekday-evenings", label: "Weekday evenings"),
        .init(id: "weekends", label: "Weekends"),
    ]
}

extension EditableProfile {
    /// Most interests or availability entries a profile may hold (mirrors firestore.rules).
    public static let maximumListCount = 10

    /// The client-editable part of a stored profile.
    public init(_ profile: AppUser) {
        self.init(photoURL: profile.photoURL, avatarId: profile.avatarId, department: profile.department,
                  jobTitle: profile.jobTitle, city: profile.city, interestTagIds: profile.interestTagIds,
                  travelRadiusMiles: profile.travelRadiusMiles, availability: profile.availability)
    }

    /// `profile` with these editable fields applied; server-owned fields are untouched.
    public func applied(to profile: AppUser) -> AppUser {
        var result = profile
        result.photoURL = photoURL; result.avatarId = avatarId; result.department = department
        result.jobTitle = jobTitle; result.city = city; result.interestTagIds = interestTagIds
        result.travelRadiusMiles = travelRadiusMiles; result.availability = availability
        return result
    }

    /// Text fields trimmed and lists de-duplicated (first occurrence wins), as saved.
    public func normalized() -> EditableProfile {
        func trim(_ value: String) -> String { value.trimmingCharacters(in: .whitespacesAndNewlines) }
        func unique(_ values: [String]) -> [String] {
            var seen = Set<String>()
            return values.map(trim).filter { !$0.isEmpty && seen.insert($0).inserted }
        }
        var copy = self
        copy.photoURL = trim(photoURL); copy.avatarId = trim(avatarId); copy.department = trim(department)
        copy.jobTitle = trim(jobTitle); copy.city = trim(city)
        copy.interestTagIds = unique(interestTagIds); copy.availability = unique(availability)
        return copy
    }
}

/// Edits the signed-in member's own profile. Create one per `MembershipContext`; it is
/// bound to that uid and refuses profiles for any other account. Display name, email,
/// company, role and points are shown from `profile` but are never part of the draft.
@MainActor @Observable public final class ProfileEditor {
    public let uid: String
    /// Latest stored profile (live from the membership listener).
    public private(set) var profile: AppUser
    /// Unsaved edits. Follows `profile` until the user changes something.
    public var draft: EditableProfile { didSet { saveError = nil } }
    public private(set) var isSaving = false
    public private(set) var saveError: AccountsFailure?

    @ObservationIgnored private let repository: any AccountsRepository

    public init(context: MembershipContext, repository: any AccountsRepository) {
        uid = context.uid; profile = context.profile
        draft = EditableProfile(context.profile)
        self.repository = repository
    }

    public var isDirty: Bool { draft.normalized() != EditableProfile(profile).normalized() }
    public var canAddInterest: Bool { draft.interestTagIds.count < EditableProfile.maximumListCount }

    /// Applies a newer stored profile for the same uid. Unsaved edits are kept.
    public func receive(_ context: MembershipContext) {
        guard context.uid == uid else { return }
        let wasDirty = isDirty
        profile = context.profile
        if !wasDirty, !isSaving { draft = EditableProfile(context.profile) }
    }

    public func toggleInterest(_ tagId: String) {
        if let index = draft.interestTagIds.firstIndex(of: tagId) { draft.interestTagIds.remove(at: index) }
        else if canAddInterest { draft.interestTagIds.append(tagId) }
    }

    public func toggleAvailability(_ id: String) {
        if let index = draft.availability.firstIndex(of: id) { draft.availability.remove(at: index) }
        else if draft.availability.count < EditableProfile.maximumListCount { draft.availability.append(id) }
    }

    public func discardChanges() { draft = EditableProfile(profile) }

    /// Validates and writes the draft. Returns true when nothing is left unsaved.
    /// On failure the draft is kept and `saveError` explains why.
    @discardableResult public func save() async -> Bool {
        guard !isSaving else { return false }
        guard isDirty else { return true }
        let edits = draft.normalized()
        do { try edits.validate() } catch { saveError = .invalidInput; return false }
        isSaving = true; saveError = nil
        defer { isSaving = false }
        do {
            try await repository.updateProfile(uid: uid, edits)
            // Show the saved values now; the listener confirms them shortly after.
            profile = edits.applied(to: profile)
            draft = EditableProfile(profile)
            return true
        } catch {
            saveError = error as? AccountsFailure ?? .unknown
            return false
        }
    }
}

/// Loads the interest catalog once and resolves stored ids to tags for display.
@MainActor @Observable public final class InterestCatalog {
    public enum State: Equatable, Sendable {
        case idle, loading
        case loaded([InterestTag])
        case failed(AccountsFailure)
    }
    public private(set) var state: State = .idle
    @ObservationIgnored private let repository: any InterestCatalogRepository

    public init(repository: any InterestCatalogRepository) { self.repository = repository }

    /// Catalog order: `sortOrder`, then name. Duplicate ids keep their first entry.
    public var tags: [InterestTag] { if case .loaded(let tags) = state { tags } else { [] } }

    /// Loads unless already loading or loaded. Call again after a failure to retry.
    public func load() async {
        switch state { case .loading, .loaded: return; case .idle, .failed: break }
        state = .loading
        do {
            var seen = Set<String>()
            let tags = try await repository.interestTags()
                .filter { seen.insert($0.id).inserted }
                .sorted { ($0.sortOrder, $0.name) < ($1.sortOrder, $1.name) }
            state = .loaded(tags)
        } catch {
            state = .failed(error as? AccountsFailure ?? .unknown)
        }
    }

    /// Tags for stored ids, in the stored order. Ids missing from the catalog are skipped.
    public func tags(for ids: [String]) -> [InterestTag] {
        let byId = Dictionary(tags.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return ids.compactMap { byId[$0] }
    }
}
