import DIPAccounts
import DIPContracts
import DIPCore
import DIPMockData
import Foundation
import SwiftUI

/// Account-owned profile/catalog data with injected company event reads.
/// The app keys this host by UID/company so state cannot cross membership scopes.
@MainActor
struct DIPMemberHome: View {
    let context: MembershipContext
    /// Photo from the signed-in OAuth identity, used while the stored profile has none.
    let oauthPhotoURL: String
    let onSignOut: () async -> Void
    @State private var editor: ProfileEditor
    @State private var catalog: InterestCatalog
    private let eventReadFactory: ((MembershipContext) -> MemberEventsRepository?)?
    private let participationFactory: (() -> (any ParticipationSource)?)?
    @State private var liveEvents: MemberEventAppRepository?
    @State private var eventConfigurationError = false
    @State private var prototypeRepository: DIPMockRepository

    init(
        context: MembershipContext,
        repository: any AccountsRepository & InterestCatalogRepository,
        oauthPhotoURL: String = "",
        eventReadFactory: ((MembershipContext) -> MemberEventsRepository?)? = nil,
        participationFactory: (() -> (any ParticipationSource)?)? = nil,
        onSignOut: @escaping () async -> Void
    ) {
        self.eventReadFactory = eventReadFactory
        self.participationFactory = participationFactory
        self.context = context
        self.oauthPhotoURL = oauthPhotoURL
        self.onSignOut = onSignOut
        _editor = State(initialValue: ProfileEditor(context: context, repository: repository))
        _catalog = State(initialValue: InterestCatalog(repository: repository))
        _prototypeRepository = State(initialValue: DIPMockRepository(
            initialSnapshot: MemberProfileBridge.seed(context: context, oauthPhotoURL: oauthPhotoURL)))
    }

    var body: some View {
        Group {
            if eventReadFactory != nil {
                if let liveEvents { prototype(repository: liveEvents, live: true) }
                else if eventConfigurationError {
                    ContentUnavailableView("Events unavailable", systemImage: "calendar.badge.exclamationmark",
                                           description: Text("Please sign out and try again."))
                } else { ProgressView("Loading your company events…") }
            } else { prototype(repository: prototypeRepository, live: false) }
        }
        .task {
            if liveEvents == nil, let eventReadFactory {
                if let reads = eventReadFactory(context) {
                    liveEvents = MemberEventAppRepository(reads: reads,
                        profile: MemberProfileBridge.profile(context: context, tags: [], oauthPhotoURL: oauthPhotoURL),
                        participation: participationFactory?())
                } else { eventConfigurationError = true }
            }
            await catalog.load()
            liveEvents?.updateTagLabels(Dictionary(catalog.tags.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first }))
        }
        .onDisappear { liveEvents?.stop(); liveEvents = nil }
        .onChange(of: context.profile) { _, _ in editor.receive(context) }
    }

    private func prototype(repository: any DIPRepository, live: Bool) -> some View {
        DIPPrototypeApp(
            repository: repository, onSignOut: onSignOut,
            accountProfile: MemberProfileBridge.profile(context: context, tags: catalog.tags, oauthPhotoURL: oauthPhotoURL),
            interestCatalogLoading: catalogIsLoading, interestCatalogError: catalogError,
            onRetryInterestCatalog: { Task { await catalog.load() } }, onProfileSave: saveProfile,
            eventReadsOnly: live, liveParticipation: live && liveEvents?.supportsParticipation == true, onEventOpened: live ? { liveEvents?.selectDetail($0) } : nil,
            onLoadMoreEvents: live && (liveEvents?.hasMore == true) ? { Task { await liveEvents?.loadMore() } } : nil,
            loadingMoreEvents: liveEvents?.isLoadingMore == true, eventPaginationError: liveEvents?.paginationError,
            onRefreshEvents: live ? { await liveEvents?.refresh() } : nil)
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
        try await MemberProfileBridge.save(edit, editor: editor, uid: context.uid)
        // ProfileEditor acknowledges the command; membership observation remains the displayed source.
    }
}

/// Pure mapping between the existing account wire model and value-only presentation.
enum MemberProfileBridge {
    static func profile(context: MembershipContext, tags: [InterestTag], oauthPhotoURL: String = "") -> DIPProfile {
        let stored = context.profile
        var seen = Set<String>()
        let interests = tags.filter { seen.insert($0.id).inserted }
            .sorted { ($0.sortOrder, $0.name, $0.id) < ($1.sortOrder, $1.name, $1.id) }
            .map { DIPInterest(id: $0.id, name: $0.name, icon: $0.icon, sortOrder: $0.sortOrder) }
        // A stored portrait wins, then the OAuth photo. Absent both, use a neutral bundled character, never another person's fixture photo.
        // Only the large profile photo shows a real picture. Small avatars stay bundled characters.
        let photo = portrait(stored.photoURL) ?? portrait(oauthPhotoURL) ?? .asset("AvatarTeal")
        let avatar = MediaReference.asset("AvatarTeal")
        return DIPProfile(
            id: context.uid, displayName: stored.displayName,
            department: stored.department, city: stored.city,
            interestTagIDs: stored.interestTagIds, interestCatalog: interests,
            photo: photo, avatar: avatar, favoriteMemories: [],
            jobTitle: stored.jobTitle, availability: stored.availability,
            travelRadiusMiles: stored.travelRadiusMiles
        )
    }

    /// Saves one profile command through the uid-bound editor. Unchanged fields come from
    /// `editor.profile`, which already includes this editor's acknowledged saves, so a second
    /// save made before the membership listener catches up cannot revert the first.
    @MainActor static func save(_ edit: ProfileEdit, editor: ProfileEditor, uid: String) async throws {
        guard editor.uid == uid else { throw AccountsFailure.unauthenticated }
        guard !editor.isSaving else { throw AccountsFailure.unavailable }
        editor.draft = edits(edit, preserving: editor.profile)
        guard await editor.save() else { throw editor.saveError ?? AccountsFailure.unknown }
    }

    static func seed(context: MembershipContext, oauthPhotoURL: String = "") -> DIPAppSnapshot {
        var snapshot = DIPMockFixtures.reference
        snapshot.profile = profile(context: context, tags: [], oauthPhotoURL: oauthPhotoURL)
        snapshot.home.profileAvatar = snapshot.profile.avatar
        return snapshot
    }

    static func edits(_ edit: ProfileEdit, preserving stored: AppUser) -> EditableProfile {
        var result = EditableProfile(stored)
        result.department = edit.department
        result.city = edit.city
        result.interestTagIds = edit.interestTagIDs
        if let jobTitle = edit.jobTitle { result.jobTitle = jobTitle }
        if let availability = edit.availability { result.availability = availability }
        if let radius = edit.travelRadiusMiles { result.travelRadiusMiles = radius }
        return result
    }

    private static func portrait(_ value: String) -> MediaReference? {
        guard let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              let host = url.host, !host.isEmpty else { return nil }
        return .remote(url)
    }
}
