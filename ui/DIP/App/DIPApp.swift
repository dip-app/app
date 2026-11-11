import DIPAccounts
import DIPCore
import Foundation
import SwiftUI

@main
struct DIPApp: App {
    @State private var session: AccountsSession
    /// Event links wait here until the member shell can open them (signed out, resolving, onboarding).
    @State private var eventLinks = EventLinkInbox()
    private let makeEventReads: ((MembershipContext) -> MemberEventsRepository?)?
    private let makeParticipation: (() -> (any ParticipationSource)?)?
    private let makeBugReportSubmitter: (() -> (any BugReportSubmitting)?)
    private let makeChallengeReads: ((MembershipContext) -> MemberChallengesRepository?)?
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
        makeChallengeReads = FirebaseBootstrap.status == .notConfigured ? nil : { FirebaseBootstrap.makeMemberChallengesRepository(context: $0) }
        let repository = Self.makeRepository()
        self.repository = repository
        _session = State(initialValue: AccountsSession(repository: repository))
    }

    var body: some Scene {
        WindowGroup {
            AccountsRootView(session: session) { context in
                memberHome(context)
                    .id(EventReadScope(uid: context.uid, companyID: context.companyID))
            }
            .task { session.start() }
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
        let home = DIPMemberHome(context: context, repository: repository, oauthPhotoURL: FirebaseBootstrap.oauthPhotoURL(), eventReadFactory: makeEventReads, participationFactory: makeParticipation, mockSnapshot: MockLaunch.snapshot(), onboarding: .standard(), bugReportSubmitter: makeBugReportSubmitter, deepLinkEventID: eventLinks.pendingEventID, onDeepLinkHandled: { eventLinks.consume($0) }, onSignOut: { await session.signOut() })
        if let makeChallengeReads {
            WeeklyChallengeHost(makeRepository: { makeChallengeReads(context) }) { home }
        } else { home }
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
