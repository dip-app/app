# Work session

User: sandervonk
Date: 2026-11-11
Workstream: admin-backend
Agent: Claude (Sonnet)
Status: completed

## Summary

Fixed the one failing emulator test of `test:adminapi:integration`. The cause was removal logic, not the test: `removeEventPhotoV1` stored the transaction-time comment count (400) on its idempotency receipt, but the first call returned 450 after cleanup, so a replay returned a different result.

## Changes

- `gcp/functions/src/modules/admin/application/moderation.ts`: after the idempotent cleanup the completed outcome (`commentsRemoved`, `objectRemoved`) is written back to the receipt, so a replay returns exactly the first result.

## Validation

Node 24 with the Firestore emulator: `npm run test:adminapi:integration` 14/14 pass; admin unit tests 87/87 pass. Contract unchanged (removal complete, idempotent, one audit entry).

## Decisions

Receipt update is a second small transaction after cleanup; if it is lost the replay still converges (cleanup re-runs, extra count is 0) and only the reported count may stay at the transaction-time value.

## Handoff

Deploy `removeEventPhotoV1` only.
