import DIPAccounts
import SwiftUI

@main
struct DIPApp: App {
    @State private var session: AccountsSession
    private let makeEventReads: ((MembershipContext) -> MemberEventsRepository?)?
    private let repository: any AccountsRepository & InterestCatalogRepository

    init() {
        FirebaseBootstrap.configureIfAvailable()
        makeEventReads = FirebaseBootstrap.status == .notConfigured ? nil : { FirebaseBootstrap.makeMemberEventsRepository(context: $0) }
        let repository = Self.makeRepository()
        self.repository = repository
        _session = State(initialValue: AccountsSession(repository: repository))
    }

    var body: some Scene {
        WindowGroup {
            AccountsRootView(session: session) { context in
                DIPMemberHome(context: context, repository: repository, oauthPhotoURL: FirebaseBootstrap.oauthPhotoURL(), eventReadFactory: makeEventReads, onSignOut: { await session.signOut() })
                    .id(EventReadScope(uid: context.uid, companyID: context.companyID))
            }
            .task { session.start() }
            .onOpenURL { url in _ = FirebaseBootstrap.handle(url: url) }
        }
    }

    /// Real Firebase when local configuration exists (ADR 0007). Otherwise Debug builds use
    /// the in-memory preview repository so the flow can be clicked through, and Release
    /// builds report that sign-in is not configured.
    @MainActor private static func makeRepository() -> any AccountsRepository & InterestCatalogRepository {
        if let firebase = FirebaseBootstrap.makeAccountsRepository() { return firebase }
        #if DEBUG
        return PreviewAccountsRepository()
        #else
        return UnconfiguredAccountsRepository()
        #endif
    }
}
