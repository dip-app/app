import DIPAccounts
import SwiftUI

@main
struct DIPApp: App {
    @State private var session: AccountsSession
    private let repository: any AccountsRepository & InterestCatalogRepository

    init() {
        FirebaseBootstrap.configureIfAvailable()
        let repository = Self.makeRepository()
        self.repository = repository
        _session = State(initialValue: AccountsSession(repository: repository))
    }

    var body: some Scene {
        WindowGroup {
            AccountsRootView(session: session) { context in
                DIPMemberHome(context: context, repository: repository, onSignOut: { await session.signOut() })
                    .id(context.uid)
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
