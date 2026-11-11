# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Challenge submissions iOS (F3, V2-02)
Agent: claude
Status: handoff

## Summary

iOS half of F3 on top of the backend PR #128: members add an entry (progress, note, optional photo) to the open weekly theme from the theme page, see its status (pending, approved with points, needs changes with the organizer's note, closed) and can edit or resubmit while the window is open. Nothing awards points on the client.

## Changes

- DIPCore: `ChallengeSubmission.swift` (status, entry value, policy and slot rules, draft validation, `DIPSubmissionState` machine, failures and copy), `DIPChallengeDetail` gained numeric `goal` and `pointsReward`, `statusNote(submissionsOpen:)`, updated how-it-works copy.
- App: `SubmissionSource` protocol and environment context (Domain/Challenges), `ChallengeSubmissionModel` (upload then submit, retry without re-upload, idempotent), `DIPChallengeSubmissionSection` and `DIPChallengeSubmissionSheet` (Features/Challenge), `FirebaseSubmissionSource` and `MockSubmissionSource` (Data/Challenges), wiring in `DIPApp` and `FirebaseBootstrap`.
- Preview: `ChallengeSubmissionPreview` (`--challenge-submission=<state>`), `ChallengeSubmissionTests` UI tests, project.yml source entry.
- Tests: `ChallengeSubmissionTests` (DIPCore), `ChallengeSubmissionModelTests` (DIPTests, includes Firebase mapping).
- Docs: FRONTEND_PLAN rows.

## Validation

- `swift test --filter ChallengeSubmissionTests` in DIPCore passed (14 tests) together with ChallengeWindowTests.
- Preview scheme built; `ChallengeSubmissionTests` (10) and `ChallengePhaseTests` (3) UI tests passed on the shared Claude-DIP simulator.
- DIP scheme `build-for-testing` succeeded; `ChallengeSubmissionModelTests` (15), `MemberChallengeReadTests` and `ChallengeDocumentMapperTests` passed.
- Not run: remaining DIPTests/UI suites, design audit and code review (deferred by the owner until integration).

## Decisions

- No Figma frame exists for the entry flow; the sheet reuses the bug-report sheet structure, the event-page info card, shared pill, button, empty-state and skeleton patterns. Needs design review.
- Evidence photos reuse the album preparation (JPEG, 2048 px) and the create-only slot pattern (5 slots).
- Haptics: opening the sheet is silent; a valid Send is a commit, success and failure are felt after.

## Handoff

Backend deploy (rules plus four functions) is required before the live adapter works. Device upload and the photo picker path are unverified; the evidence photo is not previewed after sending (status shows "Attached").
