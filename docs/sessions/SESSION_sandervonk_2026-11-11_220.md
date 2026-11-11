# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Challenge submissions backend (F3, V2-02)
Agent: claude
Status: handoff

## Summary

Backend half of F3: members submit proof (progress, note, optional photo) to the open weekly theme; organizers approve or reject through callables only; approval awards points through the server ledger. The iOS half is a separate PR.

## Changes

- `contracts/v1/models.schema.json` (additions only) plus regenerated TS/Swift: `SubmitChallenge*`, `RejectChallenge*`, `ListChallengeSubmissions*`, optional server-owned `ChallengeSubmission` fields, `ApproveChallengeResponse.replayed`.
- New module `gcp/functions/src/modules/submissions`: `submitChallengeV1`, `approveChallengeV1`, `rejectChallengeV1`, `listChallengeSubmissionsV1` (thin callables, application services, pure policy, Firestore adapter reusing the photo object inspector).
- `gcp/firestore.rules`: own-submission get, own ledger reads, no client writes. `gcp/storage.rules`: create-only evidence slots 0..4 under the challenge, window-open and same-company checks, owner/organizer reads.
- Tests: `gcp/tests/unit/challenge-submissions.test.ts` (18 passing locally), `gcp/tests/rules/challenge-submissions.test.ts`, `gcp/tests/integration/challenge-submissions-callable.test.ts` (new npm script and CI step), `contracts/tests/challenge-submissions.test.mjs`.
- Docs: `docs/contracts/challenge-submissions.md`, callables and data-ownership pointers.

## Validation

- `node --import tsx --test gcp/tests/unit/challenge-submissions.test.ts` passed (18 tests) and `tsc --noEmit` in `gcp/functions` is clean.
- Not run (deferred by the owner until integration): rules tests, emulator integration test, contract test, `npm run check`.

## Decisions

- Statuses `submitted | approved | rejected`; a resubmission after rejection returns to `submitted` with `attempt + 1`. Approved is final.
- Evidence uses five create-only slots per member per challenge (same pattern as album slots); no download-token URLs.
- Organizers read the queue only through `listChallengeSubmissionsV1`; Storage lets same-company admins read evidence bytes.
- Ledger entry ID `challenge_{challengeId}_{uid}`, written with the balance, submission and completed count in one transaction.

## Handoff

Owner deploys rules and the four functions (see docs/contracts/challenge-submissions.md). Admin portal agent builds the review UI on the list/approve/reject callables. iOS adapter is in the companion PR.
