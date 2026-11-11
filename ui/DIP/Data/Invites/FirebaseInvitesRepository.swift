import DIPCore
import Foundation
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseFunctions

/// Firestore listeners + callables for coworker invitations. Inject the session's configured SDK instances
/// (Functions MUST be the us-central1 instance used by the other callables). Invites are read directly
/// (`toUserId == uid` / `fromUserId == uid`, limit 50, the rules' only allowed list shapes); sending, answering
/// and the coworker directory go through `sendInviteV1`, `respondToInviteV1` and `listCoworkersV1`.
final class FirebaseInvitesRepository: DIPInvitesRepository, @unchecked Sendable {
    private let firestore: Firestore
    private let functions: Functions
    private let scope: EventReadScope

    init(firestore: Firestore, functions: Functions, scope: EventReadScope) {
        self.firestore = firestore; self.functions = functions; self.scope = scope
    }

    private var invites: CollectionReference {
        firestore.collection("companies").document(scope.companyID).collection("invites")
    }

    func observe() async -> AsyncThrowingStream<DIPInvites, Error> {
        let scope = scope
        // The rules' list check needs the tenant proven by the query itself, so companyId is always filtered.
        let received = invites.whereField("companyId", isEqualTo: scope.companyID).whereField("toUserId", isEqualTo: scope.uid).limit(to: 50)
        let sent = invites.whereField("companyId", isEqualTo: scope.companyID).whereField("fromUserId", isEqualTo: scope.uid).limit(to: 50)
        return AsyncThrowingStream { continuation in
            let box = Latest()
            func publish() { if let value = box.merged() { continuation.yield(value) } }
            let first = received.addSnapshotListener { snapshot, error in
                if let error { continuation.finish(throwing: Self.failure(error)); return }
                guard let snapshot else { return }
                box.setReceived(snapshot.documents.compactMap {
                    InviteDocumentMapper.invite(id: $0.documentID, fields: Self.plain($0.data()), companyID: scope.companyID, uid: scope.uid, direction: .received)
                })
                publish()
            }
            let second = sent.addSnapshotListener { snapshot, error in
                if let error { continuation.finish(throwing: Self.failure(error)); return }
                guard let snapshot else { return }
                box.setSent(snapshot.documents.compactMap {
                    InviteDocumentMapper.invite(id: $0.documentID, fields: Self.plain($0.data()), companyID: scope.companyID, uid: scope.uid, direction: .sent)
                })
                publish()
            }
            continuation.onTermination = { _ in first.remove(); second.remove() }
        }
    }

    func searchCoworkers(eventID: String, query: String) async throws -> [DIPCoworker] {
        guard MemberEventsRepository.validID(eventID), let term = DIPInviteRules.searchTerm(query) else { throw DIPInviteFailure.notFound }
        let request: [String: Any] = ["contractVersion": 1, "companyId": scope.companyID, "eventId": eventID, "query": term, "limit": 20]
        do {
            let result = try await functions.httpsCallable("listCoworkersV1").call(request)
            guard let data = result.data as? [String: Any], let rows = data["coworkers"] as? [[String: Any]] else { throw DIPInviteFailure.unknown }
            return rows.compactMap(InviteDocumentMapper.coworker)
        } catch { throw Self.failure(error) }
    }

    func send(eventID: String, toUserID: String, message: String, requestID: String) async throws {
        guard MemberEventsRepository.validID(eventID), MemberEventsRepository.validID(toUserID) else { throw DIPInviteFailure.notFound }
        var request: [String: Any] = ["contractVersion": 1, "companyId": scope.companyID, "eventId": eventID,
                                      "toUserId": toUserID, "requestId": requestID]
        let note = DIPInviteRules.note(message)
        if !note.isEmpty { request["message"] = note }
        do {
            let result = try await functions.httpsCallable("sendInviteV1").call(request)
            guard let data = result.data as? [String: Any], data["inviteId"] as? String != nil else { throw DIPInviteFailure.unknown }
        } catch { throw Self.failure(error) }
    }

    func respond(inviteID: String, accept: Bool) async throws -> DIPInviteReply {
        let request: [String: Any] = ["contractVersion": 1, "companyId": scope.companyID, "inviteId": inviteID,
                                      "response": accept ? "accepted" : "declined"]
        do {
            let result = try await functions.httpsCallable("respondToInviteV1").call(request)
            guard let data = result.data as? [String: Any], let text = data["status"] as? String,
                  let status = DIPInviteStatus(rawValue: text), status != .pending else { throw DIPInviteFailure.unknown }
            return DIPInviteReply(status: status, joined: status == .accepted && data["rsvpStatus"] as? String == "going")
        } catch { throw Self.failure(error) }
    }

    /// Timestamps become `Date` so the mapper never imports the SDK.
    private static func plain(_ fields: [String: Any]) -> [String: Any] {
        fields.mapValues { ($0 as? Timestamp)?.dateValue() ?? $0 }
    }

    /// Combines the two listeners; nothing is published until both have answered once (no "no invitations" flash).
    private final class Latest: @unchecked Sendable {
        private let lock = NSLock()
        private var received: [DIPInvite]?
        private var sent: [DIPInvite]?
        func setReceived(_ value: [DIPInvite]) { lock.withLock { received = value } }
        func setSent(_ value: [DIPInvite]) { lock.withLock { sent = value } }
        func merged() -> DIPInvites? {
            lock.withLock { if let received, let sent { DIPInvites(received: received, sent: sent) } else { nil } }
        }
    }

    nonisolated static func failure(_ error: Error) -> DIPInviteFailure {
        if let failure = error as? DIPInviteFailure { return failure }
        let error = error as NSError
        if error.domain == FunctionsErrorDomain {
            let details = error.userInfo[FunctionsErrorDetailsKey] as? [String: Any]
            switch details?["reason"] as? String {
            case "ALREADY_INVITED": return .alreadyInvited
            case "ALREADY_GOING": return .alreadyGoing
            case "EVENT_FULL": return .full
            case "EVENT_CLOSED": return .closed
            case "EVENT_CANCELLED": return .cancelled
            case "EVENT_NOT_FOUND", "INVITE_NOT_FOUND", "RECIPIENT_NOT_FOUND": return .notFound
            case "INVITE_ALREADY_RESPONDED": return .alreadyAnswered
            case "CANNOT_INVITE_SELF", "VALIDATION_FAILED": return .unknown
            case "RATE_LIMITED": return .rateLimited
            case "MEMBERSHIP_CONFLICT", "EMAIL_NOT_VERIFIED", "PROVIDER_NOT_ALLOWED": return .notMember
            default: break
            }
            switch FunctionsErrorCode(rawValue: error.code) {
            case .unauthenticated: return .unauthenticated
            case .resourceExhausted: return .rateLimited
            case .permissionDenied: return .notMember
            case .unavailable, .deadlineExceeded: return .offline
            default: return .unknown
            }
        }
        if error.domain == FirestoreErrorDomain {
            switch FirestoreErrorCode.Code(rawValue: error.code) {
            case .unauthenticated: return .unauthenticated
            case .permissionDenied: return .notMember
            case .unavailable, .deadlineExceeded: return .offline
            default: return .unknown
            }
        }
        if error.domain == NSURLErrorDomain { return .offline }
        return .unknown
    }
}
