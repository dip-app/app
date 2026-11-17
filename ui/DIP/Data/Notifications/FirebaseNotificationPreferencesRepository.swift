import DIPCore
import Foundation
@preconcurrency import FirebaseFirestore

/// The member's own `users/{uid}/settings/notifications` document. The path comes from the signed-in scope, never from a
/// caller-supplied id. The rules allow exactly `contractVersion`, `push`, `email` and `updatedAt` (= request time). A save
/// merge-writes only the saved channel's map, `push` or `email` (plus `contractVersion` and a server timestamp), so it never overwrites `email`
/// switches the server changed (an unsubscribe link) or that the email section owns. A missing document loads as the
/// registry defaults (the server resolves defaults on every read).
final class FirebaseNotificationPreferencesRepository: DIPNotificationPreferencesRepository, @unchecked Sendable {
    /// An offline write stays queued in Firestore; the screen should not wait on its acknowledgement forever, and the
    /// queued write counts as saved (pending sync).
    static let writeTimeout: Duration = .seconds(15)

    private let firestore: Firestore
    private let uid: String

    init(firestore: Firestore, uid: String) { self.firestore = firestore; self.uid = uid }

    private var document: DocumentReference {
        firestore.collection("users").document(uid).collection("settings").document("notifications")
    }

    func load() async throws -> DIPNotificationPreferences {
        let snapshot = try await document.getDocument()
        guard snapshot.exists else { return .defaults }
        return DIPNotificationPreferences(firestore: snapshot.data())
    }

    func save(_ preferences: DIPNotificationPreferences, on channel: DIPNotificationChannel) async throws {
        let all = preferences.firestoreFields()
        let fields: [String: Any] = [
            "contractVersion": all["contractVersion"] ?? 1,
            channel.rawValue: all[channel.rawValue] ?? [:],
            "updatedAt": FieldValue.serverTimestamp(),
        ]
        let reference = document
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let gate = Gate()
            // Firestore applied the write to its local cache and queued it. Offline, the server acknowledgement (the
            // completion handler) only comes later, so after the timeout the change counts as saved and syncs by itself.
            // Reporting a failure here would revert a switch whose write is about to land. A write the server rejects
            // (rules, auth) is reported by the handler right away when online.
            let timeout = Task {
                try? await Task.sleep(for: Self.writeTimeout)
                guard !Task.isCancelled else { return }
                gate.once { continuation.resume() }
            }
            reference.setData(fields, merge: true) { error in
                timeout.cancel()
                gate.once { if let error { continuation.resume(throwing: error) } else { continuation.resume() } }
            }
        }
    }

    private final class Gate: @unchecked Sendable {
        private let lock = NSLock()
        private var done = false
        func once(_ body: () -> Void) { lock.lock(); defer { lock.unlock() }; guard !done else { return }; done = true; body() }
    }
}
