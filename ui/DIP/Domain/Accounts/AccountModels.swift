import Foundation

/// The signed-in Firebase Auth user, reduced to what the accounts flow needs.
/// Identity always comes from Auth; it is never typed in by the user.
struct AuthUser: Equatable, Sendable {
    let uid: String
    let email: String?
    let isEmailVerified: Bool
}

/// Role vocabulary from the membership contract. The app displays it but never
/// writes it: roles are server-owned (docs/contracts/data-ownership.md).
enum MembershipRole: String, Equatable, Sendable {
    case member
    case admin
}

/// The server-confirmed company membership for one user.
struct Membership: Equatable, Sendable {
    let companyId: String
    let role: MembershipRole
}

/// Inputs the user can get wrong before anything is sent.
enum AccountsField: Equatable, Sendable {
    case email
    case password
    case joinCode
    case displayName
}

/// Failures the accounts flow can show. Data adapters map Firebase Auth and
/// callable errors (including the joinCompanyV1 `reason` details) into these.
enum AccountsError: Error, Equatable, Sendable {
    case validation(AccountsField)
    case invalidCredentials
    case emailAlreadyInUse
    case weakPassword
    case invalidEmail
    case emailNotVerified
    case invalidJoinCode
    case membershipConflict
    case rateLimited
    case network
    case unknown
}
