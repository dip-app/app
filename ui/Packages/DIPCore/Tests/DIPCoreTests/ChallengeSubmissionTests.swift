import XCTest
@testable import DIPCore

final class ChallengeSubmissionTests: XCTestCase {
    private func entry(_ status: DIPSubmissionStatus, points: Int = 0, note: String? = nil) -> DIPSubmission {
        DIPSubmission(id: "w1_u", status: status, progress: 3, caption: "Ran", reviewNote: note, pointsAwarded: points)
    }

    // MARK: Draft validation

    func testEmptyProgressIsMissing() {
        XCTAssertEqual(DIPSubmissionDraft().issues(goal: 5, goalText: "5 workouts"), [.progressMissing])
        XCTAssertEqual(DIPSubmissionDraft(progressText: "  ").issues(goal: 5, goalText: "5 workouts"), [.progressMissing])
    }

    func testProgressMustBePositiveAndWithinGoal() {
        XCTAssertEqual(DIPSubmissionDraft(progressText: "0").issues(goal: 5, goalText: "5"), [.progressInvalid])
        XCTAssertEqual(DIPSubmissionDraft(progressText: "-2").issues(goal: 5, goalText: "5"), [.progressInvalid])
        XCTAssertEqual(DIPSubmissionDraft(progressText: "abc").issues(goal: 5, goalText: "5"), [.progressInvalid])
        XCTAssertEqual(DIPSubmissionDraft(progressText: "nan").issues(goal: 5, goalText: "5"), [.progressInvalid])
        XCTAssertEqual(DIPSubmissionDraft(progressText: "6").issues(goal: 5, goalText: "5 workouts"), [.progressTooHigh(goalText: "5 workouts")])
        XCTAssertTrue(DIPSubmissionDraft(progressText: "5").isValid(goal: 5, goalText: "5"))
        XCTAssertTrue(DIPSubmissionDraft(progressText: "0.5").isValid(goal: 5, goalText: "5"))
    }

    func testDecimalCommaIsAccepted() {
        XCTAssertEqual(DIPSubmissionDraft(progressText: "2,5").progress, 2.5)
        XCTAssertEqual(DIPSubmissionDraft(progressText: " 3 ").progress, 3)
    }

    func testCaptionLimitCountsTrimmedText() {
        let long = String(repeating: "a", count: DIPSubmissionPolicy.maxCaption + 1)
        XCTAssertEqual(DIPSubmissionDraft(progressText: "1", caption: long).issues(goal: 5, goalText: "5"), [.captionTooLong])
        XCTAssertTrue(DIPSubmissionDraft(progressText: "1", caption: "  " + String(repeating: "a", count: DIPSubmissionPolicy.maxCaption) + " ").isValid(goal: 5, goalText: "5"))
        XCTAssertEqual(DIPSubmissionDraft(progressText: "1", caption: "  hi  ").trimmedCaption, "hi")
    }

    func testDraftFromSubmissionFormatsWholeNumbers() {
        XCTAssertEqual(DIPSubmissionDraft(from: entry(.rejected)).progressText, "3")
        XCTAssertEqual(DIPSubmissionDraft(from: DIPSubmission(id: "x", status: .submitted, progress: 2.5, caption: "n")).progressText, "2.5")
    }

    // MARK: Slots and paths

    func testEvidencePathAndSlotParsing() {
        let path = DIPSubmissionPolicy.evidencePath(companyID: "c", challengeID: "w1", uid: "u", slot: 3)
        XCTAssertEqual(path, "companies/c/challenges/w1/submissions/u/3")
        XCTAssertEqual(DIPSubmissionPolicy.slot(of: path), 3)
        XCTAssertNil(DIPSubmissionPolicy.slot(of: nil))
        XCTAssertNil(DIPSubmissionPolicy.slot(of: "companies/c/challenges/w1/submissions/u/5"))
        XCTAssertNil(DIPSubmissionPolicy.slot(of: "companies/c/challenges/w1/submissions/u/03"))
        XCTAssertEqual(DIPSubmissionPolicy.submissionID(challengeID: "w1", uid: "u"), "w1_u")
    }

    func testFreeSlotSkipsUsedAndRunsOut() {
        XCTAssertEqual(DIPSubmissionPolicy.freeSlot(used: []), 0)
        XCTAssertEqual(DIPSubmissionPolicy.freeSlot(used: [0, 1, 3]), 2)
        XCTAssertNil(DIPSubmissionPolicy.freeSlot(used: [0, 1, 2, 3, 4]))
    }

    // MARK: State machine

    func testStateWithoutEntryFollowsTheWindow() {
        XCTAssertEqual(DIPSubmissionState.state(phase: .upcoming, submission: nil), .upcoming)
        XCTAssertEqual(DIPSubmissionState.state(phase: .active, submission: nil), .notStarted)
        XCTAssertEqual(DIPSubmissionState.state(phase: nil, submission: nil), .notStarted)
        XCTAssertEqual(DIPSubmissionState.state(phase: .ended, submission: nil), .missed)
        XCTAssertEqual(DIPSubmissionState.notStarted.actionTitle, "Add your entry")
        XCTAssertNil(DIPSubmissionState.upcoming.actionTitle)
        XCTAssertNil(DIPSubmissionState.missed.actionTitle)
    }

