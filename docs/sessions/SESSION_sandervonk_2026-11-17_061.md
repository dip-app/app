# Work session

User: sandervonk
Date: 2026-11-17
Workstream: ai-flow-suggestions
Agent: Claude
Status: completed

## Summary

Dipbot Suggest for the admin AI flow: a new additive callable returns, per choice, the option the decision model ranks first (Jev, then the OpenAI triage model, then a deterministic heuristic), and the portal shows it as an informational outline tag ("Perfect fit", "Great choice", "Good match"; no percentages) with a "Use suggestions" action that fills only tagged choices. The AI features are now branded Dipbot (one copy module). Every option card carries a flat mascot illustration; loading, empty, generating and results states are illustrated. Design crit by a fresh auditor subagent: round 1 fixes (suggested vs selected state, merge on apply, art consistency, column breakpoints, copy), round 2 PASS.

## Changes

- Contract: `GetEventIdeaSuggestionsRequest`, `AiStepSuggestion`, `GetEventIdeaSuggestionsResponse` in `contracts/v1/models.schema.json` (additive) and regenerated TS/Swift models.
- Backend (new files only, plus two export lines): `gcp/functions/src/modules/ai/domain/suggestions.ts` (questions, shared privacy-safe state, argmax interpretation, heuristic, code-written reasons, past-event aggregation), `application/suggestions.ts` (auth `ai.generate`, AI-off check, per-session cache in `companies/{c}/aiSuggestions/{uid}_{sessionId}` for 1 h, budget pre-check, provider chain, spend metered into month/day totals, content-free log), `infrastructure/suggestionSources.ts` (Firestore past events, demo provider), `transport/suggestionCallables.ts` (`getEventIdeaSuggestionsV1`); `modules/ai/index.ts`, `src/index.ts` exports.
- Tests: `gcp/tests/unit/ai-suggestions.test.ts` (16), `apps/admin/src/lib/__tests__/suggestionLabels.test.ts` (thresholds, boundaries, ties, missing values, provider caps, apply/merge, mock levels).
- Portal: `src/lib/aiStrings.ts` (Dipbot copy), `src/lib/suggestionLabels.ts` (threshold config), `src/lib/ideaArt.ts`, `Ideas.tsx` (tags, tooltip, captions, banner, pre-scroll, illustrations), `_ideas.scss` (card grid by breakpoints, stable card layout), `Ui.tsx` (optional `art` on Empty), API types/live/mock (`?jev=` scenarios), nav and page title.
- Art: `apps/admin/public/img/ai/*.svg` (28 files, about 50 KB), generator `scripts/make-ai-art.py`.
- Docs: design doc section "Dipbot and Dipbot Suggest", ops runbook (function, TTL, how to see Jev answering), contracts docs, admin README.

## Validation

- `npx tsc --noEmit` (functions and admin), eslint on changed admin files: clean.
- `node --import tsx --test tests/unit/ai-suggestions.test.ts tests/unit/ai-application.test.ts tests/unit/ai-infra.test.ts` and the other `ai-*` suites: 207 pass after rebasing on main.
- `npx vitest run src/lib/__tests__/aiStrings.test.ts src/lib/__tests__/suggestionLabels.test.ts src/lib/__tests__/ideas.test.ts`: 23 pass.
- `npm run check:generated`, `npm run test:docs`, `npm run test:contracts` (49 pass).
- Targeted only (owner preference): full `npm run check`, rules, Swift and Xcode builds not run. Generated Swift model added but not compiled.
- Screenshots (mock, fake Jev provider, no real model calls, no secrets used): every step and results at 1440, 1280, 1024, 768 and 390 px plus label-level, fallback, loading, none, applied, generating and off states.

## Decisions

- One decision call per visit with all six questions over one shared state (TypeSafe guidance: bundle questions that share state); this is within "at most one call per step".
- Suggestions ride the triage step's OpenAI model and Jev model config, so `aiConfig.ts` and the decision-step union stay untouched (another agent owns them).
- One tag per choice (group and budget steps have two choices each, so up to two tags there).
- Labels: >= 0.85 Perfect fit, >= 0.70 Great choice, >= 0.55 Good match, nothing below; OpenAI fallback and heuristic capped at Good match.
- Reasons are written by code from buckets and counts, never by a model. No Jev or TypeSafe logo is used, only the text credit "Powered by Jev".
- Draft thumbnails stay the real catalog cover photos (what members will see).
- Brand: owner chose "Dipbot" (after a brief "Scout" iteration). All user-facing AI copy, including option labels, step names, errors, tooltips and the editor notice, lives in `apps/admin/src/lib/aiStrings.ts` (flat keys, `AI_NAME`, `t`/`tn`/`tMaybe`), ready for a later i18n catalog; the privacy page names Dipbot and the suggestion data. Avatar: `public/img/ai/dipbot.svg` (the purple ghost mascot).
- Card columns follow the owner's breakpoints (4 at >= 1360 px, 3 at 1000 to 1359, 2 at 600 to 999, 1 below), with a container-query floor of about 170 px per card.
- Added the `aiSuggestions` TTL to `gcp/firestore.indexes.json` and a 10-instance cap on the new callable, matching the audit-fix conventions that landed on main during this session.

## Handoff

- Not deployed. Owner: deploy `getEventIdeaSuggestionsV1` with the AI functions and deploy the `aiSuggestions` TTL from `gcp/firestore.indexes.json` (see `docs/ops/ai-events.md`). With a real `JEV_API_KEY` the banner shows "Powered by Jev"; probe the questions against the live Jev API before the pilot (not done here).
- Live portal mode is wired but not verified against a deployed backend.
