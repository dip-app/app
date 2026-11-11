import DIPCore
import DIPDesignSystem
import Foundation
import Observation

/// View model for one weekly theme's "Your entry" section and the entry sheet.
///
/// - The member's entry is observed live; nothing here awards or sets status (the server does).
/// - Submitting uploads a new photo first (create-only slot, progress, never re-uploaded on retry), then calls
///   `submitChallengeV1`. Both steps are idempotent, so a failed or repeated press can never double-submit, and the
///   draft survives a failure.
/// - Photos reuse the album preparation (JPEG, <= 2048 px, metadata dropped).
@MainActor @Observable
final class ChallengeSubmissionModel {
    enum Phase: Equatable {
        case idle
        case preparingPhoto
        case uploading(Double)
        case sending
        case failed(DIPSubmissionFailure)
        var isBusy: Bool {
            switch self {
            case .preparingPhoto, .uploading, .sending: true
            case .idle, .failed: false
            }
        }
    }

    enum Load: Equatable { case loading, ready, failed(String) }

    struct PickedPhoto: Equatable {
        let jpeg: Data
        let thumbnail: Data?
    }

    typealias Prepare = @Sendable (Data) throws -> PickedPhoto

    let challenge: DIPChallengeDetail
    let goal: Double
    private(set) var submission: DIPSubmission?
    private(set) var load: Load = .loading
    private(set) var phase: Phase = .idle
    /// Counts completed submissions; the sheet dismisses and the host announces/haptics when it changes.
    private(set) var submittedCount = 0
    var draft = DIPSubmissionDraft()
    /// Set after the first Send press so inline issues appear only once the member tried.
    private(set) var showsIssues = false
    private(set) var photo: PickedPhoto?
    /// An existing photo kept as is while editing (nil once removed or replaced).
    private(set) var keepsExistingPhoto = false
    /// True when the last failure happened while uploading the photo (not while sending the entry).
    private(set) var uploadFailed = false

    /// Small display copy of the submitted photo for the status row; nil until loaded or when there is none.
    enum Evidence: Equatable {
        case none
        case loading
        case loaded(Data)
        case failed
    }
    /// The submitted photo (large display copy) for the status card and the existing-photo row.
    private(set) var evidence: Evidence = .none
    @ObservationIgnored private var evidencePath: String?

    @ObservationIgnored private let scope: ChallengeReadScope
    @ObservationIgnored private let source: any SubmissionSource
    @ObservationIgnored private let clock: () -> Date
    @ObservationIgnored private let prepare: Prepare
    @ObservationIgnored private var observation: Task<Void, Never>?
    /// The path of the draft photo once uploaded; a retry reuses it instead of uploading again.
    @ObservationIgnored private var uploadedPath: String?
    /// Slots known to hold other bytes (a previous entry's photo, an abandoned upload).
    @ObservationIgnored private var occupiedSlots: Set<Int> = []

    init(challenge: DIPChallengeDetail, goal: Double, scope: ChallengeReadScope, source: any SubmissionSource,
         clock: @escaping () -> Date = Date.init, prepare: @escaping Prepare = ChallengeSubmissionModel.preparePhoto) {
        self.challenge = challenge; self.goal = goal; self.scope = scope; self.source = source
        self.clock = clock; self.prepare = prepare
    }

    // MARK: Derived state

    var state: DIPSubmissionState { DIPSubmissionState.state(phase: challenge.phase(now: clock()), submission: submission) }
    var goalText: String { challenge.goalText ?? DIPSubmissionDraft.format(goal) }
    /// The touch control's grid: one step up to the goal.
    var step: Double { DIPSubmissionPolicy.step(forGoal: goal) }
    var progressValue: Double {
        get { DIPSubmissionPolicy.clamp(draft.progress ?? step, goal: goal) }
        set { draft.progressText = DIPSubmissionDraft.format(DIPSubmissionPolicy.clamp(newValue, goal: goal)) }
    }
    var canDecrease: Bool { progressValue > step + 0.0001 }
    var canIncrease: Bool { progressValue < goal - 0.0001 }
    func nudge(_ direction: Double) { progressValue += direction * step }
    var issues: [DIPSubmissionIssue] { draft.issues(goal: goal, goalText: goalText) }
    var canSend: Bool { !phase.isBusy && issues.isEmpty }
    var hasPhoto: Bool { photo != nil || keepsExistingPhoto }
    var failure: DIPSubmissionFailure? { if case .failed(let failure) = phase { failure } else { nil } }
    /// True when the sheet has something the member would lose by closing it.
    var needsDiscardConfirmation: Bool {
        let base = submission.map(DIPSubmissionDraft.init(from:)) ?? DIPSubmissionDraft(progressText: DIPSubmissionDraft.format(step))
        return draft != base || photo != nil
    }

