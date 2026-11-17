# Work session

User: sandervonk
Date: 2026-11-17
Workstream: backend-quality-audit
Agent: Claude Sonnet (audit fixer)
Status: completed

## Summary

Fixed the verified audit findings for the admin API module and the shared Firestore config: one missing composite index, Firestore TTL policies for every expiring collection, rate limiting moved after authorization, instance caps, import and directory bounds, photo moderation cleanup and audit redaction, and deactivation checks in the Firestore rules. Branch `fix/audit-admin-rules-ttl`.

## Changes

- `gcp/firestore.indexes.json`: new COLLECTION index `challenges (type, endDate)` for the AI theme query; 15 TTL `fieldOverrides` (adminRateLimits, accountRateLimits, inviteRateLimits `expiresAt`; commandReceipts, importJobs, chunks, results, emailOutbox, emailCaps, aiRequests, aiUsageDaily, tagStatReceipts, notificationReceipts, pushRateLimits, pushReceipts `expireAt`). All other queries in the modules were checked against existing indexes: none missing.
- `gcp/functions/src/modules/admin`: `consumeAfterAuth` (context.ts) replaces 24 limiter calls (read-only authorize, then consume); `maxInstances` 10 and 3 (heavy), explicit timeout and memory; employee rows capped at 16 keys and unknown-column names cut to 60 characters; `scanAll` fails `IMPORT_TOO_LARGE` instead of truncating; `MAX_SCAN` 500; import job, chunks and results get `expireAt` (30 days); photo cleanup only when the photo existed and failures are logged (warn, ids only); audit keeps caption and comment lengths, not text; `selfTarget: true` on audit entries for self points adjustment and self attendance.
- `gcp/firestore.rules`: `activeSelf()` helper; `users/{uid}` update, `companies/{id}` get (via `sameCompany`), collection-group `rsvps` list (via `sameCompany`), own notification update and notification settings write now require an active member. Own profile read stays allowed. `memberCompany()` removed (unused).
- `gcp/storage.rules`: comment only (see Decisions).
- Docs: `docs/ops/deploy-runbook.md` TTL table and verification command; `docs/contracts/admin.md` (rate limit order, moderation, import bounds, scan size, selfTarget).
- Tests: new `gcp/tests/unit/admin-audit-fixes.test.ts` (13 tests), new `gcp/tests/rules/audit-deactivation.test.ts` (6 tests).

## Validation

- `npm run build` (repo root, Node 24.12.0): passed.
- `cd gcp && node --import tsx --test tests/unit/admin-*.test.ts tests/unit/ai-application.test.ts tests/unit/organizer-events.test.ts`: 249 passed, 0 failed.
- `node --import tsx --test --test-concurrency=1 gcp/tests/integration/admin*.test.ts` against the running Firestore emulator: 14 passed.
- Rules tests (`gcp/tests/rules/*.test.ts`) against the already running Firestore emulator on port 8080 (a stray emulator held the port, so `emulators:exec` could not start): all Firestore-only files pass including the 6 new tests; the Storage-dependent files could not run because no Storage emulator was available (fetch failed), and `storage.rules` has a comment-only change.
- `firestore.indexes.json` parsed as JSON; no duplicate index.
- `npm run test:sessions` (25 tests OK), `python3 scripts/check-docs.py` (276 documents OK). The full `session-log.py check` stops on an older unfinished log (SESSION_sandervonk_2026-11-10_007), unrelated to this change.

## Decisions

- Storage photo-create does not check `status`: cross-service Storage rules may read only two Firestore documents and the rule already reads the RSVP and the event. Documented in `storage.rules`; `finalizeEventPhotoV1` (photos module) should refuse deactivated members.
- Self points adjustment is still allowed (owner policy question); it is flagged with `selfTarget`.
- Insights cache single-flight left as is; `refresh` already needs `insights.read` and the admin rate limit.
- TTL overrides keep the default ascending and descending collection-scope indexes so existing behavior does not change.
- Not done by request: bug-report companyId migration and bug-report rate limiting.

## Handoff

- Deploy order: `firebase deploy --only firestore:indexes` (new index and TTL policies; the index builds before the AI themes query works) before the functions; `firestore:rules` after the functions.
- Challenge and organizer `commandReceipts` do not set `expireAt` (other modules), so they are never expired.
- `finalizeEventPhotoV1` has no deactivation check (photos module).
- Run the Storage rules tests with a Storage emulator in CI/local `npm run test:rules`.
