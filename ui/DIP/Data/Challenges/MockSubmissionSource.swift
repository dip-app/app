import DIPCore
import Foundation

/// In-memory submission source for previews, unconfigured Debug builds and tests. It behaves like the server:
/// identical content is an idempotent replay, status is never taken from the caller, and the test hooks below stand
/// in for an organizer (`review`) and for failures (`failures`, `uploadFailures`). No network, no persistence.
@MainActor final class MockSubmissionSource: SubmissionSource {
    private(set) var current: DIPSubmission?
    private(set) var uploadedSlots: [Int] = []
    private(set) var uploadAttempts = 0
    private(set) var submitCalls = 0
    private(set) var submitWrites = 0
    private var continuations: [UUID: AsyncThrowingStream<DIPSubmission?, Error>.Continuation] = [:]
    /// Failures thrown by the next `submit` calls, one each (then the call succeeds).
    var failures: [DIPSubmissionFailure] = []
    var uploadFailures: [DIPSubmissionFailure] = []
    /// Slots that already hold other bytes (answered with `.slotOccupied`).
    var occupied: Set<Int> = []
    var pointsReward = 50
    var delay: Duration = .zero
    private(set) var stopped = false
    /// How the first read answers: normally, never (skeleton review) or with an error (retry review).
    enum Load { case normal, never, fails }
    var load: Load

    init(initial: DIPSubmission? = nil, load: Load = .normal) { current = initial; self.load = load }

    func observe(scope: ChallengeReadScope, challengeID: String) -> AsyncThrowingStream<DIPSubmission?, Error> {
        AsyncThrowingStream { continuation in
            let id = UUID()
            switch load {
            case .fails: continuation.finish(throwing: DIPSubmissionFailure.offline); return
            case .never: break
            case .normal: continuation.yield(current)
            }
            continuations[id] = continuation
            continuation.onTermination = { [weak self] _ in Task { @MainActor in self?.continuations[id] = nil } }
        }
    }

    func uploadEvidence(scope: ChallengeReadScope, challengeID: String, slot: Int, jpeg: Data,
                        progress: @escaping @Sendable (Double) -> Void) async throws -> AlbumUploadOutcome {
        uploadAttempts += 1
        if delay > .zero { try await Task.sleep(for: delay) }
        if !uploadFailures.isEmpty { throw uploadFailures.removeFirst() }
        guard (0..<DIPSubmissionPolicy.slots).contains(slot), jpeg.count <= DIPSubmissionPolicy.maxBytes else { throw DIPSubmissionFailure.invalidImage }
        if occupied.contains(slot) { return .slotOccupied }
        occupied.insert(slot); uploadedSlots.append(slot)
        progress(0.5); progress(1)
        return .stored
    }

    func submit(scope: ChallengeReadScope, challengeID: String, progress: Double, caption: String, storagePath: String?) async throws {
        submitCalls += 1
        if delay > .zero { try await Task.sleep(for: delay) }
        if !failures.isEmpty { throw failures.removeFirst() }
        let id = DIPSubmissionPolicy.submissionID(challengeID: challengeID, uid: scope.uid)
        if let current {
            if current.status == .approved, current.progress != progress || current.caption != caption || current.storagePath != storagePath {
                throw DIPSubmissionFailure.locked
            }
            if current.status != .rejected, current.progress == progress, current.caption == caption, current.storagePath == storagePath { return }
        }
        let resubmitted = current?.status == .rejected
        submitWrites += 1
        emit(DIPSubmission(id: id, status: .submitted, progress: progress, caption: caption, storagePath: storagePath,
                           attempt: current.map { $0.attempt + (resubmitted ? 1 : 0) } ?? 1, updatedAt: Date()))
    }

    /// Stands in for the organizer's callable (tests and previews only).
    func review(approve: Bool, note: String? = nil) {
        guard var entry = current else { return }
        entry.status = approve ? .approved : .rejected
        entry.pointsAwarded = approve ? pointsReward : 0
        entry.reviewNote = approve ? nil : note
        emit(entry)
    }

    func failStream(_ failure: DIPSubmissionFailure) {
        continuations.values.forEach { $0.finish(throwing: failure) }
        continuations.removeAll()
    }

    func stop() {
        stopped = true
        continuations.values.forEach { $0.finish() }; continuations.removeAll()
    }

    private func emit(_ entry: DIPSubmission) {
        current = entry
        continuations.values.forEach { $0.yield(entry) }
    }
}
