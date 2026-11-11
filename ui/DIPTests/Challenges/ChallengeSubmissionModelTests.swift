import XCTest
import DIPCore
@preconcurrency import FirebaseFirestore
@preconcurrency import FirebaseFunctions
@preconcurrency import FirebaseStorage
@testable import DIP

@MainActor
final class ChallengeSubmissionModelTests: XCTestCase {
    private let scope = ChallengeReadScope(uid: "alice", companyID: "alpha")
    private let start = Date(timeIntervalSince1970: 1_794_200_400)
    private var end: Date { start.addingTimeInterval(7 * 86_400 - 1) }
    private var id: String { DIPSubmissionPolicy.submissionID(challengeID: "w1", uid: "alice") }

    private func model(_ source: MockSubmissionSource, now: Date? = nil) -> ChallengeSubmissionModel {
        let weekly = DIPWeeklyChallenge(id: "w1", title: "Fitness", description: "Move", goal: 5, goalUnit: "workouts",
                                        coverImageURL: "catalog://theme/fitness", startDate: start, endDate: end, pointsReward: 50, participantCount: 1)
        let clockNow = now ?? start.addingTimeInterval(86_400)
        return ChallengeSubmissionModel(
            challenge: DIPChallengeProjection.detail(weekly), goal: 5, scope: scope, source: source, clock: { clockNow },
            prepare: { ChallengeSubmissionModel.PickedPhoto(jpeg: $0, thumbnail: nil) })
    }

    private func loaded(_ source: MockSubmissionSource, now: Date? = nil) async -> ChallengeSubmissionModel {
        let model = model(source, now: now)
        model.start()
        for _ in 0..<50 where model.load == .loading { try? await Task.sleep(for: .milliseconds(10)) }
        return model
    }

    private func settle(_ model: ChallengeSubmissionModel, until condition: () -> Bool) async {
        for _ in 0..<100 where !condition() { try? await Task.sleep(for: .milliseconds(10)) }
    }

    func testLoadsTheOwnEntryAndDerivesState() async {
        let source = MockSubmissionSource(initial: DIPSubmission(id: id, status: .submitted, progress: 2))
        let model = await loaded(source)
        XCTAssertEqual(model.load, .ready)
        XCTAssertEqual(model.state, .pending(DIPSubmission(id: id, status: .submitted, progress: 2), canEdit: true))
        XCTAssertEqual(model.goalText, "5 workouts")
    }

    func testReadFailureShowsRetryableErrorAndRetryRecovers() async {
        let source = MockSubmissionSource(load: .fails)
        let model = await loaded(source)
        XCTAssertEqual(model.load, .failed(DIPSubmissionCopy.loadFailure))
        source.load = .normal
        model.retryLoad()
        await settle(model) { model.load == .ready }
        XCTAssertEqual(model.load, .ready)
        XCTAssertEqual(model.state, .notStarted)
    }

    func testInvalidDraftSendsNothingAndShowsIssues() async {
        let source = MockSubmissionSource()
        let model = await loaded(source)
        model.beginEditing()
        let sent = await model.send()
        XCTAssertFalse(sent)
        XCTAssertEqual(source.submitCalls, 0)
        XCTAssertTrue(model.showsIssues)
        XCTAssertEqual(model.issues, [.progressMissing])
        model.draft.progressText = "9"
        let tooHigh = await model.send()
        XCTAssertFalse(tooHigh)
        XCTAssertEqual(model.issues, [.progressTooHigh(goalText: "5 workouts")])
        XCTAssertEqual(source.submitCalls, 0)
    }

    func testSendWithoutPhotoSubmitsAndTheListenerShowsPending() async {
        let source = MockSubmissionSource()
        let model = await loaded(source)
        model.beginEditing()
        model.draft = DIPSubmissionDraft(progressText: "3", caption: "  Ran  ")
        let sent = await model.send()
        XCTAssertTrue(sent)
        XCTAssertEqual(model.submittedCount, 1)
        XCTAssertEqual(source.current?.caption, "Ran")
        XCTAssertEqual(source.current?.status, .submitted)
        XCTAssertNil(source.current?.storagePath)
        XCTAssertEqual(source.uploadAttempts, 0)
        await settle(model) { model.submission != nil }
        XCTAssertEqual(model.state.statusLabel, "Waiting for review")
        XCTAssertEqual(model.phase, .idle)
    }

