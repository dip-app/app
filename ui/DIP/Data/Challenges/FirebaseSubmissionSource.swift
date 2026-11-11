import DIPCore
import Foundation
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseFunctions
@preconcurrency import FirebaseStorage

/// Submission adapter against gcp/firestore.rules, gcp/storage.rules and `submitChallengeV1`
/// (docs/contracts/challenge-submissions.md). Reads only the member's own `{challengeId}_{uid}` document; evidence
/// goes to create-only Storage slots; every write that matters is the callable.
@MainActor final class FirebaseSubmissionSource: SubmissionSource {
    private let firestore: Firestore
    private let functions: Functions
    private let storage: Storage
    private var listeners: [UUID: ListenerRegistration] = [:]
    private var uploads: [UUID: StorageUploadTask] = [:]
    private var stopped = false

    init(firestore: Firestore, functions: Functions, storage: Storage) {
        self.firestore = firestore; self.functions = functions; self.storage = storage
    }

    func observe(scope: ChallengeReadScope, challengeID: String) -> AsyncThrowingStream<DIPSubmission?, Error> {
        AsyncThrowingStream { continuation in
            guard !stopped, MemberEventsRepository.validID(challengeID) else { continuation.finish(throwing: DIPSubmissionFailure.unauthenticated); return }
            let id = UUID()
            let documentID = DIPSubmissionPolicy.submissionID(challengeID: challengeID, uid: scope.uid)
            let reference = firestore.collection("companies").document(scope.companyID).collection("challenges").document(challengeID)
                .collection("submissions").document(documentID)
            listeners[id] = reference.addSnapshotListener { snapshot, error in
                if let error { continuation.finish(throwing: Self.failure(error)); return }
                guard let snapshot else { continuation.finish(throwing: DIPSubmissionFailure.offline); return }
                guard snapshot.exists else { continuation.yield(nil); return }
                guard let record = Self.record(id: snapshot.documentID, fields: snapshot.data() ?? [:], scope: scope, challengeID: challengeID)
                else { continuation.finish(throwing: DIPSubmissionFailure.unknown); return }
                continuation.yield(record)
            }
            continuation.onTermination = { [weak self] _ in
                Task { @MainActor in self?.listeners.removeValue(forKey: id)?.remove() }
            }
        }
    }

