import DIPAccounts
import SwiftUI

@main
struct DIPApp: App {
    @State private var session: AccountsSession

    init() {
        FirebaseBootstrap.configureIfAvailable()
        _session = State(initialValue: AccountsSession(repository: Self.makeRepository()))
    }

    var body: some Scene {
        WindowGroup {
            AccountsRootView(session: session) { context in
                // Replaced by the events home screen when packets 03/04 land.
                SignedInPlaceholderView(session: session, context: context)
            }
            .task { session.start() }
            .onOpenURL { url in _ = FirebaseBootstrap.handle(url: url) }
        }
    }

    /// Real Firebase when local configuration exists (ADR 0007). Otherwise Debug builds use
    /// the in-memory preview repository so the flow can be clicked through, and Release
    /// builds report that sign-in is not configured.
    @MainActor private static func makeRepository() -> any AccountsRepository {
        if let firebase = FirebaseBootstrap.makeAccountsRepository() { return firebase }
        #if DEBUG
        return PreviewAccountsRepository()
        #else
        return UnconfiguredAccountsRepository()
        #endif
    }
}
