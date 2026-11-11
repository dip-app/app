# Challenge submissions (F3, V2-02)

Module `gcp/functions/src/modules/submissions` (domain / application / infrastructure / transport, same layering and App Check policy as the other callables). Implemented, unit-, rules- and emulator-tested (`npm run test:challenge-submissions:integration`, in CI); exported from `gcp/functions/src/index.ts`; **not deployed**. A weekly theme is a `Challenge`; a member's entry is `companies/{c}/challenges/{challengeId}/submissions/{challengeId}_{uid}`.

Schemas (additive): `SubmitChallengeRequest/Response`, `RejectChallengeRequest/Response`, `ListChallengeSubmissionsRequest/Response`; `ChallengeSubmission` gained optional server-owned `storagePath`, `contentType`, `sizeBytes`, `attempt`, `reviewedBy`, `reviewedAt`, `reviewNote`, `pointsAwarded` and `status` now documents the enum `submitted | approved | rejected`; `ApproveChallengeResponse` gained optional `replayed`. `ApproveChallengeRequest` is unchanged (`{contractVersion, companyId, challengeId, userId}`).

## States

| Status | Meaning | Member may |
|---|---|---|
| (no document) | not started | submit while the window is open |
| `submitted` | pending review (also right after a resubmission) | edit (same document, `outcome: updated`) while the window is open |
| `rejected` | organizer sent it back with `reviewNote` | resubmit while the window is open (`attempt` + 1, `outcome: resubmitted`, review fields cleared) |
| `approved` | points awarded (`pointsAwarded`) | nothing: locked (`SUBMISSION_LOCKED`) |

"Closed" is derived client-side (`now > endDate` and not approved). The server refuses writes outside the window with `CHALLENGE_NOT_OPEN` / `CHALLENGE_CLOSED`; organizers may still review after the window ends.

## Member command

`submitChallengeV1` `{contractVersion: 1, companyId, challengeId, progress, caption?, storagePath?}` -> `{contractVersion: 1, submissionId, status, outcome: created | updated | resubmitted | unchanged, attempt}`.

