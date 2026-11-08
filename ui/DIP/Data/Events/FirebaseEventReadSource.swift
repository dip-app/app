import Foundation
import DIPAccounts
import DIPContracts
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore

/// Inject the session's already-configured SDKs; never initializes or selects a Firebase project.
@MainActor final class FirebaseEventReadSource: EventReadSource {
    private let firestore: Firestore
    private let auth: Auth
    private var authListener: EventReadCleanup?
    private var membershipListener: EventReadCleanup?
    private var detailListeners: [UUID: EventReadCleanup] = [:]
    private var onInvalidation: (() -> Void)?
    private init(auth: Auth, firestore: Firestore) { self.auth = auth; self.firestore = firestore }

    static func repository(context: MembershipContext, auth: Auth, firestore: Firestore) -> MemberEventsRepository {
        let scope = EventReadScope(uid: context.uid, companyID: context.companyID)
        let source = FirebaseEventReadSource(auth: auth, firestore: firestore)
        let repository = MemberEventsRepository(scope: scope, source: source, currentUID: { auth.currentUser?.uid })
        source.onInvalidation = { [weak repository] in repository?.invalidate() }
        let authHandle = auth.addStateDidChangeListener { [weak source] _, user in
            let uid = user?.uid
            Task { @MainActor in if uid != scope.uid { source?.onInvalidation?() } }
        }
        source.authListener = EventReadCleanup { auth.removeStateDidChangeListener(authHandle) }
        let membershipHandle = firestore.collection("users").document(scope.uid).addSnapshotListener { [weak source] snapshot, error in
            let valid = error == nil && snapshot?.exists == true && snapshot?.get("companyId") as? String == scope.companyID
            Task { @MainActor in if !valid { source?.onInvalidation?() } }
        }
        source.membershipListener = EventReadCleanup { membershipHandle.remove() }
        return repository
    }
    func feed(scope: EventReadScope, query: EventFeedQuery, after cursor: EventFeedCursor?) async throws -> [DIPContracts.Event] {
        var request = firestore.collection("companies").document(scope.companyID).collection("events")
            .whereField("companyId", isEqualTo: scope.companyID)
            .whereField("status", isEqualTo: "scheduled")
            .whereField("startTime", isGreaterThanOrEqualTo: Timestamp(date: query.startsAtOrAfter))
            .order(by: "startTime").order(by: FieldPath.documentID()).limit(to: query.pageSize)
        if let cursor { request = request.start(after: [Timestamp(date: cursor.startTime), cursor.eventID]) }
        do {
            let result = try await request.getDocuments(source: .server)
            return try result.documents.map { snapshot in
                guard let event = try EventDocumentMapper.decode(id: snapshot.documentID, companyID: scope.companyID, fields: snapshot.data()) else { throw EventReadFailure.invalidDocument }; return event
            }
        } catch { throw Self.failure(error) }
    }
    func detail(scope: EventReadScope, eventID: String) async throws -> DIPContracts.Event? {
        do {
            let result = try await reference(scope, eventID).getDocument(source: .server)
            return try EventDocumentMapper.decode(id: result.documentID, companyID: scope.companyID, fields: result.exists ? result.data() : nil)
        } catch { throw Self.failure(error) }
    }
    func observeDetail(scope: EventReadScope, eventID: String) -> AsyncThrowingStream<DIPContracts.Event?, Error> {
        let id = UUID()
        return AsyncThrowingStream { continuation in
            let handle = reference(scope, eventID).addSnapshotListener { snapshot, error in
                if let error { continuation.finish(throwing: Self.failure(error)); return }
                guard let snapshot else { continuation.finish(throwing: EventReadFailure.unavailable); return }
                do { continuation.yield(try EventDocumentMapper.decode(id: snapshot.documentID, companyID: scope.companyID, fields: snapshot.exists ? snapshot.data() : nil)) }
                catch { continuation.finish(throwing: Self.failure(error)) }
            }
            detailListeners[id] = EventReadCleanup { handle.remove() }
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in self?.detailListeners.removeValue(forKey: id)?.cancel() }
            }
        }
    }
    func stop() {
        authListener?.cancel(); authListener = nil
        membershipListener?.cancel(); membershipListener = nil
        detailListeners.values.forEach { $0.cancel() }; detailListeners.removeAll()
        onInvalidation = nil
    }
    private func reference(_ scope: EventReadScope, _ eventID: String) -> DocumentReference {
        firestore.collection("companies").document(scope.companyID).collection("events").document(eventID)
    }
    nonisolated private static func failure(_ error: Error) -> EventReadFailure {
        if let failure = error as? EventReadFailure { return failure }
        let error = error as NSError
        guard error.domain == FirestoreErrorDomain else { return .unavailable }
        switch FirestoreErrorCode.Code(rawValue: error.code) {
        case .unauthenticated: return .unauthenticated
        case .permissionDenied: return .permissionDenied
        default: return .unavailable
        }
    }
}

/// SDK listeners are removed both on explicit invalidation and when their owner is released.
/// Owned/mutated only by the MainActor source; destruction simply invokes the SDK cleanup.
private final class EventReadCleanup {
    private var action: (() -> Void)?
    init(_ action: @escaping () -> Void) { self.action = action }
    func cancel() { let current = action; action = nil; current?() }
    deinit { action?() }
}
