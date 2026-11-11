import CryptoKit
import Foundation
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseFunctions
@preconcurrency import FirebaseStorage

/// Album adapter against gcp/storage.rules, gcp/firestore.rules and finalizeEventPhotoV1
/// (docs/contracts/callables.md#event-photo-albums). Bytes are read through the authenticated SDK only;
/// no download-token URLs are created. Inject the session's configured SDK instances.
@MainActor final class FirebasePhotoAlbumSource: PhotoAlbumSource {
    private let firestore: Firestore
    private let functions: Functions
    private let storage: Storage
    private var listeners: [UUID: ListenerRegistration] = [:]
    private var uploads: [UUID: StorageUploadTask] = [:]
    private(set) var stopped = false

    init(firestore: Firestore, functions: Functions, storage: Storage) {
        self.firestore = firestore; self.functions = functions; self.storage = storage
    }

    private func photos(_ scope: EventReadScope, _ eventID: String) -> CollectionReference {
        firestore.collection("companies").document(scope.companyID).collection("events").document(eventID).collection("photos")
    }

    func observePhotos(scope: EventReadScope, eventID: String) -> AsyncThrowingStream<[AlbumPhotoRecord], Error> {
        let id = UUID()
        return AsyncThrowingStream { continuation in
            guard !stopped, MemberEventsRepository.validID(eventID), MemberEventsRepository.validID(scope.companyID) else {
                continuation.finish(throwing: AlbumFailure.unauthenticated); return
            }
            let query = photos(scope, eventID).order(by: "createdAt", descending: true).limit(to: AlbumPolicy.albumLimit)
            listeners[id] = query.addSnapshotListener { snapshot, error in
                if let error { continuation.finish(throwing: Self.failure(error)); return }
                guard let snapshot else { continuation.finish(throwing: AlbumFailure.unavailable); return }
                continuation.yield(snapshot.documents.compactMap {
                    Self.photoRecord(id: $0.documentID, fields: $0.data(), companyID: scope.companyID, eventID: eventID)
                })
            }
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in self?.listeners.removeValue(forKey: id)?.remove() }
            }
        }
    }

    func coverPhoto(scope: EventReadScope, eventID: String) async -> AlbumPhotoRecord? {
        guard !stopped, MemberEventsRepository.validID(eventID), MemberEventsRepository.validID(scope.companyID) else { return nil }
        guard let result = try? await photos(scope, eventID).order(by: "createdAt").limit(to: 1).getDocuments() else { return nil }
        return result.documents.lazy.compactMap {
            Self.photoRecord(id: $0.documentID, fields: $0.data(), companyID: scope.companyID, eventID: eventID)
        }.first
    }

    func ownPhotoIDs(scope: EventReadScope, eventID: String) async throws -> Set<String> {
        guard !stopped else { throw AlbumFailure.unauthenticated }
        do {
            let result = try await photos(scope, eventID).whereField("uploaderId", isEqualTo: scope.uid)
                .limit(to: AlbumPolicy.slotsPerMember).getDocuments()
            return Set(result.documents.map(\.documentID))
        } catch { throw Self.failure(error) }
    }

    func imageData(path: String) async throws -> Data {
        guard !stopped else { throw AlbumFailure.unauthenticated }
        do { return try await storage.reference(withPath: path).data(maxSize: Int64(AlbumPolicy.maxBytes)) }
        catch { throw Self.failure(error) }
    }

    func upload(scope: EventReadScope, eventID: String, slot: Int, jpeg: Data,
                progress: @escaping @Sendable (Double) -> Void) async throws -> AlbumUploadOutcome {
        guard !stopped else { throw AlbumFailure.unauthenticated }
        guard jpeg.count <= AlbumPolicy.maxBytes else { throw AlbumFailure.tooLarge }
        let ref = storage.reference(withPath: AlbumPolicy.storagePath(scope: scope, eventID: eventID, slot: slot))
        let metadata = StorageMetadata()
        metadata.contentType = "image/jpeg"
        do {
            try await put(ref, data: jpeg, metadata: metadata, progress: progress)
            return .stored
        } catch {
            // Create-only slots: a denied write may mean this photo already landed on an earlier attempt
            // (ambiguous network failure) or that an abandoned upload holds the slot. The uploader may read
            // their own unpublished object, so compare checksums to tell them apart.
            let nsError = error as NSError
            guard nsError.domain == StorageErrorDomain, nsError.code == StorageErrorCode.unauthorized.rawValue,
                  let existing = try? await ref.getMetadata() else { throw Self.failure(error) }
            // Without a checksum the slot's content is ambiguous: fail retryably instead of risking a duplicate.
            guard let md5 = existing.md5Hash else { throw AlbumFailure.unavailable }
            if md5 == Self.md5Base64(jpeg) { progress(1); return .stored }
            return .slotOccupied
        }
    }

    private func put(_ ref: StorageReference, data: Data, metadata: StorageMetadata,
                     progress: @escaping @Sendable (Double) -> Void) async throws {
        let id = UUID()
        defer { uploads[id] = nil }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                let task = ref.putData(data, metadata: metadata) { _, error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume() }
                }
                task.observe(.progress) { snapshot in
                    guard let total = snapshot.progress?.totalUnitCount, total > 0 else { return }
                    progress(min(1, Double(snapshot.progress?.completedUnitCount ?? 0) / Double(total)))
                }
                uploads[id] = task
                // Cancelled before the handle was stored: the onCancel hop would find nothing to cancel.
                if Task.isCancelled { task.cancel() }
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.uploads[id]?.cancel() }
        }
        try Task.checkCancellation()
    }

    func finalize(scope: EventReadScope, eventID: String, slot: Int) async throws -> String {
        guard !stopped else { throw AlbumFailure.unauthenticated }
        let photoID = AlbumPolicy.photoID(uid: scope.uid, slot: slot)
        let request: [String: Any] = [
            "contractVersion": 1, "companyId": scope.companyID, "eventId": eventID, "photoId": photoID,
            "storagePath": AlbumPolicy.storagePath(scope: scope, eventID: eventID, slot: slot), "caption": ""]
        do {
            let result = try await functions.httpsCallable("finalizeEventPhotoV1").call(request)
            guard let data = result.data as? [String: Any], data["photoId"] as? String == photoID else { throw AlbumFailure.unknown }
            return photoID
        } catch { throw Self.failure(error) }
    }

    func observeComments(scope: EventReadScope, eventID: String, photoID: String) -> AsyncThrowingStream<[PhotoCommentRecord], Error> {
        let id = UUID()
        return AsyncThrowingStream { continuation in
            guard !stopped, MemberEventsRepository.validID(eventID), MemberEventsRepository.validID(photoID) else {
                continuation.finish(throwing: AlbumFailure.unauthenticated); return
            }
            let query = photos(scope, eventID).document(photoID).collection("comments")
                .order(by: "createdAt", descending: true).limit(to: 100)
            listeners[id] = query.addSnapshotListener(includeMetadataChanges: true) { snapshot, error in
                if let error { continuation.finish(throwing: Self.failure(error)); return }
                guard let snapshot else { continuation.finish(throwing: AlbumFailure.unavailable); return }
                let records = snapshot.documents.compactMap {
                    // `.estimate` shows a pending own comment immediately with an estimated server time.
                    Self.commentRecord(id: $0.documentID, fields: $0.data(with: .estimate), companyID: scope.companyID, photoID: photoID)
                }
                continuation.yield(records.sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) })
            }
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in self?.listeners.removeValue(forKey: id)?.remove() }
            }
        }
    }

    func addComment(scope: EventReadScope, eventID: String, photoID: String, commentID: String, text: String,
                    author: ChatAuthor) async throws {
        guard !stopped else { throw AlbumFailure.unauthenticated }
        guard MemberEventsRepository.validID(eventID), MemberEventsRepository.validID(photoID),
              ChatFailure.validMessageID(commentID) else { throw AlbumFailure.unknown }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 2_000 else { throw AlbumFailure.unknown }
        let ref = photos(scope, eventID).document(photoID).collection("comments").document(commentID)
        let data: [String: Any] = [
            "companyId": scope.companyID, "photoId": photoID, "authorId": scope.uid, "authorName": author.name,
            "authorAvatarId": author.avatarID, "text": trimmed, "createdAt": FieldValue.serverTimestamp()]
        do {
            try await Self.write { completion in ref.setData(data, completion: completion) }
        } catch {
            // A retry of an already-committed comment is denied as an update: that is success.
            if let existing = try? await ref.getDocument(), existing.exists,
               existing.get("authorId") as? String == scope.uid, existing.get("text") as? String == trimmed { return }
            throw Self.failure(error)
        }
    }

    func stop() {
        stopped = true
        listeners.values.forEach { $0.remove() }; listeners.removeAll()
        uploads.values.forEach { $0.cancel() }; uploads.removeAll()
    }

    /// Completion-based write with a 15 s timeout so an offline comment fails visibly (idempotent on the ID).
    private static func write(_ start: (@escaping (Error?) -> Void) -> Void) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let gate = AlbumWriteGate()
            start { error in gate.once { if let error { continuation.resume(throwing: error) } else { continuation.resume() } } }
            Task { try? await Task.sleep(for: .seconds(15)); gate.once { continuation.resume(throwing: AlbumFailure.unavailable) } }
        }
    }

    nonisolated static func md5Base64(_ data: Data) -> String {
        Data(Insecure.MD5.hash(data: data)).base64EncodedString()
    }

    nonisolated static func photoRecord(id: String, fields: [String: Any], companyID: String, eventID: String) -> AlbumPhotoRecord? {
        guard fields["companyId"] as? String == companyID, fields["eventId"] as? String == eventID,
              let uploaderID = fields["uploaderId"] as? String, let path = fields["storagePath"] as? String,
              path.hasPrefix("companies/\(companyID)/events/\(eventID)/photos/\(uploaderID)/"),
              let createdAt = (fields["createdAt"] as? Timestamp)?.dateValue() else { return nil }
        return AlbumPhotoRecord(id: id, uploaderID: uploaderID, uploaderName: fields["uploaderName"] as? String ?? "",
                                storagePath: path, createdAt: createdAt,
                                commentCount: (fields["commentCount"] as? NSNumber)?.intValue ?? 0)
    }

    nonisolated static func commentRecord(id: String, fields: [String: Any], companyID: String, photoID: String) -> PhotoCommentRecord? {
        guard fields["companyId"] as? String == companyID, fields["photoId"] as? String == photoID,
              let authorID = fields["authorId"] as? String, let text = fields["text"] as? String,
              let createdAt = (fields["createdAt"] as? Timestamp)?.dateValue() else { return nil }
        return PhotoCommentRecord(id: id, authorID: authorID, authorName: fields["authorName"] as? String ?? "",
                                  text: text, createdAt: createdAt)
    }

    nonisolated static func failure(_ error: Error) -> AlbumFailure {
        if let failure = error as? AlbumFailure { return failure }
        let error = error as NSError
        if error.domain == FunctionsErrorDomain {
            let details = error.userInfo[FunctionsErrorDetailsKey] as? [String: Any]
            switch details?["reason"] as? String {
            case "NOT_ATTENDEE", "MEMBERSHIP_CONFLICT": return .notAttendee
            case "EVENT_NOT_ENDED": return .notEnded
            case "EVENT_CANCELLED", "EVENT_NOT_FOUND": return .cancelled
            case "UPLOAD_INVALID": return .invalidImage
            case "UNAUTHENTICATED", "EMAIL_NOT_VERIFIED", "PROVIDER_NOT_ALLOWED": return .unauthenticated
            default: break
            }
            switch FunctionsErrorCode(rawValue: error.code) {
            case .unauthenticated: return .unauthenticated
            case .permissionDenied: return .notAttendee
            case .unavailable, .deadlineExceeded: return .unavailable
            default: return .unknown
            }
        }
        if error.domain == StorageErrorDomain {
            switch StorageErrorCode(rawValue: error.code) {
            case .unauthenticated: return .unauthenticated
            // Rules denial on upload: not an eligible attendee (or the slot is taken; see `upload`).
            case .unauthorized: return .notAttendee
            case .retryLimitExceeded, .cancelled: return .unavailable
            case .downloadSizeExceeded: return .tooLarge
            default: return .unknown
            }
        }
        if error.domain == FirestoreErrorDomain {
            switch FirestoreErrorCode.Code(rawValue: error.code) {
            case .unauthenticated: return .unauthenticated
            case .permissionDenied: return .notAttendee
            case .unavailable, .deadlineExceeded: return .unavailable
            default: return .unknown
            }
        }
        if error.domain == NSURLErrorDomain { return .unavailable }
        return .unknown
    }
}

private final class AlbumWriteGate: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    func once(_ body: () -> Void) { lock.lock(); defer { lock.unlock() }; guard !done else { return }; done = true; body() }
}
