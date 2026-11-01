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
public enum AccountsFailure: String, Error, Equatable, Sendable {
    case unauthenticated, invalidCredentials, emailAlreadyInUse, invalidInput, permissionDenied
    case invalidJoinCode, membershipConflict, rateLimited, unavailable, invalidProfile, unknown
}
public enum AccountObservation: Sendable {
    case identity(AccountIdentity?)
    case profile(uid: String, AppUser?)
    case failure(uid: String?, AccountsFailure)
}
/// All listeners belong to the returned stream. Termination must remove SDK listeners.
@MainActor public protocol AccountsRepository: AnyObject {
    func observations() -> AsyncStream<AccountObservation>
    func signUp(email: String, password: String) async throws
    func signIn(email: String, password: String) async throws
    func signOut() async throws
    func sendVerification() async throws
    func refreshIdentity() async throws
    func joinCompany(_ request: JoinCompanyRequest) async throws -> JoinCompanyResponse
    func updateProfile(_ profile: EditableProfile) async throws
}
/// Exactly the V1 client-owned fields; no membership, email, balances or audit fields.
public struct EditableProfile: Equatable, Sendable {
    public var displayName: String
    public var photoURL: String
    public var avatarId: String
    public var department: String
    public var jobTitle: String
    public var city: String
    public var interestTagIds: [String]
    public var travelRadiusMiles: Int
    public var availability: [String]
    public init(displayName: String, photoURL: String, avatarId: String, department: String, jobTitle: String, city: String, interestTagIds: [String], travelRadiusMiles: Int, availability: [String]) {
        self.displayName = displayName; self.photoURL = photoURL; self.avatarId = avatarId
        self.department = department; self.jobTitle = jobTitle; self.city = city
        self.interestTagIds = interestTagIds; self.travelRadiusMiles = travelRadiusMiles; self.availability = availability
    }
}
public enum AccountsState: Equatable, Sendable {
    case signedOut, authenticationPending, verificationRequired(AccountIdentity), needsCompany(AccountIdentity)
    case member(MembershipContext)
    case recoverableError(AccountsFailure)
}
@MainActor @Observable public final class AccountsSession {
    public private(set) var state: AccountsState = .authenticationPending
    public private(set) var isSubmitting = false
    public private(set) var commandError: AccountsFailure?
    private let repository: any AccountsRepository
    private var identity: AccountIdentity?
    @ObservationIgnored private var observationTask: Task<Void, Never>?
    public init(repository: any AccountsRepository) { self.repository = repository }
    public func start() {
        stop(); state = .authenticationPending
        let stream = repository.observations()
        observationTask = Task { [weak self] in
            for await event in stream { guard !Task.isCancelled else { break }; self?.receive(event) }
        }
    }
    public func stop() { observationTask?.cancel(); observationTask = nil; identity = nil; state = .signedOut }
    deinit { observationTask?.cancel() }
    private func receive(_ event: AccountObservation) {
        switch event {
        case .identity(let value):
            let changed = identity != value; identity = value
            guard let value else { state = .signedOut; return }
            if changed { state = value.isEmailVerified ? .authenticationPending : .verificationRequired(value) }
        case .profile(let uid, let profile):
            guard let identity, identity.uid == uid else { return }
            guard identity.isEmailVerified else { state = .verificationRequired(identity); return }
            guard let profile else { state = .needsCompany(identity); return }
            do { state = .member(try MembershipContext(uid: uid, profile: profile)) }
            catch { state = .recoverableError(.invalidProfile) }
        case .failure(let uid, let error):
            guard uid == nil || uid == identity?.uid else { return }
            state = .recoverableError(error)
        }
    }
    private func command(_ body: () async throws -> Void) async {
        guard !isSubmitting else { return }; isSubmitting = true; commandError = nil
        defer { isSubmitting = false }
        do { try await body() } catch { commandError = error as? AccountsFailure ?? .unknown }
    }
    public func signUp(email: String, password: String) async {
        guard !isSubmitting else { return }; identity = nil; state = .authenticationPending
        await command { try await repository.signUp(email: email, password: password) }
        if let commandError { state = .recoverableError(commandError) }
    }
    public func signIn(email: String, password: String) async {
        guard !isSubmitting else { return }; identity = nil; state = .authenticationPending
        await command { try await repository.signIn(email: email, password: password) }
        if let commandError { state = .recoverableError(commandError) }
    }
    public func signOut() async {
        guard !isSubmitting else { return }
        // Clear private state before awaiting any remote work, even when sign-out fails.
        state = .authenticationPending; identity = nil
        await command { try await repository.signOut(); state = .signedOut }
        if let commandError { state = .recoverableError(commandError) }
    }
    public func sendVerification() async { await command { try await repository.sendVerification() } }
    public func refreshIdentity() async { await command { try await repository.refreshIdentity() } }
    public func joinCompany(code: String, displayName: String) async {
        await command {
            guard identity?.isEmailVerified == true else { throw AccountsFailure.permissionDenied }
            _ = try await repository.joinCompany(.init(contractVersion: 1, joinCode: code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(), displayName: displayName))
        }
    }
    public func updateProfile(_ profile: EditableProfile) async { await command { try await repository.updateProfile(profile) } }
}

extension EditableProfile {
    /// These V1 limits mirror profile rules; they do not change generated wire schemas.
    public func validate() throws {
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        func validList(_ values: [String]) -> Bool { values.count <= 10 && values.allSatisfy { !$0.isEmpty && $0.count <= 120 } }
        guard !name.isEmpty, name == displayName, name.count <= 80, photoURL.count <= 2048,
              [avatarId, department, jobTitle, city].allSatisfy({ $0.count <= 120 }),
              validList(interestTagIds), validList(availability), (0...500).contains(travelRadiusMiles)
        else { throw AccountsFailure.invalidInput }
    }
}
