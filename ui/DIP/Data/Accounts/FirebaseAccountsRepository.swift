import Foundation
import CoreFoundation
import DIPAccounts
import DIPContracts
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseFunctions

/// Inject configured SDK instances after emulator routing, before creating listeners.
/// The Functions instance MUST be Functions.functions(region: FirebaseAccountsRepository.region).
@MainActor final class FirebaseAccountsRepository: AccountsRepository {
    static let region = "us-central1"
    private let auth: Auth
    private let firestore: Firestore
    private let functions: Functions
    private var observation: ObservationLease?
    init(auth: Auth, firestore: Firestore, functions: Functions) {
        self.auth = auth; self.firestore = firestore; self.functions = functions
    }
    func observations() -> AsyncStream<AccountObservation> {
        observation?.cancel()
        let lease = ObservationLease(auth: auth, firestore: firestore)
        observation = lease
        return AsyncStream { continuation in
            lease.start(continuation)
            continuation.onTermination = { _ in Task { @MainActor in lease.cancel() } }
        }
    }
    func signUp(email: String, password: String) async throws {
        do { _ = try await auth.createUser(withEmail: email, password: password) }
        catch { throw Self.failure(error) }
    }
    func signIn(email: String, password: String) async throws {
        do { _ = try await auth.signIn(withEmail: email, password: password) }
        catch { throw Self.failure(error) }
    }
    func signOut() async throws {
        // Immediately end Firestore visibility, independently of the Auth callback.
        observation?.clearProfile()
        do { try auth.signOut() } catch { throw Self.failure(error) }
    }
    func sendVerification() async throws {
        guard let user = auth.currentUser else { throw AccountsFailure.unauthenticated }
        do { try await user.sendEmailVerification() } catch { throw Self.failure(error) }
    }
    func refreshIdentity() async throws {
        guard let user = auth.currentUser else { throw AccountsFailure.unauthenticated }
        let uid = user.uid
        do {
            try await user.reload()
            _ = try await user.getIDToken(forcingRefresh: true)
            guard auth.currentUser?.uid == uid else { throw AccountsFailure.unauthenticated }
            observation?.refresh()
        } catch { throw Self.failure(error) }
    }
    func joinCompany(_ request: JoinCompanyRequest) async throws -> JoinCompanyResponse {
        guard auth.currentUser?.isEmailVerified == true else { throw AccountsFailure.permissionDenied }
        do {
            let data = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request))
            let result = try await functions.httpsCallable("joinCompanyV1").call(data)
            let response = try JSONDecoder().decode(JoinCompanyResponse.self, from: JSONSerialization.data(withJSONObject: result.data))
            guard response.contractVersion == 1, !response.companyId.isEmpty, ["member", "admin"].contains(response.role) else { throw AccountsFailure.invalidProfile }
            return response
        } catch { throw Self.failure(error) }
    }
    func updateProfile(_ profile: EditableProfile) async throws {
        guard let user = auth.currentUser, user.isEmailVerified else { throw AccountsFailure.unauthenticated }
        let fields = try profile.validatedFields()
        do { try await firestore.collection("users").document(user.uid).updateData(fields) }
        catch { throw Self.failure(error) }
    }
    nonisolated static func failure(_ error: Error) -> AccountsFailure {
        if let failure = error as? AccountsFailure { return failure }
        let error = error as NSError
        if error.domain == AuthErrorDomain {
            switch AuthErrorCode(rawValue: error.code) {
            case .wrongPassword, .invalidCredential, .userNotFound: return .invalidCredentials
            case .emailAlreadyInUse: return .emailAlreadyInUse
            case .invalidEmail, .weakPassword: return .invalidInput
            case .networkError: return .unavailable
            case .tooManyRequests: return .rateLimited
            default: return .unknown
            }
        }
        if error.domain == FunctionsErrorDomain {
            switch FunctionsErrorCode(rawValue: error.code) {
            case .unauthenticated: return .unauthenticated
            case .invalidArgument: return .invalidInput
            case .permissionDenied: return .permissionDenied
            case .notFound: return .invalidJoinCode
            case .failedPrecondition: return .membershipConflict
            case .resourceExhausted: return .rateLimited
            case .unavailable, .deadlineExceeded: return .unavailable
            default: return .unknown
            }
        }
        if error.domain == FirestoreErrorDomain {
            switch FirestoreErrorCode(rawValue: error.code) {
            case .permissionDenied: return .permissionDenied
            case .unauthenticated: return .unauthenticated
            case .unavailable, .deadlineExceeded: return .unavailable
            default: return .unknown
            }
        }
        return .unknown
    }
}

