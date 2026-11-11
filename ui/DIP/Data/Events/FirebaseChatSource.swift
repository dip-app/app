import DIPCore
import Foundation
@preconcurrency import FirebaseFirestore

// Activity chat and notification preference against the deployed rules: going RSVP, own author, trimmed
// 1-1000 characters, writable until 24 h after the event ends; subscriptions/{uid} holds {level, updatedAt}.

private final class WriteGate: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    func once(_ body: () -> Void) { lock.lock(); defer { lock.unlock() }; guard !done else { return }; done = true; body() }
}

extension FirebaseParticipationSource: ChatSource {
    private func eventRef(_ scope: EventReadScope, _ eventID: String) -> DocumentReference {
        firestore.collection("companies").document(scope.companyID).collection("events").document(eventID)
    }

    func observeMessages(scope: EventReadScope, eventID: String) -> AsyncThrowingStream<[ChatMessageRecord], Error> {
        let id = UUID()
        return AsyncThrowingStream { continuation in
            guard !stopped, MemberEventsRepository.validID(eventID), MemberEventsRepository.validID(scope.companyID) else {
                continuation.finish(throwing: ChatFailure.unauthenticated); return
            }
            // Rules require a limit <= 100; ordering by createdAt needs only the automatic single-field index.
            let query = eventRef(scope, eventID).collection("messages")
                .order(by: "createdAt", descending: true).limit(to: 100)
            chatListeners[id] = query.addSnapshotListener(includeMetadataChanges: true) { snapshot, error in
                if let error { continuation.finish(throwing: Self.chatFailure(error)); return }
                guard let snapshot else { continuation.finish(throwing: ChatFailure.unavailable); return }
                let records = snapshot.documents.compactMap { document -> ChatMessageRecord? in
                    // `.estimate` shows a pending local send immediately with an estimated server time.
                    Self.chatRecord(id: document.documentID, fields: document.data(with: .estimate),
                                    companyID: scope.companyID, eventID: eventID)
                }
                continuation.yield(records.sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) })
            }
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in self?.chatListeners.removeValue(forKey: id)?.remove() }
            }
        }
    }

    func sendMessage(scope: EventReadScope, eventID: String, messageID: String, text: String, author: ChatAuthor) async throws {
        guard !stopped else { throw ChatFailure.unauthenticated }
        guard MemberEventsRepository.validID(eventID), ChatFailure.validMessageID(messageID) else { throw ChatFailure.unknown }
        let trimmed = try ChatFailure.validated(text)
        let ref = eventRef(scope, eventID).collection("messages").document(messageID)
        let data: [String: Any] = [
            "companyId": scope.companyID, "eventId": eventID, "authorId": scope.uid,
            "authorName": author.name, "authorAvatarId": author.avatarID, "text": trimmed,
            "createdAt": FieldValue.serverTimestamp()]
        do {
            try await Self.write { completion in ref.setData(data, completion: completion) }
        } catch {
            var failure = Self.chatFailure(error)
            if failure == .notGoing {
                // A retry of an already-committed message is denied as an update: that is success.
                if let existing = try? await ref.getDocument(), existing.exists,
                   existing.get("authorId") as? String == scope.uid, existing.get("text") as? String == trimmed { return }
                failure = await closedOrNotGoing(scope: scope, eventID: eventID)
            }
            throw failure
        }
    }

    func notificationLevel(scope: EventReadScope, eventID: String) async throws -> DIPNotificationLevel? {
        guard !stopped, MemberEventsRepository.validID(eventID) else { throw ChatFailure.unauthenticated }
        do {
            let document = try await eventRef(scope, eventID).collection("subscriptions").document(scope.uid).getDocument()
            // A missing document means "none" (rules); joining creates "changes" server-side.
            return (document.get("level") as? String).flatMap(DIPNotificationLevel.init(rawValue:)) ?? DIPNotificationLevel.none
        } catch { throw Self.chatFailure(error) }
    }

    func setNotificationLevel(scope: EventReadScope, eventID: String, level: DIPNotificationLevel) async throws {
        guard !stopped, MemberEventsRepository.validID(eventID) else { throw ChatFailure.unauthenticated }
        let ref = eventRef(scope, eventID).collection("subscriptions").document(scope.uid)
        let data: [String: Any] = ["level": level.rawValue, "updatedAt": FieldValue.serverTimestamp()]
        do { try await Self.write { completion in ref.setData(data, completion: completion) } }
        catch { throw Self.chatFailure(error) }
    }

    func stopChat() { chatListeners.values.forEach { $0.remove() }; chatListeners.removeAll() }

    /// Distinguishes a closed chat (cancelled event or 24 h after the end) from a missing "going" RSVP.
    private func closedOrNotGoing(scope: EventReadScope, eventID: String) async -> ChatFailure {
        guard let event = try? await eventRef(scope, eventID).getDocument(), event.exists else { return .notGoing }
        if event.get("status") as? String == "cancelled" { return .closed }
        if let end = (event.get("endTime") as? Timestamp)?.dateValue(), Date() > end.addingTimeInterval(86_400) { return .closed }
        return .notGoing
    }

    /// Completion-based write with a 15 s timeout so an offline send fails visibly (the write stays queued and
    /// is idempotent on the message ID, so retrying can never duplicate it).
    private static func write(_ start: (@escaping (Error?) -> Void) -> Void) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let gate = WriteGate()
            start { error in gate.once { if let error { continuation.resume(throwing: error) } else { continuation.resume() } } }
            Task { try? await Task.sleep(for: .seconds(15)); gate.once { continuation.resume(throwing: ChatFailure.unavailable) } }
        }
    }

    nonisolated static func chatRecord(id: String, fields: [String: Any], companyID: String, eventID: String) -> ChatMessageRecord? {
        guard fields["companyId"] as? String == companyID, fields["eventId"] as? String == eventID,
              let authorID = fields["authorId"] as? String, let text = fields["text"] as? String,
              let createdAt = (fields["createdAt"] as? Timestamp)?.dateValue() else { return nil }
        return ChatMessageRecord(id: id, authorID: authorID, authorName: fields["authorName"] as? String ?? "",
                                 text: text, createdAt: createdAt)
    }

    nonisolated static func chatFailure(_ error: Error) -> ChatFailure {
        if let failure = error as? ChatFailure { return failure }
        let error = error as NSError
        guard error.domain == FirestoreErrorDomain else { return .unknown }
        switch FirestoreErrorCode.Code(rawValue: error.code) {
        case .unauthenticated: return .unauthenticated
        case .permissionDenied: return .notGoing
        case .unavailable, .deadlineExceeded: return .unavailable
        default: return .unknown
        }
    }
}
