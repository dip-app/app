# Work session

User: sandervonk
Date: 2026-11-17
Workstream: backend-quality-audit
Agent: Claude Opus (audit lead)
Status: handoff

## Summary

Lead of the backend quality audit and hardening pass over the recently merged push router, notification preferences, email, tag counts, AI drafts and V2 admin modules, plus rules, indexes and TTL. Four read-only Sonnet reviews produced the findings; the lead re-verified each High finding in code, found one more (deactivated members keep callable access in RSVP, photo, organizer and challenge commands), dispatched six fix branches with disjoint file ownership, reviewed every diff, and requested one change (an event-age cutoff on newly retried triggers). The report is docs/quality/backend-audit-2026-11.md.

## Changes

- docs/quality/backend-audit-2026-11.md: findings with severity, evidence and fix status; deploy checklist; open owner decisions.
- Fix PRs (separate sessions 081 to 086): #250 date-independent admin tests, #251 email, #252 AI and tags, #253 push router, #254 admin, rules, indexes and TTL, #256 deactivation in callables.

## Validation

- Lead read the diffs of #251 to #254 and #256 and confirmed the High findings against main before fixes.
- Fixers ran targeted unit tests (email 209, AI and tags 215, push 90, admin 249, callables 103; all passing), `npm run build`, Firestore rules tests for the deactivation rules, `npm run test:sessions` and `scripts/check-docs.py`.
- Not run locally: the email, notifications, AI and tags emulator integration suites (the Firestore emulator port was busy). CI ran per PR; merges waited for green checks.

## Decisions

- One integrator (#254) for firestore.rules, storage.rules and firestore.indexes.json; other branches reported index needs instead of editing them.
- No contract edits: new error reasons stay in module reason lists; the AI per-admin cap reuses AI_DAILY_LIMIT.
- Bug-report quota not added (locked decision: no server rate limit for shake to report); tenancy stamping left for the owner.
- Self-targeted points and attendance are audited (`selfTarget`), not refused, pending an owner decision.
- Retried Firestore triggers drop events older than 10 minutes (chat) or 1 hour (changes, RSVPs) to bound retry storms.

## Handoff

- Coordinator: follow the deploy checklist in the audit doc (indexes and TTL, then functions, then rules; then alerts and the OpenAI project spend limit). Nothing was deployed.
- Owner decisions listed at the end of the audit doc.
- Pending: run `npm run test:email:integration`, `test:notifications:integration`, `test:ai:integration` and `test:tags:integration` on a machine with a free emulator port.
