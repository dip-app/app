# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Stream C shake to report
Agent: Claude Code
Status: handoff

## Summary

Implements shake-to-report on the integration branch `feature/v2-remaining` (branch `feature/v2-stream-c`): a report sheet opened by the system shake or Profile > "Report a problem", with a screenshot captured before the sheet, category chips, description, optional app details, an offline queue, and a Firestore + Storage destination behind a `BugReportSubmitting` protocol. Nothing is deployed.

## Changes

- `ui/Packages/DIPCore/Sources/DIPCore/BugReport/*`: pure models, draft validation, diagnostics builder, `ShakeGate` (debounce, 10 s after close), `BugReportOutbox` (5 per uid, 7 days, 2/8/30 s backoff, discard per uid), `BugReportSender`, `BugReportSubmitting` + `MockBugReportSubmitter`. Tests in `BugReportTests.swift`.
- `ui/DIP/Features/BugReport/*`: `UIWindow.motionEnded` shake detector, screenshot capture, sheet, form model, modifier. `ui/DIP/Data/BugReports/FirebaseBugReportSubmitter.swift`: Firestore document mapper and Firestore + Storage adapter.
- Wiring: `DIPApp`, `DIPMemberHome` (context, tour suppression, queue discard on sign-out), `DIPPrototypeApp` (route kind), `DIPProfileScreen` (toggle + button), `FirebaseBootstrap` (submitter, Storage emulator), `PreviewApp`.
- Design system (additive): `DIPHapticEvent.shake` (soft impact); `DIPBottomBarAction.icon` accepts `system:<symbol>`.
- `gcp/firestore.rules` (`bugReports`), `gcp/storage.rules` (`bugReports/{uid}/{reportId}.jpg`), `gcp/tests/rules/bug-reports.test.ts`.
- Tests: `DIPTests/BugReport/BugReportAppTests.swift`, `ComponentPreview/UITests/BugReportFlowTests.swift`.

## Validation

See the PR description for exact results.

## Decisions

- Destination: Firestore `bugReports/{reportId}` (create-only, client-generated UUID id) plus Storage JPEG; the screenshot is not an inline Firestore blob (1 MiB document limit).
- No `models.schema.json` change: the document is a rules-enforced shape, not a callable wire contract; the rules and `BugReportDocument` are the source of truth and are tested against each other.
- The report stores the caller's uid (rules: uid == auth.uid) for follow-up and abuse handling; no name, email, token or company.
- Not built: markup editor, the shake "prompt" step (the sheet opens directly), server rate limiting (client rules cannot rate-limit), VoiceOver direct-open special case.

## Handoff

Deploy commands are in the PR description. The owner must approve any rules deploy.
