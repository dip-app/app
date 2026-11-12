import DIPAccounts
import DIPCore
import Foundation
import SwiftUI

@main
struct DIPApp: App {
    @State private var session: AccountsSession
    /// Event links wait here until the member shell can open them (signed out, resolving, onboarding).
    @State private var eventLinks = EventLinkInbox()
    /// Push client; nil unless the feature flag is on and Firebase is configured (device-unverified, see PushRegistration.swift).
    @State private var push: PushCoordinator?
    @Environment(\.scenePhase) private var scenePhase
    private let makeEventReads: ((MembershipContext) -> MemberEventsRepository?)?
    private let makeParticipation: (() -> (any ParticipationSource)?)?
    private let makeBugReportSubmitter: (() -> (any BugReportSubmitting)?)
    private let makeAlbums: (() -> (any PhotoAlbumSource)?)?
    private let makeChallengeReads: ((MembershipContext) -> MemberChallengesRepository?)?
    private let makeInvites: ((MembershipContext) -> (any DIPInvitesRepository)?)?
    private let makeNotifications: ((MembershipContext) -> (any DIPNotificationsRepository)?)?
    /// Challenge submissions: SDK-backed when configured, the in-memory source in unconfigured Debug builds, nil otherwise.
    private let makeSubmissionSource: (() -> (any SubmissionSource)?)
    private let repository: any AccountsRepository & InterestCatalogRepository

    init() {
        // Debug-only mock launch (see MockLaunch.swift) never configures Firebase or App Check.
        if MockLaunch.mode() == nil { FirebaseBootstrap.configureIfAvailable() }
        makeEventReads = FirebaseBootstrap.status == .notConfigured ? nil : { FirebaseBootstrap.makeMemberEventsRepository(context: $0) }
        makeParticipation = FirebaseBootstrap.status == .notConfigured ? nil : { FirebaseBootstrap.makeParticipationSource() }
        makeBugReportSubmitter = {
            if let firebase = FirebaseBootstrap.makeBugReportSubmitter() { return firebase }
            // Unconfigured Debug builds keep the flow clickable with the in-memory submitter; Release has none.
            #if DEBUG
            return BugReportPreviewBehavior.submitter()
            #else
            return nil
            #endif
        }
        makeAlbums = FirebaseBootstrap.status == .notConfigured ? nil : { FirebaseBootstrap.makePhotoAlbumSource() }
        makeChallengeReads = FirebaseBootstrap.status == .notConfigured ? nil : { FirebaseBootstrap.makeMemberChallengesRepository(context: $0) }
        makeInvites = FirebaseBootstrap.status == .notConfigured ? nil : { FirebaseBootstrap.makeInvitesRepository(context: $0) }
        makeNotifications = FirebaseBootstrap.status == .notConfigured ? nil : { FirebaseBootstrap.makeNotificationsRepository(context: $0) }
        makeSubmissionSource = {
            if let firebase = FirebaseBootstrap.makeSubmissionSource() { return firebase }
            #if DEBUG
            return MockSubmissionSource()
            #else
            return nil
            #endif
        }
        let repository = Self.makeRepository()
        self.repository = repository
        _session = State(initialValue: AccountsSession(repository: repository))
        _push = State(initialValue: MockLaunch.mode() == nil ? PushComposition.make() : nil)
    }

    var body: some Scene {
        WindowGroup {
            AccountsRootView(session: session) { context in
                memberHome(context)
                    .id(EventReadScope(uid: context.uid, companyID: context.companyID))
            }
            .task { session.start(); push?.onLink = { eventLinks.receive($0) } }
            .onChange(of: scenePhase) { _, phase in
                // Permission granted later in iOS Settings takes effect when the app returns to the foreground.
                if phase == .active { Task { await push?.refresh() } }
            }
            // The buttons drive the coordinator; the setter is a no-op so a dismissal never double-fires.
            .alert("Get updates for activities you join?", isPresented: Binding(
                get: { push?.isPrimingVisible == true }, set: { _ in })) {
                Button("Turn on notifications") { Task { await push?.primingAccepted() } }
                Button("Not now", role: .cancel) { push?.primingDeclined() }
            } message: {
                Text("We’ll tell you if an organizer changes or cancels an activity, and send reminders. You can change this for each activity in its chat.")
            }
            .onOpenURL { url in
                // Google sign-in redirects first; anything else may be an event share link or `dip://events/<id>`.
                if !FirebaseBootstrap.handle(url: url) { eventLinks.receive(url) }
            }
            // Universal Links delivered as web-browsing activities (needs the Associated Domains entitlement).
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                if let url = activity.webpageURL { eventLinks.receive(url) }
            }
        }
    }

    /// Configured builds wrap Home with the live weekly theme (one feed per membership, keyed
    /// by the same scope ID); unconfigured builds keep the fixture challenge card.
    @ViewBuilder private func memberHome(_ context: MembershipContext) -> some View {
        let home = DIPMemberHome(context: context, repository: repository, oauthPhotoURL: FirebaseBootstrap.oauthPhotoURL(), eventReadFactory: makeEventReads, participationFactory: makeParticipation, albumFactory: makeAlbums, invitesFactory: makeInvites, notificationsFactory: makeNotifications, pushPermission: push?.permissionControl, mockSnapshot: MockLaunch.snapshot(), onboarding: .standard(), bugReportSubmitter: makeBugReportSubmitter, deepLinkEventID: eventLinks.pendingEventID, onDeepLinkHandled: { eventLinks.consume($0) }, deepLinkOpensChat: eventLinks.pendingOpensChat, onJoined: { Task { await push?.didJoin() } }, onSignOut: { await push?.signingOut(); await session.signOut() })
        .task(id: context.uid) { await push?.memberSignedIn(uid: context.uid) }
        let submissions = ChallengeSubmissionContext(
            scope: ChallengeReadScope(uid: context.uid, companyID: context.companyID),
            makeSource: { makeSubmissionSource() })
        if let makeChallengeReads {
            WeeklyChallengeHost(makeRepository: { makeChallengeReads(context) }) { home }
                .environment(\.challengeSubmissionContext, submissions)
        } else {
            #if DEBUG
            home.environment(\.challengeSubmissionContext, submissions)
            #else
            home
            #endif
        }
    }

    /// Real Firebase when local configuration exists (ADR 0007). Otherwise Debug builds use
    /// the in-memory preview repository so the flow can be clicked through, and Release
    /// builds report that sign-in is not configured.
    @MainActor private static func makeRepository() -> any AccountsRepository & InterestCatalogRepository {
        #if DEBUG
        if let mock = MockLaunch.mode() { return MockLaunch.makeRepository(mock) }
        #endif
        if let firebase = FirebaseBootstrap.makeAccountsRepository() { return firebase }
        #if DEBUG
        return PreviewAccountsRepository()
        #else
        return UnconfiguredAccountsRepository()
        #endif
    }
}
