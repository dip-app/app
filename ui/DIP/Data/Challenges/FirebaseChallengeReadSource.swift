import Foundation
import DIPAccounts
import DIPContracts
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore

/// Weekly-theme reads for the member Home. Injects the session's configured SDKs; never selects
/// a Firebase project. Mirrors FirebaseEventReadSource: an auth listener and a membership
/// listener end the lease when the UID or the server-owned companyId changes.
@MainActor final class FirebaseChallengeReadSource: ChallengeReadSource {
    private let firestore: Firestore
    private var authListener: ChallengeReadCleanup?
    private var membershipListener: ChallengeReadCleanup?
    private var onInvalidation: (() -> Void)?
    private init(firestore: Firestore) { self.firestore = firestore }

    static func repository(context: MembershipContext, auth: Auth, firestore: Firestore) -> MemberChallengesRepository {
        let scope = ChallengeReadScope(uid: context.uid, companyID: context.companyID)
        let source = FirebaseChallengeReadSource(firestore: firestore)
        let repository = MemberChallengesRepository(scope: scope, source: source, currentUID: { auth.currentUser?.uid })
        source.onInvalidation = { [weak repository] in repository?.invalidate() }
        let authHandle = auth.addStateDidChangeListener { [weak source] _, user in
            let uid = user?.uid
            Task { @MainActor in if uid != scope.uid { source?.onInvalidation?() } }
        }
        source.authListener = ChallengeReadCleanup { auth.removeStateDidChangeListener(authHandle) }
        let membershipHandle = firestore.collection("users").document(scope.uid).addSnapshotListener { [weak source] snapshot, error in
            let valid = error == nil && snapshot?.exists == true && snapshot?.get("companyId") as? String == scope.companyID
            Task { @MainActor in if !valid { source?.onInvalidation?() } }
        }
        source.membershipListener = ChallengeReadCleanup { membershipHandle.remove() }
        return repository
    }

    /// `companies/{companyId}/challenges` where `endDate >= now`, ordered by `endDate`, limit 5
    /// (spec section 4; the rules require a bounded list, limit <= 20).
    func challenges(scope: ChallengeReadScope, query: ChallengeWindowQuery, origin: ChallengeReadOrigin) async throws -> [DIPContracts.Challenge] {
        let request = firestore.collection("companies").document(scope.companyID).collection("challenges")
            .whereField("endDate", isGreaterThanOrEqualTo: Timestamp(date: query.endsAtOrAfter))
            .order(by: "endDate").limit(to: query.limit)
        do {
            let result = try await request.getDocuments(source: origin == .server ? .server : .cache)
            return try result.documents.map { snapshot in
                guard let challenge = try ChallengeDocumentMapper.decode(id: snapshot.documentID, companyID: scope.companyID, fields: snapshot.data())
                else { throw ChallengeReadFailure.invalidDocument }
                return challenge
            }
        } catch { throw Self.failure(error) }
    }

    func stop() {
        authListener?.cancel(); authListener = nil
        membershipListener?.cancel(); membershipListener = nil
        onInvalidation = nil
    }

    nonisolated static func failure(_ error: Error) -> ChallengeReadFailure {
        if let failure = error as? ChallengeReadFailure { return failure }
        let error = error as NSError
        guard error.domain == FirestoreErrorDomain else { return .unavailable }
        switch FirestoreErrorCode.Code(rawValue: error.code) {
        case .unauthenticated: return .unauthenticated
        case .permissionDenied: return .permissionDenied
        default: return .unavailable
        }
    }
}

/// SDK listener cleanup, run on explicit invalidation or when the source is released.
private final class ChallengeReadCleanup {
    private var action: (() -> Void)?
    init(_ action: @escaping () -> Void) { self.action = action }
    func cancel() { let current = action; action = nil; current?() }
    deinit { action?() }
}