    /// The sheet's one action, in the shared bottom bar (same pill as "Activity Chat"): Send, in-flight, or retry.
    var sheetBarAction: DIPBottomBarAction {
        switch phase {
        case .preparingPhoto: return .init(title: "Getting your photo ready…", identifier: "submission.sending", showsProgress: true)
        case .uploading(let value): return .init(title: "Uploading photo \(Int((value * 100).rounded()))%", identifier: "submission.sending", showsProgress: true)
        case .sending: return .init(title: "Sending…", identifier: "submission.sending", showsProgress: true)
        case .failed(let failure):
            if failure.isRetryable { return .init(title: uploadFailed ? "Retry upload" : "Try again", identifier: "submission.send", kind: .commit) }
            return .init(title: sendTitle, identifier: "submission.send", kind: .commit)
        case .idle: return .init(title: sendTitle, identifier: "submission.send", icon: "system:paperplane", kind: .commit)
        }
    }

    var sendTitle: String {
        switch submission?.status {
        case .rejected?: "Resubmit entry"
        case .submitted?, .approved?: "Save changes"
        case nil: "Send entry"
        }
    }

    /// The theme page's entry action for the shared bar (nil when there is nothing to press).
    var pageBarAction: DIPBottomBarAction? {
        guard load == .ready, let title = state.actionTitle else { return nil }
        return .init(title: title, identifier: "submission.action")
    }

    // MARK: Lifecycle

    func start() {
        guard observation == nil else { return }
        let stream = source.observe(scope: scope, challengeID: challenge.id)
        observation = Task { [weak self] in
            do {
                for try await value in stream {
                    guard let self else { return }
                    self.submission = value
                    self.load = .ready
                }
            } catch is CancellationError {
                return
            } catch {
                guard let self else { return }
                // Keep a known entry visible when a refresh fails (offline); otherwise show the retryable error.
                if self.submission == nil { self.load = .failed(DIPSubmissionCopy.loadFailure) }
            }
        }
    }

    func retryLoad() {
        observation?.cancel(); observation = nil
        load = .loading
        start()
    }

    func stop() {
        observation?.cancel(); observation = nil
        source.stop()
    }

    /// Loads the submitted photo once per path (large display copy through the member's own Storage read); a failure
    /// is shown with a retry (`force`), never silently.
    func loadEvidence(force: Bool = false) async {
        guard let path = submission?.storagePath else { evidence = .none; evidencePath = nil; return }
        if !force, path == evidencePath, evidence != .failed { return }
        evidencePath = path
        evidence = .loading
        do {
            let data = try await source.evidenceData(scope: scope, path: path)
            guard submission?.storagePath == path else { return }
            if let copy = AlbumImageProcessing.displayCopy(data, maxPixelSize: 1200) { evidence = .loaded(copy) } else { evidence = .failed }
        } catch is CancellationError {
            if evidence == .loading { evidence = .failed }
        } catch {
            if submission?.storagePath == path { evidence = .failed }
        }
    }

    /// Previews and tests only: puts an already prepared photo into the draft.
    func attachPreparedPhoto(_ jpeg: Data) {
        guard let picked = try? prepare(jpeg) else { return }
        photo = picked; uploadedPath = nil; keepsExistingPhoto = false
    }

    // MARK: Editing

    /// Opens the sheet: a fresh draft for a new entry, or the existing entry for an edit or resubmission.
    func beginEditing() {
        guard !phase.isBusy else { return }
        showsIssues = false; phase = .idle; uploadFailed = false
        photo = nil; uploadedPath = nil
        if let submission {
            draft = DIPSubmissionDraft(from: submission)
            progressValue = submission.progress
            keepsExistingPhoto = submission.hasPhoto
            if let slot = DIPSubmissionPolicy.slot(of: submission.storagePath) { occupiedSlots.insert(slot) }
        } else {
            // A new entry starts at the smallest step: always valid, and the member moves it up.
            draft = DIPSubmissionDraft(progressText: DIPSubmissionDraft.format(step)); keepsExistingPhoto = false
        }
    }

