import DIPAccounts
import DIPContracts
import DIPCore
import DIPMockData
import Foundation
import SwiftUI

/// Account-owned profile/catalog data alongside the explicitly mocked event experience.
/// The app keys this host by uid so editors and fixture state cannot cross accounts.
@MainActor
struct DIPMemberHome: View {
    let context: MembershipContext
    let onSignOut: () async -> Void
    @State private var editor: ProfileEditor
    @State private var catalog: InterestCatalog
    @State private var prototypeRepository: DIPMockRepository

    init(
        context: MembershipContext,
        repository: any AccountsRepository & InterestCatalogRepository,
        onSignOut: @escaping () async -> Void
    ) {
        self.context = context
        self.onSignOut = onSignOut
        _editor = State(initialValue: ProfileEditor(context: context, repository: repository))
        _catalog = State(initialValue: InterestCatalog(repository: repository))
        _prototypeRepository = State(initialValue: DIPMockRepository(
            initialSnapshot: MemberProfileBridge.seed(context: context)))
    }

    var body: some View {
        DIPPrototypeApp(
            repository: prototypeRepository,
            onSignOut: onSignOut,
            accountProfile: MemberProfileBridge.profile(context: context, tags: catalog.tags),
            interestCatalogLoading: catalogIsLoading,
            interestCatalogError: catalogError,
            onRetryInterestCatalog: { Task { await catalog.load() } },
            onProfileSave: saveProfile
        )
        .task { await catalog.load() }
        .onChange(of: context.profile) { _, _ in editor.receive(context) }
    }

    private var catalogIsLoading: Bool {
        switch catalog.state {
        case .idle, .loading: true
        case .loaded, .failed: false
        }
    }

    private var catalogError: String? {
        if case .failed = catalog.state {
            return "Your interests couldn’t be loaded. Please try again."
        }
        return nil
    }

    private func saveProfile(_ edit: ProfileEdit) async throws {
        guard editor.uid == context.uid else { throw AccountsFailure.unauthenticated }
        guard !editor.isSaving else { throw AccountsFailure.unavailable }
        editor.receive(context)
        editor.draft = MemberProfileBridge.edits(edit, preserving: context.profile)
        guard await editor.save() else { throw editor.saveError ?? AccountsFailure.unknown }
        // ProfileEditor acknowledges the command; membership observation remains the displayed source.
    }
}

/// Pure mapping between the existing account wire model and value-only presentation.
enum MemberProfileBridge {
    static func profile(context: MembershipContext, tags: [InterestTag]) -> DIPProfile {
        let stored = context.profile
        var seen = Set<String>()
        let interests = tags.filter { seen.insert($0.id).inserted }
            .sorted { ($0.sortOrder, $0.name, $0.id) < ($1.sortOrder, $1.name, $1.id) }
            .map { DIPInterest(id: $0.id, name: $0.name, icon: $0.icon, sortOrder: $0.sortOrder) }
        // An absent portrait uses a neutral bundled character, never another person's fixture photo.
        let avatar = portrait(stored.photoURL) ?? .asset("AvatarTeal")
        return DIPProfile(
            id: context.uid, displayName: stored.displayName,
            department: stored.department, city: stored.city,
            interestTagIDs: stored.interestTagIds, interestCatalog: interests,
            photo: avatar, avatar: avatar, favoriteMemories: []
        )
    }

    static func seed(context: MembershipContext) -> DIPAppSnapshot {
        var snapshot = DIPMockFixtures.reference
        snapshot.profile = profile(context: context, tags: [])
        snapshot.home.profileAvatar = snapshot.profile.avatar
        return snapshot
    }

    static func edits(_ edit: ProfileEdit, preserving stored: AppUser) -> EditableProfile {
        var result = EditableProfile(stored)
        result.department = edit.department
        result.city = edit.city
        result.interestTagIds = edit.interestTagIDs
        return result
    }

    private static func portrait(_ value: String) -> MediaReference? {
        guard let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              let host = url.host, !host.isEmpty else { return nil }
        return .remote(url)
    }
}
