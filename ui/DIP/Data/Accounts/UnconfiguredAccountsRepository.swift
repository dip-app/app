import DIPAccounts
import DIPContracts
import Foundation

/// Used by Release builds that have no Firebase configuration: always signed out, and
/// sign-in reports `.notConfigured` instead of pretending to work.
@MainActor
final class UnconfiguredAccountsRepository: AccountsRepository, InterestCatalogRepository {
    func observations() -> AsyncStream<AccountObservation> {
        AsyncStream { continuation in continuation.yield(.identity(nil)) }
    }
    func signInWithGoogle() async throws { throw AccountsFailure.notConfigured }
    func signOut() async throws {}
    func refreshIdentity() async throws { throw AccountsFailure.notConfigured }
    func resolveMembership() async throws -> ResolveMembershipResponse { throw AccountsFailure.notConfigured }
    func updateProfile(uid: String, _ profile: EditableProfile) async throws { throw AccountsFailure.notConfigured }
    func interestTags() async throws -> [InterestTag] { throw AccountsFailure.notConfigured }
}
