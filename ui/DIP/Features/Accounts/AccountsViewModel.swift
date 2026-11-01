import Foundation
import Observation

/// Where the user is in the account flow.
enum AccountPhase: Equatable, Sendable {
    /// Restoring a persisted session at launch.
    case restoring
    case signedOut
    /// Signed in but the email is not verified; membership is not allowed yet.
    case verificationRequired(email: String)
    /// Verified, with no company yet: show the join-code screen.
    case needsMembership(AuthUser)
    /// Verified, but loading the stored membership failed; offer retry.
    case membershipUnavailable(AuthUser)
    case member(ActiveMembership)
}

/// Drives sign-up, sign-in, email verification, company join and sign-out.
/// Views render `phase`, `isWorking` and `error`, and call the actions.
///
/// Guarantees (covered by AccountsViewModelTests):
/// - A failed join never moves to `.member`.
/// - While a request is in flight, further actions are ignored (no double submit).
/// - Sign-out clears membership and error state, and results of requests that
///   started before sign-out are discarded.
@MainActor
@Observable
final class AccountsViewModel: MembershipContext {
    nonisolated static let minimumPasswordLength = 6
    nonisolated static let maximumJoinCodeLength = 64
    nonisolated static let maximumDisplayNameLength = 80

    private(set) var phase: AccountPhase = .restoring
    private(set) var isWorking = false
    private(set) var error: AccountsError?

    private let auth: any AuthService
    private let memberships: any MembershipService
    /// Incremented on sign-out so late results from the previous session are dropped.
    @ObservationIgnored private var generation = 0

    init(auth: any AuthService, memberships: any MembershipService) {
        self.auth = auth
        self.memberships = memberships
    }

    var activeMembership: ActiveMembership? {
        if case .member(let membership) = phase { return membership }
        return nil
    }

    // MARK: Actions

    /// Call once at launch to restore a persisted session.
    func restoreSession() async {
        await perform { generation in
            guard let user = await self.auth.currentUser() else {
                self.phase = .signedOut
                return
            }
            try await self.route(user, generation: generation)
        }
    }

    func signIn(email: String, password: String) async {
        let email = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !email.isEmpty else { return fail(.validation(.email)) }
        guard !password.isEmpty else { return fail(.validation(.password)) }
        await perform { generation in
            let user = try await self.auth.signIn(email: email, password: password)
            try await self.route(user, generation: generation)
        }
    }

    func signUp(email: String, password: String) async {
        let email = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !email.isEmpty else { return fail(.validation(.email)) }
        guard password.count >= Self.minimumPasswordLength else { return fail(.weakPassword) }
        await perform { generation in
            let user = try await self.auth.signUp(email: email, password: password)
            guard generation == self.generation else { return }
            self.phase = .verificationRequired(email: user.email ?? email)
            try await self.auth.sendEmailVerification()
        }
    }

    func resendVerificationEmail() async {
        guard case .verificationRequired = phase else { return }
        await perform { _ in try await self.auth.sendEmailVerification() }
    }

    /// Call after the user says they opened the verification link.
    func checkVerification() async {
        guard case .verificationRequired = phase else { return }
        await perform { generation in
            guard let user = try await self.auth.reloadUser() else {
                guard generation == self.generation else { return }
                self.phase = .signedOut
                return
            }
            guard user.isEmailVerified else { throw AccountsError.emailNotVerified }
            try await self.route(user, generation: generation)
        }
    }

    func joinCompany(joinCode: String, displayName: String) async {
        guard case .needsMembership(let user) = phase else { return }
        let code = joinCode.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty, code.count <= Self.maximumJoinCodeLength else { return fail(.validation(.joinCode)) }
        guard !name.isEmpty, name.count <= Self.maximumDisplayNameLength else { return fail(.validation(.displayName)) }
        await perform { generation in
            do {
                let membership = try await self.memberships.joinCompany(joinCode: code, displayName: name)
                guard generation == self.generation else { return }
                self.phase = .member(ActiveMembership(uid: user.uid, companyId: membership.companyId, role: membership.role))
            } catch AccountsError.emailNotVerified {
                // The server is the authority on verification; send the user back to verify.
                guard generation == self.generation else { return }
                self.phase = .verificationRequired(email: user.email ?? "")
                throw AccountsError.emailNotVerified
            }
        }
    }

    func retryLoadingMembership() async {
        guard case .membershipUnavailable(let user) = phase else { return }
        await perform { generation in try await self.route(user, generation: generation) }
    }

    /// Always succeeds locally: tenant state is cleared even if the SDK call fails.
    func signOut() async {
        generation += 1
        phase = .signedOut
        error = nil
        isWorking = false
        try? await auth.signOut()
    }

    func dismissError() {
        error = nil
    }

    // MARK: Private

    private func route(_ user: AuthUser, generation: Int) async throws {
        guard generation == self.generation else { return }
        guard user.isEmailVerified else {
            phase = .verificationRequired(email: user.email ?? "")
            return
        }
        do {
            let membership = try await memberships.loadMembership(uid: user.uid)
            guard generation == self.generation else { return }
            if let membership {
                phase = .member(ActiveMembership(uid: user.uid, companyId: membership.companyId, role: membership.role))
            } else {
                phase = .needsMembership(user)
            }
        } catch {
            guard generation == self.generation else { return }
            phase = .membershipUnavailable(user)
            throw error
        }
    }

    private func perform(_ work: (Int) async throws -> Void) async {
        guard !isWorking else { return }
        let generation = self.generation
        isWorking = true
        error = nil
        do {
            try await work(generation)
        } catch {
            if generation == self.generation {
                self.error = (error as? AccountsError) ?? .unknown
            }
        }
        if generation == self.generation {
            isWorking = false
        }
    }

    private func fail(_ error: AccountsError) {
        guard !isWorking else { return }
        self.error = error
    }
}
