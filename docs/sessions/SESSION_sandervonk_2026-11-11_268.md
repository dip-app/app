# Work session

User: sandervonk
Date: 2026-11-11
Workstream: admin-backend
Agent: Claude (Sonnet)
Status: handoff

## Summary

Owner clarification applied on `feature/roster-everyone`: there is no roster-only mode. Anyone with a verified company-domain email joins as today, and the roster always lists everyone.

## Changes

- Removed `membershipMode`/rosterOnly everywhere: schema (`Company.membershipMode`, `UpdateCompanySettings*`) and generated types, `updateCompanySettingsV1` and its permission, `NOT_ON_ROSTER`, accounts onboarding policy, docs and tests.
- `resolveMembershipV1` records every first join on the roster in the same transaction: claims an invited entry, creates a claimed `signup` entry for people never pre-imported, or overwrites a revoked entry with the real member.
- `RosterEntry` additions: `memberStatus`, `source: signup`, `invitedBy` optional. `updateMemberV1`, import and `setMemberStatusV1` keep the member's roster entry in sync.
- Emulator/test-only backfill: `backfillRoster` (admin application) and `gcp/scripts/backfill-roster.ts` (refuses without a local `FIRESTORE_EMULATOR_HOST`).
- Tests updated: accounts claim, admin members (roster sync, backfill), contracts, emulator adapter test.

## Validation

Local, Node 24: `tsc` clean; all unit tests (327) and contract tests pass. Not run by instruction: rules and emulator suites, `npm run check`, Swift.

## Decisions

- The roster list is a direct admin read of `companies/{c}/roster`; no list callable.
- Returning members do not touch the roster on sign-in (no extra read per launch); existing production members appear only after the owner-run backfill.
- `updateCompanySettingsV1` was never deployed, so no deployed function is deleted.

## Handoff

Deploy: Firestore rules unchanged by this PR. Functions changed: `resolveMembershipV1` (and the admin module's `updateMemberV1`, `setMemberStatusV1`, `applyEmployeeImportV1`). The portal's `apps/admin` types may still list a `company.settings` audit label; harmless.
