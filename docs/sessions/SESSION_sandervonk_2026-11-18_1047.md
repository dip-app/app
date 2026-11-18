# Work session

User: sandervonk
Date: 2026-11-18
Workstream: audit-coverage
Agent: Codex
Status: completed

## Summary
Extended the admin audit log to the privileged commands that did not write entries: events, weekly themes, theme review decisions, cover picks/imports and the ideas-email test send. Members, roles/status, teams, roster, import, photos, attendance, AI drafts, office and email schedule already audited. No event delete command exists server-side, so none was added.

## Changes
- gcp/functions/src/modules/admin/domain: auditActions.ts (11 new keys), audit.ts (target types, `auditEntry` helper).
- organizer, challenges, submissions: `writeAudit` on the transaction ports and Firestore adapters (create-only, server timestamp); commands write the entry in the command transaction.
- covers/pickCover.ts and suggestions/manage.ts: entries through the admin store.
- apps/admin/src/lib/auditLabels.ts: labels and categories for every new key.
- docs/contracts/admin.md: audit coverage note.
- Rules and indexes: no change (auditLog is already admin-read and client-write-denied; entries are read by createdAt, existing index).

## Validation
- tsc --noEmit (gcp/functions) clean.
- node --test: organizer-events, challenges, challenge-submissions, covers, covers-live-application, suggestions-application, places, admin-* (321 tests, 0 failed), including new tests for auth denial, tenant isolation, one entry per command and replay, and no free text in entries.
- vitest apps/admin auditLabels.test.ts passed (labels cover every backend key).
- Not run: full suites, rules/emulator tests, Xcode. Not deployed.

## Decisions
- Ids are deterministic: create uses actor+requestId, update uses target+revision, review uses challenge+user(+attempt), cover uses actor+requestId, test send uses actor+hour. Replays return before writing.
- Reject reasons, descriptions and addresses are never copied into entries; descriptions show as "edited".
- Cover audit is best-effort (logged on failure) so an audit write never fails a charged pick.

## Handoff
- Event delete and company email enable/disable have no server command yet; add an audit key when they land.
- Existing fakes of the three store ports gained `writeAudit`; any new fake must too.