    func testPhotoUploadsOnceAndAFailedSubmitRetryReusesTheUpload() async {
        let source = MockSubmissionSource()
        source.failures = [.offline]
        let model = await loaded(source)
        model.beginEditing()
        model.draft.progressText = "2"
        await model.pickPhoto { Data([0xff, 0xd8, 0xff]) }
        XCTAssertTrue(model.hasPhoto)
        let first = await model.send()
        XCTAssertFalse(first)
        XCTAssertEqual(model.failure, .offline)
        XCTAssertEqual(model.draft.progressText, "2", "the draft survives a failure")
        XCTAssertTrue(model.hasPhoto)
        let retry = await model.send()
        XCTAssertTrue(retry)
        XCTAssertEqual(source.uploadAttempts, 1, "the retry does not upload again")
        XCTAssertEqual(source.current?.storagePath, DIPSubmissionPolicy.evidencePath(companyID: "alpha", challengeID: "w1", uid: "alice", slot: 0))
        XCTAssertEqual(source.submitWrites, 1)
    }

    func testOccupiedSlotMovesToTheNextAndExhaustionIsReported() async {
        let source = MockSubmissionSource()
        source.occupied = [0, 1]
        let model = await loaded(source)
        model.beginEditing()
        model.draft.progressText = "1"
        await model.pickPhoto { Data([1]) }
        _ = await model.send()
        XCTAssertEqual(source.uploadedSlots, [2])
        // Every slot taken: a clear, non-retryable message.
        let full = MockSubmissionSource()
        full.occupied = Set(0..<DIPSubmissionPolicy.slots)
        let other = await loaded(full)
        other.beginEditing()
        other.draft.progressText = "1"
        await other.pickPhoto { Data([1]) }
        let sent = await other.send()
        XCTAssertFalse(sent)
        XCTAssertEqual(other.failure, .noSlotsLeft)
        XCTAssertEqual(full.submitCalls, 0)
        other.removePhoto()
        XCTAssertNil(other.failure)
    }

    func testRepeatedSendIsIdempotent() async {
        let source = MockSubmissionSource()
        let model = await loaded(source)
        model.beginEditing()
        model.draft.progressText = "3"
        _ = await model.send()
        await settle(model) { model.submission != nil }
        model.beginEditing()
        let again = await model.send()
        XCTAssertTrue(again)
        XCTAssertEqual(source.submitWrites, 1, "identical content writes once")
    }

    func testPhotoPreparationFailuresLeaveTheDraftAndSayWhy() async {
        let source = MockSubmissionSource()
        let model = await loaded(source)
        model.beginEditing()
        model.draft.progressText = "1"
        await model.pickPhoto { throw AlbumImageProcessing.Failure.unreadable }
        XCTAssertEqual(model.failure, .invalidImage)
        XCTAssertFalse(model.hasPhoto)
        XCTAssertEqual(model.draft.progressText, "1")
        model.dismissFailure()
        XCTAssertEqual(model.phase, .idle)
    }

    func testRejectedEntryCanBeResubmittedAndThenApprovedWithPoints() async {
        let source = MockSubmissionSource(initial: DIPSubmission(id: id, status: .rejected, progress: 2, caption: "old", reviewNote: "Too dark"))
        let model = await loaded(source)
        XCTAssertEqual(model.state.actionTitle, "Update and resubmit")
        model.beginEditing()
        XCTAssertEqual(model.draft, DIPSubmissionDraft(progressText: "2", caption: "old"))
        model.draft.caption = "new"
        let sent = await model.send()
        XCTAssertTrue(sent)
        await settle(model) { model.submission?.status == .submitted }
        XCTAssertEqual(model.submission?.attempt, 2)
        XCTAssertNil(model.submission?.reviewNote)
        source.review(approve: true)
        await settle(model) { model.submission?.status == .approved }
        XCTAssertEqual(model.state.detail, "You earned +50 points.")
        XCTAssertNil(model.state.actionTitle)
    }

    func testClosedWindowAndApprovedEntryRefuseToSend() async {
        let closed = MockSubmissionSource()
        let afterEnd = await loaded(closed, now: end.addingTimeInterval(60))
        XCTAssertEqual(afterEnd.state, .missed)
        afterEnd.beginEditing()
        afterEnd.draft.progressText = "1"
        let sent = await afterEnd.send()
        XCTAssertFalse(sent)
        XCTAssertEqual(afterEnd.failure, .closed)
        XCTAssertEqual(closed.submitCalls, 0)
        let approved = MockSubmissionSource(initial: DIPSubmission(id: id, status: .approved, progress: 3, pointsAwarded: 50))
        let locked = await loaded(approved)
        locked.beginEditing()
        locked.draft.progressText = "4"
        let lockedSent = await locked.send()
        XCTAssertFalse(lockedSent)
        XCTAssertEqual(locked.failure, .locked)
    }

