#if DEBUG
import Foundation

/// In-memory stand-ins for previews, unit tests, and other packets' work until
/// the Firebase adapters land. They mirror the contract's behavior (verified
/// email required, code normalization, same-company replay, cross-company
/// conflict) but are not evidence that the real backend behaves this way.
actor FakeAuthService: AuthService {
    struct Account: Sendable {
        var uid: String
        var password: String
        var isEmailVerified: Bool
    }

    private var accounts: [String: Account] = [:]
    private var signedInEmail: String?
    private var nextUID = 1

    /// When set, the next call to any method throws this error once.
    var nextError: AccountsError?
    private(set) var verificationEmailsSent = 0

    init(accounts: [String: Account] = [:], signedInEmail: String? = nil) {
        self.accounts = accounts
        self.signedInEmail = signedInEmail
    }

    // Test controls
    func setNextError(_ error: AccountsError?) { nextError = error }
    func markVerified(email: String) { accounts[email]?.isEmailVerified = true }

    // AuthService
    func currentUser() async -> AuthUser? {
        guard let email = signedInEmail else { return nil }
        return user(for: email)
    }

    func signIn(email: String, password: String) async throws -> AuthUser {
        try consumeError()
        guard let account = accounts[email], account.password == password else {
            throw AccountsError.invalidCredentials
        }
        signedInEmail = email
        return AuthUser(uid: account.uid, email: email, isEmailVerified: account.isEmailVerified)
    }

    func signUp(email: String, password: String) async throws -> AuthUser {
        try consumeError()
        guard email.contains("@") else { throw AccountsError.invalidEmail }
        guard accounts[email] == nil else { throw AccountsError.emailAlreadyInUse }
        let uid = "fake-user-\(nextUID)"
        nextUID += 1
        accounts[email] = Account(uid: uid, password: password, isEmailVerified: false)
        signedInEmail = email
        return AuthUser(uid: uid, email: email, isEmailVerified: false)
    }

    func sendEmailVerification() async throws {
        try consumeError()
        verificationEmailsSent += 1
    }

    func reloadUser() async throws -> AuthUser? {
        try consumeError()
        guard let email = signedInEmail else { return nil }
        return user(for: email)
    }

    func signOut() async throws {
        signedInEmail = nil
    }

    private func user(for email: String) -> AuthUser? {
        accounts[email].map { AuthUser(uid: $0.uid, email: email, isEmailVerified: $0.isEmailVerified) }
    }

    private func consumeError() throws {
        if let error = nextError {
            nextError = nil
            throw error
        }
    }
}

actor FakeMembershipService: MembershipService {
    private let auth: FakeAuthService
    /// Normalized join code -> companyId.
    private var companiesByCode: [String: String]
    private var memberships: [String: Membership]
    private var suspendJoins = false
    private var pendingJoin: CheckedContinuation<Void, Never>?

    private(set) var joinCallCount = 0
    var nextError: AccountsError?

    init(auth: FakeAuthService, companiesByCode: [String: String] = [:], memberships: [String: Membership] = [:]) {
        self.auth = auth
        self.companiesByCode = companiesByCode
        self.memberships = memberships
    }

    // Test controls
    func setNextError(_ error: AccountsError?) { nextError = error }
    /// Makes joins wait until `releaseJoins()`, to test in-flight behavior.
    func holdJoins() { suspendJoins = true }
    func releaseJoins() {
        suspendJoins = false
        pendingJoin?.resume()
        pendingJoin = nil
    }

    // MembershipService
    func loadMembership(uid: String) async throws -> Membership? {
        if let error = nextError {
            nextError = nil
            throw error
        }
        return memberships[uid]
    }

    func joinCompany(joinCode: String, displayName: String) async throws -> Membership {
        joinCallCount += 1
        if suspendJoins {
            await withCheckedContinuation { pendingJoin = $0 }
        }
        if let error = nextError {
            nextError = nil
            throw error
        }
        guard let user = await auth.currentUser(), user.isEmailVerified else {
            throw AccountsError.emailNotVerified
        }
        let normalized = joinCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard let companyId = companiesByCode[normalized] else { throw AccountsError.invalidJoinCode }
        if let existing = memberships[user.uid] {
            guard existing.companyId == companyId else { throw AccountsError.membershipConflict }
            return existing
        }
        let membership = Membership(companyId: companyId, role: .member)
        memberships[user.uid] = membership
        return membership
    }
}

/// Fixed context for previews and other features' tests.
@MainActor
final class StaticMembershipContext: MembershipContext {
    var activeMembership: ActiveMembership?

    init(_ membership: ActiveMembership? = ActiveMembership(uid: "member-demo", companyId: "company-demo", role: .member)) {
        activeMembership = membership
    }
}

extension AccountsViewModel {
    /// Preview/demo wiring matching the shared seed (`DEMO-2026` -> company-demo).
    static func demo() -> AccountsViewModel {
        let auth = FakeAuthService(accounts: [
            "member@example.invalid": .init(uid: "member-demo", password: "password", isEmailVerified: true),
            "new@example.invalid": .init(uid: "new-demo", password: "password", isEmailVerified: true),
        ])
        let memberships = FakeMembershipService(
            auth: auth,
            companiesByCode: ["DEMO-2026": "company-demo"],
            memberships: ["member-demo": Membership(companyId: "company-demo", role: .member)]
        )
        return AccountsViewModel(auth: auth, memberships: memberships)
    }
}
#endif