    func testPendingIsEditableOnlyWhileTheWindowIsOpen() {
        XCTAssertEqual(DIPSubmissionState.state(phase: .active, submission: entry(.submitted)), .pending(entry(.submitted), canEdit: true))
        XCTAssertEqual(DIPSubmissionState.state(phase: .ended, submission: entry(.submitted)), .pending(entry(.submitted), canEdit: false))
        XCTAssertEqual(DIPSubmissionState.pending(entry(.submitted), canEdit: true).actionTitle, "Edit entry")
        XCTAssertNil(DIPSubmissionState.pending(entry(.submitted), canEdit: false).actionTitle)
    }

    func testApprovedIsFinalAndShowsPointsEvenAfterTheWindow() {
        for phase in [DIPChallengePhase.active, .ended] {
            let state = DIPSubmissionState.state(phase: phase, submission: entry(.approved, points: 50))
            XCTAssertEqual(state, .approved(entry(.approved, points: 50)))
            XCTAssertNil(state.actionTitle)
            XCTAssertEqual(state.detail, "You earned +50 points.")
        }
        XCTAssertEqual(DIPSubmissionState.approved(entry(.approved)).detail, "Approved. Thanks for taking part.")
    }

    func testRejectedExplainsAndAllowsResubmitOnlyInTheWindow() {
        let open = DIPSubmissionState.state(phase: .active, submission: entry(.rejected, note: "Blurry photo"))
        XCTAssertEqual(open.actionTitle, "Update and resubmit")
        XCTAssertEqual(open.statusLabel, "Needs changes")
        XCTAssertTrue(open.detail.contains("Organizer note: Blurry photo"))
        let closed = DIPSubmissionState.state(phase: .ended, submission: entry(.rejected, note: "Blurry photo"))
        XCTAssertNil(closed.actionTitle)
        XCTAssertTrue(closed.detail.contains("This theme has ended."))
        XCTAssertEqual(DIPSubmissionState.rejected(entry(.rejected), canResubmit: true).detail, "Update your entry and send it again.")
    }

    func testLabelsAreDistinctPerState() {
        let labels = [DIPSubmissionState.upcoming, .notStarted, .missed, .pending(entry(.submitted), canEdit: true),
                      .approved(entry(.approved)), .rejected(entry(.rejected), canResubmit: true)].map(\.statusLabel)
        XCTAssertEqual(Set(labels).count, labels.count)
    }

    // MARK: Failures

    func testFailureRetryability() {
        XCTAssertTrue(DIPSubmissionFailure.offline.isRetryable)
        XCTAssertTrue(DIPSubmissionFailure.unknown.isRetryable)
        for failure in [DIPSubmissionFailure.closed, .uploadDenied, .locked, .invalidImage, .tooLarge, .noSlotsLeft, .notMember] {
            XCTAssertFalse(failure.isRetryable)
        }
        XCTAssertTrue(DIPSubmissionFailure.noSlotsLeft.message.contains("\(DIPSubmissionPolicy.slots)"))
    }

    func testStatusNoteNamesTheLastDayWhenSubmissionsAreOpen() {
        let start = Date(timeIntervalSince1970: 1_731_300_000)
        let end = start.addingTimeInterval(7 * 86_400)
        let detail = DIPChallengeDetail(id: "w", title: "Fitness", image: nil, timing: "", description: "", tags: [], startDate: start, endDate: end)
        let locale = Locale(identifier: "en_US")
        XCTAssertEqual(detail.statusNote(now: start.addingTimeInterval(3_600), locale: locale), DIPChallengeText.submissionsSoon)
        XCTAssertTrue(detail.statusNote(now: start.addingTimeInterval(3_600), submissionsOpen: true, locale: locale).hasPrefix("Entries close "))
        XCTAssertEqual(detail.statusNote(now: end.addingTimeInterval(1), submissionsOpen: true, locale: locale), "This weekly theme has ended")
    }

    // MARK: Touch control

    func testStepFollowsTheGoal() {
        XCTAssertEqual(DIPSubmissionPolicy.step(forGoal: 3), 1)
        XCTAssertEqual(DIPSubmissionPolicy.step(forGoal: 100), 1)
        XCTAssertEqual(DIPSubmissionPolicy.step(forGoal: 5000), 50)
        XCTAssertEqual(DIPSubmissionPolicy.step(forGoal: 2.5), 0.5)
        XCTAssertEqual(DIPSubmissionPolicy.step(forGoal: 30.5), 1.5)
        XCTAssertEqual(DIPSubmissionPolicy.step(forGoal: 0), 1)
    }

    func testClampSnapsWithinOneStepAndTheGoal() {
        XCTAssertEqual(DIPSubmissionPolicy.clamp(0, goal: 3), 1)
        XCTAssertEqual(DIPSubmissionPolicy.clamp(2.4, goal: 3), 2)
        XCTAssertEqual(DIPSubmissionPolicy.clamp(99, goal: 3), 3)
        XCTAssertEqual(DIPSubmissionPolicy.clamp(.nan, goal: 3), 1)
        XCTAssertEqual(DIPSubmissionPolicy.clamp(7, goal: 2.5), 2.5)
        // Every clamped value passes the draft validation for its goal.
        for goal in [1.0, 3, 7, 2.5, 120, 10_000] {
            for raw in [-5.0, 0, 0.3, goal / 2, goal, goal * 3] {
                let value = DIPSubmissionPolicy.clamp(raw, goal: goal)
                XCTAssertTrue(DIPSubmissionDraft(progressText: DIPSubmissionDraft.format(value)).isValid(goal: goal, goalText: "g"), "\(raw) of \(goal) -> \(value)")
            }
        }
    }
}
