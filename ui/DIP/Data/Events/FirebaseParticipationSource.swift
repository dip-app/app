import Foundation
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseFunctions

/// Firestore/Functions adapter for RSVP. Inject the session's configured SDK instances
/// (Functions MUST be the us-central1 instance used by the account callables).
@MainActor final class FirebaseParticipationSource: ParticipationSource {
    let firestore: Firestore
    private let functions: Functions
    private var listeners: [UUID: ListenerRegistration] = [:]
    /// Chat message listeners (see FirebaseChatSource.swift); removed by `stop()` too.
    var chatListeners: [UUID: ListenerRegistration] = [:]
    private(set) var stopped = false

    init(firestore: Firestore, functions: Functions) { self.firestore = firestore; self.functions = functions }

    func setRsvp(scope: EventReadScope, eventID: String, going: Bool) async throws -> Int {
        guard !stopped else { throw RsvpFailure.unauthenticated }
        guard MemberEventsRepository.validID(eventID), MemberEventsRepository.validID(scope.companyID) else { throw RsvpFailure.notFound }
        let request: [String: Any] = ["contractVersion": 1, "companyId": scope.companyID,
                                      "eventId": eventID, "status": going ? "going" : "cancelled"]
        do {
            let result = try await functions.httpsCallable("setRsvpV1").call(request)
            guard let data = result.data as? [String: Any], let count = data["attendeeCount"] as? NSNumber,
                  data["eventId"] as? String == eventID else { throw RsvpFailure.unknown }
            return count.intValue
        } catch { throw Self.failure(error) }
    }

    func observeMyGoingEventIDs(scope: EventReadScope) -> AsyncThrowingStream<Set<String>, Error> {
        let id = UUID()
        return AsyncThrowingStream { continuation in
            guard !stopped else { continuation.finish(throwing: RsvpFailure.unauthenticated); return }
            // Matches the rsvps collection-group index (companyId, userId, status, eventStartTime).
            let query = firestore.collectionGroup("rsvps")
                .whereField("companyId", isEqualTo: scope.companyID)
                .whereField("userId", isEqualTo: scope.uid)
                .whereField("status", isEqualTo: "going")
                .order(by: "eventStartTime").limit(to: 100)
            listeners[id] = query.addSnapshotListener { snapshot, error in
                if let error { continuation.finish(throwing: Self.failure(error)); return }
                guard let snapshot else { continuation.finish(throwing: RsvpFailure.unavailable); return }
                continuation.yield(Set(snapshot.documents.compactMap { document -> String? in
                    guard document.get("companyId") as? String == scope.companyID,
                          document.get("userId") as? String == scope.uid,
                          let eventID = document.get("eventId") as? String,
                          MemberEventsRepository.validID(eventID) else { return nil }
                    return eventID
                }))
            }
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in self?.listeners.removeValue(forKey: id)?.remove() }
            }
        }
    }

    func attendees(scope: EventReadScope, eventID: String) async throws -> [RsvpAttendee] {
        guard !stopped else { throw RsvpFailure.unauthenticated }
        guard MemberEventsRepository.validID(eventID) else { throw RsvpFailure.notFound }
        do {
            let result = try await firestore.collection("companies").document(scope.companyID)
                .collection("events").document(eventID).collection("rsvps")
                .whereField("companyId", isEqualTo: scope.companyID)
                .whereField("status", isEqualTo: "going").limit(to: 100).getDocuments()
            return Self.attendees(result.documents.map { (id: $0.documentID, fields: $0.data()) }, companyID: scope.companyID, eventID: eventID)
        } catch { throw Self.failure(error) }
    }

    func previewAttendees(scope: EventReadScope, eventID: String, limit: Int) async throws -> [RsvpAttendee] {
        guard !stopped else { throw RsvpFailure.unauthenticated }
        guard MemberEventsRepository.validID(eventID) else { throw RsvpFailure.notFound }
        do {
            let result = try await firestore.collection("companies").document(scope.companyID)
                .collection("events").document(eventID).collection("rsvps")
                .whereField("companyId", isEqualTo: scope.companyID)
                .whereField("status", isEqualTo: "going").limit(to: max(1, min(limit, 10))).getDocuments()
            return Self.attendees(result.documents.map { (id: $0.documentID, fields: $0.data()) }, companyID: scope.companyID, eventID: eventID)
        } catch { throw Self.failure(error) }
    }

    func stop() {
        stopped = true
        listeners.values.forEach { $0.remove() }; listeners.removeAll()
        stopChat()
    }

    /// Keeps only well-formed rows for this event; malformed rows are skipped, not fatal.
    nonisolated static func attendees(_ rows: [(id: String, fields: [String: Any])], companyID: String, eventID: String) -> [RsvpAttendee] {
        rows.compactMap { row -> RsvpAttendee? in
            let f = row.fields
            guard f["companyId"] as? String == companyID, f["eventId"] as? String == eventID,
                  f["userId"] as? String == row.id, f["status"] as? String == "going",
                  let name = f["userName"] as? String else { return nil }
            return RsvpAttendee(userID: row.id, name: name, department: f["userDepartment"] as? String ?? "",
                                avatarID: f["userAvatarId"] as? String ?? "", jobTitle: f["userJobTitle"] as? String ?? "")
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    nonisolated static func failure(_ error: Error) -> RsvpFailure {
        if let failure = error as? RsvpFailure { return failure }
        let error = error as NSError
        if error.domain == FunctionsErrorDomain {
            let details = error.userInfo[FunctionsErrorDetailsKey] as? [String: Any]
            switch details?["reason"] as? String {
            case "EVENT_FULL": return .full
            case "EVENT_CLOSED": return .closed
            case "EVENT_NOT_FOUND": return .notFound
            case "MEMBERSHIP_CONFLICT", "EMAIL_NOT_VERIFIED", "PROVIDER_NOT_ALLOWED": return .notMember
            default: break
            }
            switch FunctionsErrorCode(rawValue: error.code) {
            case .unauthenticated: return .unauthenticated
            case .resourceExhausted: return .full
            case .failedPrecondition: return .closed
            // setRsvpV1 always sends EVENT_NOT_FOUND for a missing event; a bare not-found
            // means the function endpoint itself was not found (not deployed / wrong region).
            case .notFound: return .unknown
            case .permissionDenied: return .notMember
            case .unavailable, .deadlineExceeded: return .unavailable
            default: return .unknown
            }
        }
        if error.domain == FirestoreErrorDomain {
            switch FirestoreErrorCode.Code(rawValue: error.code) {
            case .unauthenticated: return .unauthenticated
            case .permissionDenied: return .notMember
            case .unavailable, .deadlineExceeded: return .unavailable
            default: return .unknown
            }
        }
        return .unknown
    }
}
