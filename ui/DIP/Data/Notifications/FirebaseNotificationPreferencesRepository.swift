import DIPCore
import Foundation
@preconcurrency import FirebaseFirestore

/// The member's own `users/{uid}/settings/notifications` document. The path comes from the signed-in scope, never from a
/// caller-supplied id. The rules allow exactly `contractVersion`, `push`, `email` and `updatedAt` (= request time). A save
/// merge-writes only the saved channel's map, `push` or `email` (plus `contractVersion` and a server timestamp), so it never overwrites `email`
/// switches the server changed (an unsubscribe link) or that the email section owns. A missing document loads as the
/// registry defaults (the server resolves defaults on every read).
final class FirebaseNotificationPreferencesRepository: DIPNotificationPreferencesRepository, @unchecked Sendable {
    /// An offline write stays queued; the screen should not wait on it forever.
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
            reference.setData(fields, merge: true) { error in
                gate.once { if let error { continuation.resume(throwing: error) } else { continuation.resume() } }
            }
            Task {
                try? await Task.sleep(for: Self.writeTimeout)
                gate.once { continuation.resume(throwing: URLError(.timedOut)) }
            }
        }
    }

    private final class Gate: @unchecked Sendable {
        private let lock = NSLock()
        private var done = false
        func once(_ body: () -> Void) { lock.lock(); defer { lock.unlock() }; guard !done else { return }; done = true; body() }
    }
}
