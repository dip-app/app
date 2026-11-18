# Work session

User: sandervonk
Date: 2026-11-18
Workstream: audit-action-labels
Agent: Claude
Status: completed

## Summary
Audit log rows show a readable label and a category chip instead of raw keys such as ai.generateDrafts. 22 backend audit actions are labeled; the list is now a typed constant and a test keeps the portal labels in sync.

## Changes
- gcp/functions/src/modules/admin/domain/auditActions.ts (new, typed list), domain/audit.ts (action typed)
- apps/admin/src/lib/auditLabels.ts (new: labels, categories, humanizer, AI facts), exports.ts (CSV adds label, key, category), adminTypes.ts (old AUDIT_ACTIONS removed), adminMock.ts (seeded history)
- apps/admin/src/app/audit/page.tsx, styles/pro.scss (category chip, URL-backed category filter, AI facts, raw key in details)
- apps/admin/src/lib/__tests__/auditLabels.test.ts (new)

## Validation
- apps/admin: npx vitest run (390 passed), tsc --noEmit, eslint on touched files
- gcp/functions: npx tsc --noEmit
- Screenshots at 1440 and 390 in mock mode; self-reviewed, no auditor subagent run

## Decisions
- Only actions the backend writes are labeled (events, challenges, covers, email sends, tags write no audit entries today); the test fails on stale labels too.
- Unknown keys fall back to a humanized label under Settings; raw key only in tooltip, details and CSV.

## Handoff
When a backend writer adds an audit action, add it to AUDIT_ACTIONS and to auditLabels.ts.

