import DIPAccounts
import DIPCore
import Foundation
import SwiftUI
import UIKit

@main
struct DIPApp: App {
    @State private var session: AccountsSession
    /// Event links wait here until the member shell can open them (signed out, resolving, onboarding).
    @State private var eventLinks = EventLinkInbox()
    /// Push client; nil unless the feature flag is on and Firebase is configured (device-unverified, see PushRegistration.swift).
    @State private var push: PushCoordinator?
    /// The uid of the last signed-in (or resolving) account, so a transition to signed out / another account is seen once.
    @State private var signedInUID: String?
    /// Forwards the APNs token to FCM explicitly (SwiftUI lifecycle); inert unless the push flag is on.
    @UIApplicationDelegateAdaptor(DIPAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    private let makeEventReads: ((MembershipContext) -> MemberEventsRepository?)?
    private let makeParticipation: (() -> (any ParticipationSource)?)?
    private let makeBugReportSubmitter: (() -> (any BugReportSubmitting)?)
    private let makeAlbums: (() -> (any PhotoAlbumSource)?)?
    private let makeChallengeReads: ((MembershipContext) -> MemberChallengesRepository?)?
    private let makeInvites: ((MembershipContext) -> (any DIPInvitesRepository)?)?
    private let makeNotifications: ((MembershipContext) -> (any DIPNotificationsRepository)?)?
    private let makeNotificationPreferences: ((MembershipContext) -> (any DIPNotificationPreferencesRepository)?)?
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
        makeNotificationPreferences = FirebaseBootstrap.status == .notConfigured ? nil : { FirebaseBootstrap.makeNotificationPreferencesRepository(context: $0) }
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
            .dipDuoLayout()
            .task {
                session.start(); push?.onLink = { eventLinks.receive($0) }
                // Launch: finish any push cleanup a previous sign-out could not complete (token deletion needs no sign-in).
                await push?.refresh()
            }
            .onChange(of: session.state) { _, state in sessionStateChanged(state) }
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

    /// The ONE place that reacts to a session ending, whichever path caused it (Profile or tour button, an expired or
    /// revoked session, another account signing in). Local wipes happen only here, i.e. once the account is really
    /// signed out or replaced, never before a remote sign-out that may still fail.
    private func sessionStateChanged(_ state: AccountsState) {
        let uid: String? = switch state {
        case .member(let context): context.uid
        case .resolvingCompany(let identity), .noCompany(let identity, _): identity.uid
        default: nil
        }
        if let uid {
            if let previous = signedInUID, previous != uid { sessionEnded(uid: previous) }
            signedInUID = uid
        } else if state == .signedOut, let previous = signedInUID {
            signedInUID = nil
            sessionEnded(uid: previous)
        }
    }

    private func sessionEnded(uid: String) {
        eventLinks.clear()
        // Stops the calendar observer and late writes of that account's models, and lets the next home start fresh.
        HomeScope.evictAll(uid: uid)
        // Idempotent: the sign-out button already did this while the auth was still valid.
        Task { await push?.signingOut() }
        // Calendar preferences and the entries DIP added belong to this account on this device (all builds).
        DIPCalendarLocalStore(uid: uid).removeAll()
        // Queued reports belong to this account on this device; they are not kept for the next person.
        if let submitter = makeBugReportSubmitter() {
            Task { await BugReportContext.make(uid: uid, submitter: submitter).sender.discardQueue(uid: uid) }
        }
        #if DEBUG
        // Debug builds also forget this account's tour record so the next sign-in plays the whole tour again.
        UserDefaultsOnboardingRecordStore(defaults: .standard).removeRecord(for: uid)
        #endif
    }

    /// Configured builds wrap Home with the live weekly theme (one feed per membership, keyed
    /// by the same scope ID); unconfigured builds keep the fixture challenge card.
    @ViewBuilder private func memberHome(_ context: MembershipContext) -> some View {
        let home = DIPMemberHome(context: context, repository: repository, oauthPhotoURL: FirebaseBootstrap.oauthPhotoURL(), eventReadFactory: makeEventReads, participationFactory: makeParticipation, albumFactory: makeAlbums, invitesFactory: makeInvites, notificationsFactory: makeNotifications, notificationPreferencesFactory: makeNotificationPreferences, pushPermission: push?.permissionControl, mockSnapshot: MockLaunch.snapshot(), onboarding: .standard(), bugReportSubmitter: makeBugReportSubmitter, deepLinkEventID: eventLinks.pendingEventID, onDeepLinkHandled: { eventLinks.consume($0) }, deepLinkOpensChat: eventLinks.pendingOpensChat, onJoined: { Task { await push?.didJoin() } }, onSignOut: { await push?.signingOut(); await session.signOut() })
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