    func uploadEvidence(scope: ChallengeReadScope, challengeID: String, slot: Int, jpeg: Data,
                        progress: @escaping @Sendable (Double) -> Void) async throws -> AlbumUploadOutcome {
        guard !stopped else { throw DIPSubmissionFailure.unauthenticated }
        guard jpeg.count <= DIPSubmissionPolicy.maxBytes else { throw DIPSubmissionFailure.tooLarge }
        guard MemberEventsRepository.validID(challengeID), (0..<DIPSubmissionPolicy.slots).contains(slot) else { throw DIPSubmissionFailure.invalidInput }
        let path = DIPSubmissionPolicy.evidencePath(companyID: scope.companyID, challengeID: challengeID, uid: scope.uid, slot: slot)
        let ref = storage.reference(withPath: path)
        let metadata = StorageMetadata()
        metadata.contentType = "image/jpeg"
        do {
            try await put(ref, data: jpeg, metadata: metadata, progress: progress)
            return .stored
        } catch {
            // Create-only slots: a denied write may mean these bytes already landed on an earlier attempt
            // (ambiguous network failure) or that an abandoned upload holds the slot. The owner may read their
            // own object, so compare checksums to tell the two apart.
            let nsError = error as NSError
            guard nsError.domain == StorageErrorDomain, nsError.code == StorageErrorCode.unauthorized.rawValue,
                  let existing = try? await ref.getMetadata() else { throw Self.failure(error) }
            guard let md5 = existing.md5Hash else { throw DIPSubmissionFailure.offline }
            if md5 == FirebasePhotoAlbumSource.md5Base64(jpeg) { progress(1); return .stored }
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
                if Task.isCancelled { task.cancel() }
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.uploads[id]?.cancel() }
        }
        try Task.checkCancellation()
    }

    func submit(scope: ChallengeReadScope, challengeID: String, progress: Double, caption: String, storagePath: String?) async throws {
        guard !stopped else { throw DIPSubmissionFailure.unauthenticated }
        var request: [String: Any] = [
            "contractVersion": 1, "companyId": scope.companyID, "challengeId": challengeID, "progress": progress, "caption": caption]
        if let storagePath { request["storagePath"] = storagePath }
        do {
            let result = try await functions.httpsCallable("submitChallengeV1").call(request)
            guard let data = result.data as? [String: Any],
                  data["submissionId"] as? String == DIPSubmissionPolicy.submissionID(challengeID: challengeID, uid: scope.uid)
            else { throw DIPSubmissionFailure.unknown }
        } catch { throw Self.failure(error) }
    }

    func stop() {
        stopped = true
        listeners.values.forEach { $0.remove() }; listeners.removeAll()
        uploads.values.forEach { $0.cancel() }; uploads.removeAll()
    }

    // MARK: Mapping

    /// Maps the server-written document into the transport-free value; nil for anything malformed or foreign.
    nonisolated static func record(id: String, fields: [String: Any], scope: ChallengeReadScope, challengeID: String) -> DIPSubmission? {
        guard id == DIPSubmissionPolicy.submissionID(challengeID: challengeID, uid: scope.uid),
              fields["companyId"] as? String == scope.companyID, fields["userId"] as? String == scope.uid,
              let raw = fields["status"] as? String, let status = DIPSubmissionStatus(rawValue: raw),
              let progress = (fields["progress"] as? NSNumber)?.doubleValue, progress.isFinite else { return nil }
        let points = (fields["pointsAwarded"] as? NSNumber)?.intValue ?? 0
        return DIPSubmission(
            id: id, status: status, progress: progress, caption: fields["caption"] as? String ?? "",
            storagePath: fields["storagePath"] as? String, attempt: max(1, (fields["attempt"] as? NSNumber)?.intValue ?? 1),
            reviewNote: fields["reviewNote"] as? String, pointsAwarded: max(0, points),
            updatedAt: (fields["updatedAt"] as? Timestamp)?.dateValue())
    }

    nonisolated static func failure(_ error: Error) -> DIPSubmissionFailure {
        if let failure = error as? DIPSubmissionFailure { return failure }
        let error = error as NSError
        if error.domain == FunctionsErrorDomain {
            let details = error.userInfo[FunctionsErrorDetailsKey] as? [String: Any]
            switch details?["reason"] as? String {
            case "CHALLENGE_CLOSED": return .closed
            case "CHALLENGE_NOT_OPEN": return .notStarted
            case "SUBMISSION_LOCKED": return .locked
            case "VALIDATION_FAILED", "CHALLENGE_NOT_FOUND": return .invalidInput
            case "UPLOAD_INVALID", "UPLOAD_NOT_FOUND": return .invalidImage
            case "MEMBERSHIP_CONFLICT": return .notMember
            case "UNAUTHENTICATED", "EMAIL_NOT_VERIFIED", "PROVIDER_NOT_ALLOWED": return .unauthenticated
            default: break
            }
            switch FunctionsErrorCode(rawValue: error.code) {
            case .unauthenticated: return .unauthenticated
            case .unavailable, .deadlineExceeded: return .offline
            default: return .unknown
            }
        }
        if error.domain == StorageErrorDomain {
            switch StorageErrorCode(rawValue: error.code) {
            case .unauthenticated: return .unauthenticated
            // Rules denial on upload: the window closed or the slot is taken (see `uploadEvidence`).
            case .unauthorized: return .closed
            case .retryLimitExceeded, .cancelled: return .offline
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
