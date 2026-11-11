# Work session

User: sandervonk
Date: 2026-11-11
Workstream: admin-backend
Agent: Claude (Sonnet)
Status: handoff

## Summary

Built the admin backend for tickets #121 to #126 on `feature/admin-backend` (from `feature/v2-combined`): role/permission matrix, append-only audit log, shared command conventions, album moderation, attendee management and attendance, member management, bulk import and roster pre-provisioning. The contract doc and additive schema were pushed first (directly to `feature/v2-combined`) so the portal could build against them. Per the coordinator's follow-up, `updateEventV1` also accepts the `completed` status.

## Changes

- `docs/contracts/admin.md` (new): callables, permission matrix, error reasons, audit shape, roster/import models, implementation notes.
- `contracts/v1/models.schema.json` + generated TS/Swift: additions only (member `workLocation/teamIds/status/...`, `Company.membershipMode`, `Team`, `AuditEntry`, `RosterEntry`, import types, admin requests/responses, `organizer` role, `UpdateEventRequest.status=completed` + `statusReason`, `RecordAttendanceRequest.checkedIn`).
- `gcp/functions/src/modules/admin/**` (new module) and exports in `gcp/functions/src/index.ts`: 18 callables.
- `gcp/functions/src/modules/accounts/**`: roster claim, `membershipMode`, deactivated and `organizer` handling in `resolveMembershipV1`.
- `gcp/functions/src/modules/organizer/**`: `completed` status transitions (`EVENT_NOT_ENDED`, `STATUS_TRANSITION_BLOCKED`), `organizer` role accepted, `hasAnyPhoto` port.
- `gcp/firestore.rules`: deactivated members lose same-company reads; `organizer` role; admin-only `auditLog`, `roster`, `importJobs`; `teams` for members; new server-owned member keys.
- Tests: `gcp/tests/unit/admin-*.test.ts`, `accounts-roster-claim.test.ts`, `organizer-events.test.ts` additions, `gcp/tests/rules/admin.test.ts`, `gcp/tests/integration/admin-adapter.test.ts`, `contracts/tests/admin.test.mjs`; script `test:adminapi:integration` and its CI step.
- `CURRENT_STATE.md`, `docs/contracts/{callables,data-ownership}.md`.

## Validation

Run locally (Node 24): `tsc -p gcp/functions --noEmit` clean; all `gcp/tests/unit/*.test.ts` (286 tests) and `contracts/tests/*.test.mjs` (31) pass. NOT run, by instruction: `npm run check`, `npm run test:rules`, emulator suites (`test:adminapi:integration` and the others) and any Swift/Xcode build. The rules test and the emulator adapter test were written without being executed; expect small fixes on their first run.

## Decisions

- `organizer` is a new additive role; existing `admin` accounts keep every right. Organizers: events, attendees, attendance, album moderation, member read (no points). Admins: everything.
- Photo removal is a hard delete (no undo window); audit keeps uploader, path and caption snapshot.
- Admin add beyond capacity raises the event capacity to attendeeCount + 1 (keeps `attendeeCount <= capacity` that `setRsvpV1` asserts) with a mandatory reason.
- Member directory is a callable (`listMembersV1`); `users/{uid}` stays self-read only.
- Roster is keyed by SHA-256 of the lower-case email; `membershipMode` (`open` default, `rosterOnly`) lives on the company document.
- Import: client parses CSV/XLSX, server plans (dry run) then applies one 100-row chunk per call under a lease; counters can be approximate after an interrupted chunk.
- Ledger path is `companies/{c}/pointTransactions/{id}` (deterministic ids).

## Handoff

Owner to run: `npm run check`, `npm run test:rules`, `npm run test:adminapi:integration`, `npm run test:organizer:integration`, `npm run test:accounts:integration`. Challenge callables are still admin-only (not on the `can` matrix); the portal agent should treat that as a known gap. No callable is deployed; Storage deletion needs the Functions service account's existing storage access.
