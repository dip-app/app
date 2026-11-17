# Work session

User: sandervonk
Date: 2026-11-17
Workstream: backend-quality-audit
Agent: Claude Sonnet (audit fixer)
Status: completed

## Summary

Closed an authorization gap: members with `users/{uid}.status = "deactivated"` were still accepted by setRsvpV1, finalizeEventPhotoV1, createEventV1/updateEventV1 and createChallengeV1/updateChallengeV1. Each now refuses with permission-denied / `ACCOUNT_DEACTIVATED` inside the same transaction as the membership read, before any target resource is read. Also added `expireAt` to organizer and challenge command receipts so the commandReceipts TTL policy applies.

## Changes

- gcp/functions/src/modules/participation/application/setRsvp.ts: deactivated check after the membership check.
- gcp/functions/src/modules/photos/application/finalizeEventPhoto.ts and photos/domain/errors.ts: check before the event read; reason added to PhotoErrorReason.
- gcp/functions/src/modules/organizer/ (organizerCommands.ts, ports.ts, errors.ts, firestoreOrganizerStore.ts): `status` read into the membership, check in requireOrganizer, reason added, receipts get `expireAt` = now + 30 days.
- gcp/functions/src/modules/challenges/ (challengeCommands.ts, ports.ts, errors.ts, firestoreChallengeStore.ts): same as organizer.
- gcp/functions/src/modules/admin/domain/member.ts: `isDeactivated` parameter widened to `{ status?: unknown }` so it is reusable as the shared helper.
- docs/contracts/callables.md: documented the cross-callable ACCOUNT_DEACTIVATED rule and the photo callable reason.
- Tests: gcp/tests/unit/{participation,photos,organizer-events,challenges}.test.ts.
- Invites (listCoworkers, sendInvite, respondToInvite) already use invitePolicy.isActiveMember, which refuses deactivated accounts; verified, no change. Share page is public and skipped. Notification callables act only on the caller's own preferences and were not changed.

## Validation

- `cd gcp/functions && node --import tsx --test ../tests/unit/{organizer-events,challenges,photos,participation,invites}.test.ts`: 103 passed, 0 failed.
- `npm run build` at repo root: passed.
- Integration/emulator tests were not run (not needed for these unit-level changes); no full suites run.

## Decisions

- ACCOUNT_DEACTIVATED is already a stable reason in the accounts, admin and submissions modules. Photos, organizer and challenges keep module-local reason unions, so it was added there; no change to contracts/v1 or generated models.
- Reused `isDeactivated` from admin/domain/member.ts (existing cross-module domain import precedent: accounts imports admin/domain). A missing status counts as active.
- Receipt `expireAt` is written by the Firestore stores (additive field, no renames).
- CURRENT_STATE.md already states deactivated members are refused by the callables; it is now accurate, so it was left unchanged.

## Handoff

PR open for review, not merged. Follow-up: confirm the commandReceipts TTL policy is deployed on `expireAt` (infrastructure not touched here); existing receipts without `expireAt` will not expire.
