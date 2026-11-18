# Work session

User: sandervonk
Date: 2026-11-17
Workstream: dipbot-credits
Agent: Claude
Status: completed

## Summary

Admins now see Dipbot credits instead of any AI spending. Fixed per-tool price table, monthly allowance per company, credits ledger with charge, refund and idempotency, `AI_CREDITS_EXHAUSTED`, additive contract change, and a portal credits meter with per-action prices and low/out states. The internal dollar budget guard is unchanged and never shown. Also done in this branch at the coordinator's request: Dipbot Suggest flow fixes (one "Let Dipbot pick for me" action per step that visibly selects, honest empty states), a DipbotMark action icon, no provider branding in the UI, a declutter pass of the whole flow, one-line stepper labels, and a hidden sidebar scrollbar.

## Changes

- `gcp/functions/src/modules/ai/domain/credits.ts` (price table, allowance, period in company time zone, charge/refund), `application/credits.ts` (ledger load), `application/generate.ts`, `suggestions.ts`, `context.ts`, `domain/paths.ts`, `domain/quota.ts` (`budgetExhausted` removed), `modules/suggestions/application/budget.ts`, `buildDigest.ts`, `ports.ts` (weekly email credits), `modules/admin/domain/errors.ts` and `transport/adminCallables.ts` (error `details`, `AI_CREDITS_EXHAUSTED`).
- `contracts/v1/models.schema.json` + generated TS and Swift: `AiCredits`, `AiCreditCosts`, `credits` on the three AI responses; `AiUsageSummary.budgetExhausted` removed. Audit entry records credits instead of `costUsd`.
- Portal: `components/CreditsMeter.tsx`, `DipbotMark.tsx`, `Ideas.tsx`, `SuggestionsEmail.tsx`, `Shell.tsx` (nav icon), `lib/credits.ts`, `aiStrings.ts`, `ideas.ts`, `suggestionLabels.ts`, mock and live wire, `styles/_ideas.scss`, `_nav.scss`.
- Docs: `docs/ops/ai-events.md` (credits section, rationale and cost mapping, internal), `docs/design/stretch/ai-event-creation.md`, `docs/contracts/admin.md`, `apps/admin/README.md`.
- Tests: `gcp/tests/unit/ai-credits.test.ts`, additions to `ai-application.test.ts`, `ai-domain.test.ts`, `contracts/tests/ai.test.mjs`, portal `credits.test.ts`, `Ideas.credits.test.tsx`, updates to `ideas`, `aiStrings`, `suggestionLabels` tests.

## Validation

- `npm run check` passes (generated check, session tests, docs, contract tests, build, 1126 unit tests).
- `apps/admin`: `npx tsc --noEmit`, `npx eslint src`, `npx vitest run` (247 tests) pass.
- `swift test --package-path ui/Packages/DIPContracts` builds (regenerated models).
- Not run: `npm run test:ai:integration` and `npm run test:rules` (the Firestore emulator port was taken by another session). The ledger transactions are covered with the fake store only, not emulator evidence.
- Design crit rounds with the shared auditor on the credits UI and the decluttered flow.

## Decisions

- Credits ledger is a separate document `companies/{c}/aiCredits/{yyyymm}` (month in the company time zone from `emailSettings`), not the UTC cost document `aiUsage/{yyyymm}`, because the periods differ. Internal cost stays in `aiUsage` and in logs.
- Charge at the start of generation, refund in settle when no drafts are produced; charge key per request attempt, so replay and retries are free. A crashed run is refunded when the same request is retried.
- Out of credits: generate fails with `AI_CREDITS_EXHAUSTED` (details `creditsRemaining`, `resetsAt`; the remaining value is the real balance, which can be 1 to 9 when a run no longer fits). Dipbot Suggest and the weekly email degrade to the free heuristic instead of failing.
- Removed `budgetExhausted` from the wire so no cost-derived flag reaches clients.
- Interests step: no interest picked means any interest can fit; the "Surprise me" answer was removed.

## Handoff

- Deploy: callables `getEventIdeaContextV1`, `generateEventDraftsV1`, `getEventIdeaSuggestionsV1` and the weekly scheduler need redeploying; portal hosting rebuild. No rules or index changes (new collection `aiCredits` is server-only and falls under deny-all). Optional TTL: none needed (about 12 documents per company a year).
- To change a company's allowance set `monthlyCredits` in `companies/{c}/aiSettings/current`.
- Run the AI emulator integration tests and rules tests once on a machine with free emulator ports.