- Caller is derived from Auth (verified Google user with a server-owned membership in `companyId`, else `MEMBERSHIP_CONFLICT`). Unknown keys (`status`, `pointsAwarded`, `userId`, ...) fail `VALIDATION_FAILED` before any read.
- `progress` is a number in (0, goal] (over the theme's goal -> `VALIDATION_FAILED`, field `progress`); `caption` trimmed, <= 280 (default `""`).
- `storagePath` (optional) must be exactly one of the caller's five evidence slots `companies/{c}/challenges/{ch}/submissions/{uid}/{0..4}`. The object is verified (exists, 1 byte..10 MiB, jpeg/png/heic, file signature) inside the transaction (`UPLOAD_NOT_FOUND`, `UPLOAD_INVALID`; an invalid object is deleted, which frees the slot). A new photo needs a new slot (objects are create-only); the request always states the full content, so omitting `storagePath` removes the photo.
- **Idempotent:** identical content for an existing non-rejected submission returns `unchanged` with no writes (also after approval and after the window closed), so a lost response or double tap is harmless. Concurrent identical calls create one document; `participantCount` is incremented in the same transaction as the create only.
- Server owns `userId/userName/userAvatarId` (from `users/{uid}`), `status`, `attempt`, review fields, `pointsAwarded`, timestamps and the challenge counts. `photoURL` is always `null`: no download-token URLs are minted; clients read bytes through the authenticated Storage SDK.
- Reasons: `UNAUTHENTICATED`, `EMAIL_NOT_VERIFIED`, `PROVIDER_NOT_ALLOWED`, `VALIDATION_FAILED` (`details.fields`), `MEMBERSHIP_CONFLICT`, `CHALLENGE_NOT_FOUND`, `CHALLENGE_NOT_OPEN`, `CHALLENGE_CLOSED`, `SUBMISSION_LOCKED`, `UPLOAD_NOT_FOUND`, `UPLOAD_INVALID`.

## Organizer commands (portal API; no client write path)

All three require a verified Google caller whose server-owned `users/{uid}.role == "admin"` and whose company equals `companyId` (`NOT_ORGANIZER`, `COMPANY_MISMATCH`). Reviewing your own submission fails `SELF_REVIEW`.

| Export | Payload -> response | Behavior |
|---|---|---|
| `approveChallengeV1` | `{contractVersion, companyId, challengeId, userId}` -> `{contractVersion, submissionId, pointsAwarded, replayed?}` | `submitted` -> `approved` in **one transaction**: submission (`reviewedBy`, `reviewedAt`, `pointsAwarded`), `challenge.completedCount + 1`, ledger entry `companies/{c}/pointTransactions/challenge_{challengeId}_{uid}` (`{companyId, userId, amount, reason: "challenge_approved", sourceId: challengeId, createdAt}`, create-only) and `users/{uid}.pointsBalance + amount`. Amount is the challenge's `pointsReward` at approval time; `0` creates no ledger entry. A repeat or concurrent approval returns `pointsAwarded: 0, replayed: true`; an existing ledger entry never awards twice. `rejected` -> `SUBMISSION_NOT_PENDING` (the member must resubmit first). The submitter must still be in the company (`SUBMITTER_NOT_FOUND`). |
| `rejectChallengeV1` | `{contractVersion, companyId, challengeId, userId, reason}` -> `{contractVersion, submissionId, status: "rejected", replayed}` | `submitted` -> `rejected` with `reviewNote = reason` (1..280, trimmed). Repeat = `replayed: true`. `approved` is final: `SUBMISSION_LOCKED` (no reversal flow until specified). |
| `listChallengeSubmissionsV1` | `{contractVersion, companyId, challengeId, status?, limit? (1..50, default 25), cursor?}` -> `{contractVersion, submissions: ChallengeSubmission[], nextCursor}` | Review queue, ordered by submission ID, filtered by `status`. `nextCursor` is the last submission ID of the page, or `null`. Each item includes `storagePath`; the portal reads the evidence bytes through the authenticated Storage SDK (organizer read rule below). |

Also: `SUBMISSION_NOT_FOUND`, `CHALLENGE_NOT_FOUND` (`not-found`). Organizers have no Firestore read path to submissions on purpose: the list callable is the portal's read API.

## Rules

- **Firestore** `challenges/{ch}/submissions/{challengeId}_{uid}`: verified same-company `get` of your own document only (a missing own document is observable); no list, no client writes. `pointTransactions/{id}`: same-company members `get`/`list` (limit <= 100) only entries with `userId == auth.uid`; no client writes.
- **Storage** `companies/{c}/challenges/{ch}/submissions/{uid}/{slot}` (`gcp/storage.rules`): create-only slots `0..4`, own folder, 1 byte..10 MiB, `image/jpeg|png|heic`, the caller's profile company equals `{c}` and the challenge window is open (two cross-service Firestore reads, the platform limit). `get` for the owner and same-company organizers (`role == "admin"`); no listing, no delete, no download-token URLs.

## Deployment (owner)

`firebase deploy --only storage,firestore:rules,functions:dip:submitChallengeV1,functions:dip:approveChallengeV1,functions:dip:rejectChallengeV1,functions:dip:listChallengeSubmissionsV1`. Storage rules that call `firestore.get` need the cross-service Firestore permission (already required by album uploads). No new index: the list uses an equality filter plus document-ID ordering.

## Accepted V2 gaps

Unfinalized evidence uploads are not swept (at most 5 x 10 MiB per member per challenge, invisible to others). `approved` is not reversible. Points shown in the iOS app come from the submission's `pointsAwarded` and the observed profile balance. No push notification on approval or rejection yet.
