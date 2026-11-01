import Foundation

/// Email/password authentication. Implemented over Firebase Auth in Data;
/// fakes in Data/Accounts back previews and tests.
protocol AuthService: Sendable {
    /// The persisted signed-in user, if any (used to restore a session on launch).
    func currentUser() async -> AuthUser?
    func signIn(email: String, password: String) async throws -> AuthUser
    /// Creates the account and signs it in. Does not send verification by itself.
    func signUp(email: String, password: String) async throws -> AuthUser
    func sendEmailVerification() async throws
    /// Refreshes the current user from the server (e.g. after the verification link is opened).
    func reloadUser() async throws -> AuthUser?
    func signOut() async throws
}

/// Company membership. Reads the user's own server-owned membership and calls
/// the `joinCompanyV1` callable; the server derives the caller from Auth.
protocol MembershipService: Sendable {
    /// The stored membership for `uid`, or nil when the user has not joined a company.
    func loadMembership(uid: String) async throws -> Membership?
    func joinCompany(joinCode: String, displayName: String) async throws -> Membership
}
