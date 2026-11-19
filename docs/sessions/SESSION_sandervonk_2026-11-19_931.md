# Work session

User: sandervonk
Date: 2026-11-19
Workstream: ai-default-on
Agent: Claude (area owner for AI rollout policy, issue #196, AI-10)
Status: completed

## Summary

Implemented the owner decision to enable Dipbot (AI) for all organizations by default. A company with no `aiSettings/current` document, or one without an `enabled` field, is now ON; only an explicit `enabled: false` (or a malformed value, which fails closed) turns it off. All safety controls are unchanged. Added an idempotent operator opt-out script and rewrote the opt-in assumptions in the docs and the portal off-state copy.

## Changes

- gcp/functions/src/modules/ai/domain/quota.ts: new `companyAiEnabled`, used by `effectiveLimits` (the single place every AI, cover, venue, ideas and weekly-email path reads the per-company switch).
- scripts/set-company-ai.mjs: dry-run-by-default, idempotent merge write of `enabled` for one company.
- apps/admin/src/lib/i18n/catalog/en/ai.ts and es/ai.ts: off-state body no longer says an owner can turn it on.
- gcp/tests/unit/ai-application.test.ts, ai-domain.test.ts: default-on, explicit off, malformed fails closed, global kill switch wins, credits and quota still enforced, tenant isolation, context reports enabled for a company with no document.
- docs/ops/ai-events.md (new rollout policy summary, pilot, kill switches, checklist), docs/ops/launch-switches.md (3b), docs/design/stretch/ai-event-creation.md (status, kill switch, rollout and decisions), docs/contracts/admin.md, docs/design/stretch/admin-suggestions-email.md, CURRENT_STATE.md.

## Validation

Targeted only. From gcp/functions: node --import tsx --test over ai-application, ai-domain, ai-credits, ai-suggestions, ai-ideas-application, suggestions-application, places and covers unit tests: 391 pass, 0 fail. npx tsc --noEmit in gcp/functions: clean. npm run check:admin-i18n: OK (2033 keys in en and es). set-company-ai.mjs usage path run; no live or emulator write was performed. Firestore rules did not change, so the rules emulator was not run. ESLint is not configured at the repo root for gcp code, so it was not run. Full suites not run by design.

## Decisions

- A missing document or field means ON (no migration). Any non-true present value is OFF so a bad write fails closed.
- No portal opt-out control exists, so none was added; the opt-out is operator-only through the script or the console.
- Weekly email stays gated by its own email switches, so default-on does not send mail by itself. PLACES_ENABLED and AI_VENUES_ENABLED stay off by default.
- No billing or plan check was added; documented as the place to add a gate if a free tier appears.
- Worst case per company is about $2.25 a month ($2 metered plus about $0.25 of credit-bound cover and venue picks); platform ceiling $200 a month for metered spend.

## Handoff

Nothing is deployed; the behavior change reaches production with the next functions deploy. Before relying on it the owner should size the OpenAI project spend limit for default-on, read the OpenAI and TypeSafe AI data terms, confirm the privacy page is deployed, and move off gpt-4o-mini before January 14, 2027. After deploy, run the smoke test and per-company kill switch test in docs/ops/ai-events.md (Pilot section). The suggest-theme owner adds another AI callable; it should read the switch through effectiveLimits to inherit default-on.