    /// Prepares a picked photo off the main thread; failures leave the draft untouched with a clear message.
    func pickPhoto(_ loader: @escaping @Sendable () async throws -> Data) async {
        guard !phase.isBusy else { return }
        phase = .preparingPhoto
        let prepare = prepare
        do {
            let raw = try await loader()
            let prepared = try await Task.detached(priority: .userInitiated) { try prepare(raw) }.value
            photo = prepared; uploadedPath = nil; keepsExistingPhoto = false
            phase = .idle
        } catch AlbumImageProcessing.Failure.tooLarge {
            phase = .failed(.tooLarge)
        } catch is CancellationError {
            phase = .idle
        } catch {
            phase = .failed(.invalidImage)
        }
    }

    func removePhoto() {
        guard !phase.isBusy else { return }
        photo = nil; uploadedPath = nil; keepsExistingPhoto = false; uploadFailed = false
        if case .failed = phase { phase = .idle }
    }

    func dismissFailure() { if case .failed = phase { phase = .idle }; uploadFailed = false }

    /// After a failed upload: drops the photo and sends the entry as a note only.
    @discardableResult
    func sendWithoutPhoto() async -> Bool {
        removePhoto()
        return await send()
    }

    // MARK: Sending

    /// Uploads a new photo (if any), then submits. Returns true when the server accepted the entry.
    @discardableResult
    func send() async -> Bool {
        showsIssues = true
        guard !phase.isBusy, issues.isEmpty, let progress = draft.progress else { return false }
        guard state.actionTitle != nil else { phase = .failed(state.submission?.status == .approved ? .locked : .closed); return false }
        let path: String?
        uploadFailed = false
        do { path = try await evidencePath() } catch let failure as DIPSubmissionFailure {
            if !Task.isCancelled { phase = .failed(failure); uploadFailed = true }; return false
        } catch { if !Task.isCancelled { phase = .failed(.unknown); uploadFailed = true }; return false }
        phase = .sending
        do {
            try await source.submit(scope: scope, challengeID: challenge.id, progress: progress, caption: draft.trimmedCaption, storagePath: path)
            photo = nil; uploadedPath = nil; keepsExistingPhoto = path != nil
            phase = .idle; showsIssues = false
            submittedCount += 1
            return true
        } catch is CancellationError {
            phase = .idle; return false
        } catch {
            phase = .failed(error as? DIPSubmissionFailure ?? .unknown)
            return false
        }
    }

    /// The path to submit: the kept photo, the already uploaded draft photo, a fresh upload, or nil.
    private func evidencePath() async throws -> String? {
        if let photo {
            if let uploadedPath { return uploadedPath }
            phase = .uploading(0)
            while let slot = DIPSubmissionPolicy.freeSlot(used: occupiedSlots) {
                let outcome = try await source.uploadEvidence(scope: scope, challengeID: challenge.id, slot: slot, jpeg: photo.jpeg) { [weak self] value in
                    Task { @MainActor in self?.progress(value) }
                }
                switch outcome {
                case .stored:
                    let path = DIPSubmissionPolicy.evidencePath(companyID: scope.companyID, challengeID: challenge.id, uid: scope.uid, slot: slot)
                    uploadedPath = path; occupiedSlots.insert(slot)
                    return path
                case .slotOccupied: occupiedSlots.insert(slot)
                }
            }
            throw DIPSubmissionFailure.noSlotsLeft
        }
        return keepsExistingPhoto ? submission?.storagePath : nil
    }

    private func progress(_ value: Double) {
        guard case .uploading(let current) = phase, value > current else { return }
        phase = .uploading(min(1, value))
    }

    /// JPEG at most 2048 px and 10 MB, plus a small thumbnail for the draft (same preparation as album photos).
    nonisolated static func preparePhoto(_ data: Data) throws -> PickedPhoto {
        let upload = try AlbumImageProcessing.prepareUpload(data, maxPixelSize: DIPSubmissionPolicy.maxPixelSize, maxBytes: DIPSubmissionPolicy.maxBytes)
        return PickedPhoto(jpeg: upload, thumbnail: AlbumImageProcessing.displayCopy(upload, maxPixelSize: 600))
    }
}
