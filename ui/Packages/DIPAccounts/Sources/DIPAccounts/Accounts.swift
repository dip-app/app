import Foundation
import Observation
import DIPContracts

public struct AccountIdentity: Equatable, Sendable {
    public let uid: String
    public let isEmailVerified: Bool
    public init(uid: String, isEmailVerified: Bool) { self.uid = uid; self.isEmailVerified = isEmailVerified }
}
public struct MembershipContext: Equatable, Sendable {
    public let uid: String
    public let profile: AppUser
    public var companyID: String { profile.companyId }
    public var role: String { profile.role }
    public init(uid: String, profile: AppUser) throws {
        guard !uid.isEmpty, profile.id == uid, !profile.companyId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              ["member", "admin"].contains(profile.role) else { throw AccountsFailure.invalidProfile }
        self.uid = uid; self.profile = profile
    }
}
/// Portable account failures. Adapters map SDK and callable errors (including
/// resolveMembershipV1 `reason` details) into these; views map them to text.
public enum AccountsFailure: String, Error, Equatable, Sendable {
    /// The user closed the Google sign-in sheet. Not shown as an error.
    case cancelled
    /// Firebase / Google sign-in is not configured on this build (no GoogleService-Info.plist).
    case notConfigured
    case unauthenticated, invalidInput, permissionDenied
    /// Signed in with a personal Google account (gmail.com etc.), ADR 0007.
    case personalEmailDomain
    /// The account's root email domain is not mapped to a company, ADR 0007.
    case noCompanyForDomain
    case membershipConflict, rateLimited, unavailable, invalidProfile, unknown
}
public enum AccountObservation: Sendable {
    case identity(AccountIdentity?)
    case profile(uid: String, AppUser?)
    case failure(uid: String?, AccountsFailure)
}
/// All listeners belong to the returned stream. Termination must remove SDK listeners.
@MainActor public protocol AccountsRepository: AnyObject {
    func observations() -> AsyncStream<AccountObservation>
    /// Presents Google sign-in and signs in to Firebase Auth with the result (ADR 0007: Google only).
    func signInWithGoogle() async throws
    func signOut() async throws
    func refreshIdentity() async throws
    /// Calls resolveMembershipV1: the server derives the company from the verified email domain.
    func resolveMembership() async throws -> ResolveMembershipResponse
    /// Writes the allowlisted fields of `uid`'s own profile. Adapters MUST refuse when the
    /// signed-in user is not `uid`, so a stale editor can never write into another account.
    func updateProfile(uid: String, _ profile: EditableProfile) async throws
}
/// Exactly the V1 client-owned fields. Display name comes from OAuth and is
/// server-written (ADR 0007); membership, email, balances and audit fields are server-owned.
public struct EditableProfile: Equatable, Sendable {
    public var photoURL: String
    public var avatarId: String
    public var department: String
    public var jobTitle: String
    public var city: String
    public var interestTagIds: [String]
    public var travelRadiusMiles: Int
    public var availability: [String]
    public init(photoURL: String, avatarId: String, department: String, jobTitle: String, city: String, interestTagIds: [String], travelRadiusMiles: Int, availability: [String]) {
        self.photoURL = photoURL; self.avatarId = avatarId
        self.department = department; self.jobTitle = jobTitle; self.city = city
        self.interestTagIds = interestTagIds; self.travelRadiusMiles = travelRadiusMiles; self.availability = availability
    }
}
public enum AccountsState: Equatable, Sendable {
    case signedOut, authenticationPending
    /// Signed in; resolveMembershipV1 is matching the email domain to a company.
    case resolvingCompany(AccountIdentity)
    /// Signed in, but no company access: `personalEmailDomain`, `noCompanyForDomain`,
    /// `membershipConflict` or `permissionDenied`. Never grants tenant content.
    case noCompany(AccountIdentity, AccountsFailure)
    case member(MembershipContext)
    case recoverableError(AccountsFailure)
}
@MainActor @Observable public final class AccountsSession {
    /// Failures that mean "this account has no company", shown as `.noCompany`.
    nonisolated public static let noCompanyFailures: Set<AccountsFailure> = [.personalEmailDomain, .noCompanyForDomain, .membershipConflict, .permissionDenied]