    func testDiscardConfirmationOnlyWhenTheDraftChanged() async {
        let model = await loaded(MockSubmissionSource())
        model.beginEditing()
        XCTAssertFalse(model.needsDiscardConfirmation)
        model.draft.progressText = "1"
        XCTAssertTrue(model.needsDiscardConfirmation)
    }

    func testStopEndsTheSource() async {
        let source = MockSubmissionSource()
        let model = await loaded(source)
        model.stop()
        XCTAssertTrue(source.stopped)
    }

    // MARK: Firebase mapping

    func testRecordMappingAcceptsOnlyTheMembersOwnWellFormedDocument() {
        let fields: [String: Any] = ["companyId": "alpha", "userId": "alice", "status": "rejected", "progress": 2.5, "caption": "x",
                                     "storagePath": "companies/alpha/challenges/w1/submissions/alice/1", "attempt": 2,
                                     "reviewNote": "Dark", "pointsAwarded": 0, "updatedAt": Timestamp(seconds: 1_794_200_400, nanoseconds: 0)]
        let record = FirebaseSubmissionSource.record(id: id, fields: fields, scope: scope, challengeID: "w1")
        XCTAssertEqual(record?.status, .rejected)
        XCTAssertEqual(record?.progress, 2.5)
        XCTAssertEqual(record?.attempt, 2)
        XCTAssertEqual(record?.reviewNote, "Dark")
        XCTAssertEqual(DIPSubmissionPolicy.slot(of: record?.storagePath), 1)
        var other = fields; other["userId"] = "bob"
        XCTAssertNil(FirebaseSubmissionSource.record(id: id, fields: other, scope: scope, challengeID: "w1"))
        var foreign = fields; foreign["companyId"] = "beta"
        XCTAssertNil(FirebaseSubmissionSource.record(id: id, fields: foreign, scope: scope, challengeID: "w1"))
        var badStatus = fields; badStatus["status"] = "paid"
        XCTAssertNil(FirebaseSubmissionSource.record(id: id, fields: badStatus, scope: scope, challengeID: "w1"))
        XCTAssertNil(FirebaseSubmissionSource.record(id: "w1_bob", fields: fields, scope: scope, challengeID: "w1"))
        var noPath = fields; noPath["storagePath"] = NSNull(); noPath["attempt"] = 0
        XCTAssertNil(FirebaseSubmissionSource.record(id: id, fields: noPath, scope: scope, challengeID: "w1")?.storagePath)
        XCTAssertEqual(FirebaseSubmissionSource.record(id: id, fields: noPath, scope: scope, challengeID: "w1")?.attempt, 1)
    }

    func testFailureMappingFromCallableReasonsAndSDKDomains() {
        func callable(_ reason: String) -> NSError {
            NSError(domain: FunctionsErrorDomain, code: FunctionsErrorCode.failedPrecondition.rawValue,
                    userInfo: [FunctionsErrorDetailsKey: ["reason": reason]])
        }
        XCTAssertEqual(FirebaseSubmissionSource.failure(callable("CHALLENGE_CLOSED")), .closed)
        XCTAssertEqual(FirebaseSubmissionSource.failure(callable("CHALLENGE_NOT_OPEN")), .notStarted)
        XCTAssertEqual(FirebaseSubmissionSource.failure(callable("SUBMISSION_LOCKED")), .locked)
        XCTAssertEqual(FirebaseSubmissionSource.failure(callable("UPLOAD_INVALID")), .invalidImage)
        XCTAssertEqual(FirebaseSubmissionSource.failure(callable("MEMBERSHIP_CONFLICT")), .notMember)
        XCTAssertEqual(FirebaseSubmissionSource.failure(callable("VALIDATION_FAILED")), .invalidInput)
        XCTAssertEqual(FirebaseSubmissionSource.failure(NSError(domain: FunctionsErrorDomain, code: FunctionsErrorCode.unavailable.rawValue)), .offline)
        XCTAssertEqual(FirebaseSubmissionSource.failure(NSError(domain: NSURLErrorDomain, code: NSURLErrorNotConnectedToInternet)), .offline)
        XCTAssertEqual(FirebaseSubmissionSource.failure(NSError(domain: StorageErrorDomain, code: StorageErrorCode.unauthenticated.rawValue)), .unauthenticated)
        XCTAssertEqual(FirebaseSubmissionSource.failure(NSError(domain: StorageErrorDomain, code: StorageErrorCode.unauthorized.rawValue)), .uploadDenied)
        XCTAssertEqual(FirebaseSubmissionSource.failure(NSError(domain: "other", code: 1)), .unknown)
        XCTAssertEqual(FirebaseSubmissionSource.failure(DIPSubmissionFailure.tooLarge), .tooLarge)
    }
}