@MainActor private final class ObservationLease {
    private let auth: Auth
    private let firestore: Firestore
    private var authHandle: AuthStateDidChangeListenerHandle?
    private var profileHandle: ListenerRegistration?
    private var continuation: AsyncStream<AccountObservation>.Continuation?
    private var generation = 0
    init(auth: Auth, firestore: Firestore) { self.auth = auth; self.firestore = firestore }
    func start(_ continuation: AsyncStream<AccountObservation>.Continuation) {
        self.continuation = continuation
        authHandle = auth.addStateDidChangeListener { [weak self] _, user in
            let identity = user.map { AccountIdentity(uid: $0.uid, isEmailVerified: $0.isEmailVerified) }
            Task { @MainActor [weak self] in self?.receive(identity) }
        }
    }
    func refresh() { receive(auth.currentUser.map { AccountIdentity(uid: $0.uid, isEmailVerified: $0.isEmailVerified) }) }
    func clearProfile() { generation += 1; profileHandle?.remove(); profileHandle = nil }
    private func receive(_ identity: AccountIdentity?) {
        guard let continuation else { return }
        clearProfile()
        continuation.yield(.identity(identity))
        guard let identity, identity.isEmailVerified else { return }
        let generation = generation
        profileHandle = firestore.collection("users").document(identity.uid).addSnapshotListener { [weak self] snapshot, error in
            let event: AccountObservation
            if let error { event = .failure(uid: identity.uid, FirebaseAccountsRepository.failure(error)) }
            else if let snapshot {
                do { event = .profile(uid: identity.uid, try AccountDocumentMapper.decode(id: snapshot.documentID, fields: snapshot.exists ? snapshot.data() : nil)) }
                catch { event = .failure(uid: identity.uid, .invalidProfile) }
            } else { event = .failure(uid: identity.uid, .unavailable) }
            Task { @MainActor [weak self] in
                guard let self, self.generation == generation else { return }
                self.continuation?.yield(event)
            }
        }
    }
    func cancel() {
        clearProfile()
        if let authHandle { auth.removeStateDidChangeListener(authHandle) }; authHandle = nil
        continuation?.finish(); continuation = nil
    }
}

/// Firestore persistence is mapped explicitly; Codable JSON DTO dates are not used here.
enum AccountDocumentMapper {
    static func decode(id: String, fields: [String: Any]?) throws -> AppUser? {
        guard let f = fields else { return nil }
        func string(_ key: String) throws -> String { guard let value = f[key] as? String else { throw AccountsFailure.invalidProfile }; return value }
        func strings(_ key: String) throws -> [String] { guard let value = f[key] as? [String] else { throw AccountsFailure.invalidProfile }; return value }
        func integer(_ key: String) throws -> Int {
            guard let value = f[key] as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(), value.doubleValue.isFinite,
                  value.doubleValue.rounded() == value.doubleValue, let result = Int(exactly: value.doubleValue) else { throw AccountsFailure.invalidProfile }
            return result
        }
        guard let timestamp = f["createdAt"] as? Timestamp else { throw AccountsFailure.invalidProfile }
        let profile = try AppUser(id: id, companyId: string("companyId"), displayName: string("displayName"), email: string("email"), photoURL: string("photoURL"), avatarId: string("avatarId"), department: string("department"), jobTitle: string("jobTitle"), city: string("city"), role: string("role"), interestTagIds: strings("interestTagIds"), travelRadiusMiles: integer("travelRadiusMiles"), availability: strings("availability"), friendIds: strings("friendIds"), favoritePhotoIds: strings("favoritePhotoIds"), pointsBalance: integer("pointsBalance"), createdAt: timestamp.dateValue())
        _ = try MembershipContext(uid: id, profile: profile)
        return profile
    }
}

private extension EditableProfile {
    func validatedFields() throws -> [String: Any] {
        try validate()
        return ["displayName": displayName, "photoURL": photoURL, "avatarId": avatarId,
                "department": department, "jobTitle": jobTitle, "city": city,
                "interestTagIds": interestTagIds, "travelRadiusMiles": travelRadiusMiles,
                "availability": availability]
    }
}