    public private(set) var state: AccountsState = .authenticationPending
    public private(set) var isSubmitting = false
    public private(set) var commandError: AccountsFailure?
    private let repository: any AccountsRepository
    private var identity: AccountIdentity?
    private var generation = 0
    /// UID whose membership resolution already ran in this generation (no automatic retry loops).
    private var resolvedUID: String?
    @ObservationIgnored private var observationTask: Task<Void, Never>?
    @ObservationIgnored private var resolveTask: Task<Void, Never>?
    public init(repository: any AccountsRepository) { self.repository = repository }
    public func start() {
        stop(); state = .authenticationPending
        let generation = generation
        let stream = repository.observations()
        observationTask = Task { [weak self] in
            for await event in stream {
                guard !Task.isCancelled, self?.generation == generation else { break }
                self?.receive(event)
            }
            guard !Task.isCancelled, let self, self.generation == generation else { return }
            self.identity = nil
            self.state = .recoverableError(.unavailable)
        }
    }
    public func stop() {
        generation += 1
        observationTask?.cancel(); observationTask = nil
        resolveTask?.cancel(); resolveTask = nil
        identity = nil; resolvedUID = nil; state = .signedOut; isSubmitting = false; commandError = nil
    }
    deinit { observationTask?.cancel(); resolveTask?.cancel() }
    private func receive(_ event: AccountObservation) {
        switch event {
        case .identity(let value):
            let changed = identity != value; identity = value
            guard let value else { state = .signedOut; resolvedUID = nil; return }
            if changed {
                resolveTask?.cancel(); resolveTask = nil; resolvedUID = nil
                // Google accounts are verified; anything else cannot reach company data.
                state = value.isEmailVerified ? .authenticationPending : .noCompany(value, .permissionDenied)
            }
        case .profile(let uid, let profile):
            guard let identity, identity.uid == uid, identity.isEmailVerified else { return }
            guard let profile else { beginResolving(identity); return }
            do { state = .member(try MembershipContext(uid: uid, profile: profile)) }
            catch { state = .recoverableError(.invalidProfile) }
        case .failure(let uid, let error):
            guard uid == nil || uid == identity?.uid else { return }
            state = .recoverableError(error)
        }
    }
    /// No stored profile: ask the server once per identity. The profile listener,
    /// not the acknowledgement, moves the session to `.member`.
    private func beginResolving(_ identity: AccountIdentity) {
        if case .noCompany(let current, _) = state, current == identity { return }
        state = .resolvingCompany(identity)
        guard resolvedUID != identity.uid else { return }
        resolvedUID = identity.uid
        let generation = generation
        resolveTask = Task { [weak self] in
            guard let self else { return }
            do { _ = try await self.repository.resolveMembership() }
            catch {
                guard !Task.isCancelled, self.generation == generation, self.identity == identity else { return }
                let failure = error as? AccountsFailure ?? .unknown
                self.state = Self.noCompanyFailures.contains(failure) ? .noCompany(identity, failure) : .recoverableError(failure)
            }
        }
    }
    @discardableResult private func command(_ body: () async throws -> Void) async -> Bool {
        guard !isSubmitting else { return false }
        let generation = generation
        isSubmitting = true; commandError = nil
        defer { if self.generation == generation { isSubmitting = false } }
        do { try await body() }
        catch {
            guard self.generation == generation else { return false }
            let failure = error as? AccountsFailure ?? .unknown
            // Closing the Google sheet is a user choice, not an error.
            commandError = failure == .cancelled ? nil : failure
        }
        return self.generation == generation
    }
    public func signInWithGoogle() async {
        guard !isSubmitting else { return }
        guard await command({ try await repository.signInWithGoogle() }) else { return }
        if let commandError { state = .recoverableError(commandError) }
    }
    public func signOut() async {
        guard !isSubmitting else { return }
        // Clear private state before awaiting any remote work, even when sign-out fails.
        state = .authenticationPending; identity = nil; resolvedUID = nil
        resolveTask?.cancel(); resolveTask = nil
        guard await command({ try await repository.signOut() }) else { return }
        if let commandError { state = .recoverableError(commandError) } else { state = .signedOut }
    }
    /// Retries company resolution after a no-company or transient failure.
    public func retryMembership() async {
        guard let identity, identity.isEmailVerified, !isSubmitting else { return }
        resolvedUID = nil; state = .resolvingCompany(identity)
        guard await command({ try await repository.refreshIdentity() }) else { return }
        if commandError == nil, case .resolvingCompany = state { beginResolving(identity) }
    }
    public func refreshIdentity() async { await command { try await repository.refreshIdentity() } }
    public func updateProfile(_ profile: EditableProfile) async {
        guard case .member(let context) = state else { commandError = .unauthenticated; return }
        await command { try await repository.updateProfile(uid: context.uid, profile) }
    }
}

extension EditableProfile {
    /// These V1 limits mirror profile rules; they do not change generated wire schemas.
    public func validate() throws {
        func validList(_ values: [String]) -> Bool { values.count <= 10 && values.allSatisfy { !$0.isEmpty && $0.count <= 120 } }
        guard photoURL.count <= 2048,
              [avatarId, department, jobTitle, city].allSatisfy({ $0.count <= 120 }),
              validList(interestTagIds), validList(availability), (0...500).contains(travelRadiusMiles)
        else { throw AccountsFailure.invalidInput }
    }
}
