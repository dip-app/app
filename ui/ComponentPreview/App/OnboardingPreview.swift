import DIPAccounts
import DIPContracts
import SwiftUI

/// Test-only account entry host. Never selects or configures a real Firebase project.
///
/// `--onboarding=<account>`: welcome (work account), personal, unmapped, unconfigured, plus
/// stage review states that the in-memory repository cannot produce on its own: conflict
/// (another company), offline, limited (too many tries), problem (unknown failure) and slow
/// (company resolution held for 30 s so A2 Resolving can be captured).
///
/// `member` starts signed in as the preview member (Sam Rivera); `member-save-fails` also fails the first
/// profile save. `--onboarding-tour` turns on the post-membership tour with its Debug launch arguments.
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
        let signedIn = account.hasPrefix("member") ? "member@example.invalid" : nil
        let base = PreviewAccountsRepository(googleAccount: email, signedInEmail: signedIn, delay: .milliseconds(300))
        let repository: any AccountsRepository & InterestCatalogRepository = switch account {
        case "conflict": FailingResolveRepository(base: base, failure: .membershipConflict)
        case "offline": FailingResolveRepository(base: base, failure: .unavailable, hold: .milliseconds(1500))
        case "limited": FailingResolveRepository(base: base, failure: .rateLimited)
        case "problem": FailingResolveRepository(base: base, failure: .unknown)
        case "slow": FailingResolveRepository(base: base, failure: nil, hold: .seconds(30))
        case "member-save-fails": FailingResolveRepository(base: base, failure: nil, failSaves: 1)
        default: base
        }
        self.repository = repository
        _session = State(initialValue: AccountsSession(repository: repository))
    }
    var body: some View {
        AccountsRootView(session: session) { context in
            DIPMemberHome(context: context, repository: repository,
                          onboarding: ProcessInfo.processInfo.arguments.contains("--onboarding-tour") ? .standard() : nil,
                          onSignOut: { await session.signOut() }).id(context.uid)
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
    private var failSaves: Int

    init(base: PreviewAccountsRepository, failure: AccountsFailure?, hold: Duration = .milliseconds(300), failSaves: Int = 0) {
        self.base = base
        self.failure = failure
        self.hold = hold
        self.failSaves = failSaves
    }

    func observations() -> AsyncStream<AccountObservation> { base.observations() }
    func signInWithGoogle() async throws { try await base.signInWithGoogle() }
    func signOut() async throws { try await base.signOut() }
    func refreshIdentity() async throws { try await base.refreshIdentity() }
    func updateProfile(uid: String, _ profile: EditableProfile) async throws {
        if failSaves > 0 {
            failSaves -= 1
            try await Task.sleep(for: .milliseconds(400))
            throw AccountsFailure.unavailable
        }
        try await base.updateProfile(uid: uid, profile)
    }
    func interestTags() async throws -> [InterestTag] { try await base.interestTags() }

    func resolveMembership() async throws -> ResolveMembershipResponse {
        try await Task.sleep(for: hold)
        if let failure { throw failure }
        return try await base.resolveMembership()
    }
}
