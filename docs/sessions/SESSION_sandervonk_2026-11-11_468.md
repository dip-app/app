# Work session

User: sandervonk
Date: 2026-11-11
Workstream: admin-bug-reports
Agent: claude
Status: active

## Summary

Admin bug reports inbox: three admin-only callables (`listBugReportsV1`, `getBugReportV1`, `updateBugReportV1`), a server-owned triage document per report, and a "Bug reports" screen in the admin portal (Support group, new-count badge).

## Changes

- contracts/v1/models.schema.json (additive: AdminBugReport*, List/Get/UpdateBugReport requests and responses, audit target `bugReport`) and generated TypeScript/Swift models.
- gcp/functions/src/modules/admin: domain/bugReports.ts, application/bugReports.ts, request parsers, `bugreport.manage` permission (admin only), error reasons, store ports (`getMany`, `scanNewest`, `ObjectStore.readUrl`), Firestore/Storage adapters, callable exports.
- gcp/firestore.rules: explicit deny for `companies/{c}/bugReportTriage/{id}`; comments in firestore.rules/storage.rules updated.
- Tests: gcp/tests/unit/admin-bug-reports.test.ts, gcp/tests/rules/bug-reports.test.ts (triage deny), apps/admin/src/lib/__tests__/bugReports.test.ts, fake store helpers.
- apps/admin: app/bug-reports/page.tsx, lib/bugReports.ts, lib/bugBadge.ts, mock and live adapters, Shell nav + badge, AdminOnly copy, styles.
- docs/contracts/admin.md.

## Validation

- `npx tsc --noEmit` in gcp/functions and apps/admin, `npx eslint src` in apps/admin: clean.
- `node --import tsx --test gcp/tests/unit/admin-bug-reports.test.ts`: 16 passing. `npx vitest run src/lib/__tests__/bugReports.test.ts`: 11 passing.
- Full unit, rules and emulator suites are run once at the end of the integration, not per edit.

## Decisions

- A report belongs to the company of its reporter's `users/{uid}` membership, resolved at read time; no company is stored on the client-created document. Listing scans newest first in bounded batches (1000 first page, 500 later) and filters in memory, so no composite index is added.
- Triage state (status, note, assignee) lives in `companies/{c}/bugReportTriage/{reportId}`; clients have no access; bugReports stays immutable.
- Screenshot: v4 signed URL (15 minutes) for the exact `bugReports/{uid}/{reportId}.jpg`; falls back to an inline data URL when signing is not permitted.

## Handoff

- Deploy (not done): functions listBugReportsV1, getBugReportV1, updateBugReportV1; Firestore rules. The Functions service account needs `roles/iam.serviceAccountTokenCreator` on itself for signed URLs, else the inline fallback is used.
- Unverified: emulator and rules suites, real signed URL, live portal against deployed callables.
