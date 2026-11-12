import DIPCore
import Foundation
@preconcurrency import FirebaseFirestore

/// Firestore listeners for the member's own `users/{uid}/notifications`. The path comes from the signed-in scope,
/// never from a caller-supplied id. The rules allow owner reads with `limit <= 50` and `isRead`-only updates, so every
/// query carries a limit, pages are cursor-based, and marking read writes only `isRead`.
final class FirebaseNotificationsRepository: DIPNotificationsRepository, @unchecked Sendable {
    /// The rules' list limit; the unread listener asks for exactly this many.
    static let unreadCap = 50

    private let firestore: Firestore
    private let uid: String

    init(firestore: Firestore, uid: String) { self.firestore = firestore; self.uid = uid }

    private var collection: CollectionReference {
        firestore.collection("users").document(uid).collection("notifications")
    }

    func observe(limit: Int) async -> AsyncThrowingStream<[DIPNotification], Error> {
        let query = collection.order(by: "createdAt", descending: true).limit(to: min(limit, Self.unreadCap))
        let uid = uid
        return AsyncThrowingStream { continuation in
            let registration = query.addSnapshotListener { snapshot, error in
                if let error { continuation.finish(throwing: Self.failure(error)); return }
                guard let snapshot else { return }
                continuation.yield(snapshot.documents.compactMap {
                    NotificationDocumentMapper.notification(id: $0.documentID, fields: Self.plain($0.data()), uid: uid)
                })
            }
            continuation.onTermination = { _ in registration.remove() }
        }
    }

    func observeUnread() async -> AsyncThrowingStream<[String], Error> {
        let query = collection.whereField("isRead", isEqualTo: false).limit(to: Self.unreadCap)
        return AsyncThrowingStream { continuation in
            let registration = query.addSnapshotListener { snapshot, error in
                if let error { continuation.finish(throwing: Self.failure(error)); return }
                guard let snapshot else { return }
                continuation.yield(snapshot.documents.map(\.documentID))
            }
            continuation.onTermination = { _ in registration.remove() }
        }
    }

    func loadOlder(before date: Date, limit: Int) async throws -> [DIPNotification] {
        let query = collection.order(by: "createdAt", descending: true)
            .whereField("createdAt", isLessThan: Timestamp(date: date)).limit(to: min(limit, Self.unreadCap))
        do {
            let snapshot = try await query.getDocuments()
            return snapshot.documents.compactMap {
                NotificationDocumentMapper.notification(id: $0.documentID, fields: Self.plain($0.data()), uid: uid)
            }
        } catch { throw Self.failure(error) }
    }

    func markRead(ids: [String]) async throws {
        do {
            for group in DIPNotificationRules.batches(Array(Set(ids))) {
                let batch = firestore.batch()
                for id in group where !id.isEmpty && !id.contains("/") {
                    batch.updateData(["isRead": true], forDocument: collection.document(id))
                }
                try await batch.commit()
            }
        } catch { throw Self.failure(error) }
    }

    private static func plain(_ fields: [String: Any]) -> [String: Any] {
        fields.mapValues { ($0 as? Timestamp)?.dateValue() ?? $0 }
    }

    nonisolated static func failure(_ error: Error) -> DIPNotificationFailure {
        if let failure = error as? DIPNotificationFailure { return failure }
        let error = error as NSError
        if error.domain == FirestoreErrorDomain {
            switch FirestoreErrorCode.Code(rawValue: error.code) {
            case .unauthenticated: return .unauthenticated
            case .permissionDenied: return .denied
            case .unavailable, .deadlineExceeded: return .offline
            default: return .unknown
            }
        }
        if error.domain == NSURLErrorDomain { return .offline }
        return .unknown
    }
}
