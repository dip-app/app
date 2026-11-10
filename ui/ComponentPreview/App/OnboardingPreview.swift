import DIPAccounts
import DIPContracts
import SwiftUI

/// Test-only account entry host. Never selects or configures a real Firebase project.
///
/// `--onboarding=<account>`: welcome (work account), personal, unmapped, unconfigured, plus
/// stage review states that the in-memory repository cannot produce on its own: conflict
/// (another company), offline, limited (too many tries), problem (unknown failure) and slow
/// (company resolution held for 30 s so A2 Resolving can be captured).
struct OnboardingPreview: View {
    @State private var session: AccountsSession
    private let repository: any AccountsRepository & InterestCatalogRepository
    init(account: String) {
        let email: String? = switch account {
        case "personal": "pat@gmail.com"
        case "unmapped": "pat@unknown.test"
        case "unconfigured": nil
        default: "new@example.invalid"
        }
        let base = PreviewAccountsRepository(googleAccount: email, delay: .milliseconds(300))
        let repository: any AccountsRepository & InterestCatalogRepository = switch account {
        case "conflict": FailingResolveRepository(base: base, failure: .membershipConflict)
        case "offline": FailingResolveRepository(base: base, failure: .unavailable, hold: .milliseconds(1500))
        case "limited": FailingResolveRepository(base: base, failure: .rateLimited)
        case "problem": FailingResolveRepository(base: base, failure: .unknown)
        case "slow": FailingResolveRepository(base: base, failure: nil, hold: .seconds(30))
        default: base
        }
        self.repository = repository
        _session = State(initialValue: AccountsSession(repository: repository))
    }
    var body: some View {
        AccountsRootView(session: session) { context in
            DIPMemberHome(context: context, repository: repository, onSignOut: { await session.signOut() }).id(context.uid)
        }
            .task { session.start() }
            .onDisappear { session.stop() }
    }
}

/// Wraps the preview repository so membership resolution fails (or waits) on demand.
@MainActor
private final class FailingResolveRepository: AccountsRepository, InterestCatalogRepository {
    private let base: PreviewAccountsRepository
    private let failure: AccountsFailure?
    private let hold: Duration

    init(base: PreviewAccountsRepository, failure: AccountsFailure?, hold: Duration = .milliseconds(300)) {
        self.base = base
        self.failure = failure
        self.hold = hold
    }

    func observations() -> AsyncStream<AccountObservation> { base.observations() }
    func signInWithGoogle() async throws { try await base.signInWithGoogle() }
    func signOut() async throws { try await base.signOut() }
    func refreshIdentity() async throws { try await base.refreshIdentity() }
    func updateProfile(uid: String, _ profile: EditableProfile) async throws { try await base.updateProfile(uid: uid, profile) }
    func interestTags() async throws -> [InterestTag] { try await base.interestTags() }

    func resolveMembership() async throws -> ResolveMembershipResponse {
        try await Task.sleep(for: hold)
        if let failure { throw failure }
        return try await base.resolveMembership()
    }
}
