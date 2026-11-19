# Work session

User: sandervonk
Date: 2026-11-19
Workstream: suggest-theme
Agent: Claude (Opus), area owner for Dipbot Suggest theme
Status: completed

## Summary

Built Dipbot "Suggest theme" for the admin New theme page end to end: a new admin-only callable `suggestThemeV1` (additive contract), a read-only tool loop over the company's aggregates, past and scheduled themes, recent events and free weeks, server validation and repair with an embedding-free no-duplicate rule, credits (2, refunded when no model theme survives), daily caps, kill switches, audit, idempotency, the emulator demo agent and the portal mock; and in the portal a header DipbotAction that fills the form in place with Another idea, Undo, a hint and the error and out-of-credits states. No live call to OpenAI or Jev was made; nothing was deployed.

## Changes

- Contract: `contracts/v1/models.schema.json` (SuggestThemeRequest, ThemeSuggestion, SuggestThemeResponse; `AiCreditCosts.themeSuggest`; `GetEventIdeaContextResponse.themeSuggestEnabled`), regenerated `gcp/functions/src/generated/models.ts` and `ui/Packages/DIPContracts/.../Models.swift`.
- Server (`gcp/functions/src/modules/ai`): `application/suggestTheme.ts`, `application/themeAgent.ts`, `domain/themeTools.ts`, `domain/themeValidate.ts`, `domain/themeCatalog.ts`, `transport/themeCallables.ts`; credits row, paths, pricing (`themeWorstCaseMicros`), settings and config (`AI_THEME_SUGGEST_*`, `AI_MODEL_THEME_SUGGEST`), `FirestoreThemeHistory`, `DemoThemeAgentModel`, `themeSuggestEnabled` on the context callable, the generic `AgentToolDefinition` port type. Admin error reasons, audit actions and summary keys, error message keys. Export in `gcp/functions/src/index.ts`.
- Portal (`apps/admin`): `components/ThemeSuggest.tsx` (provider, header action, card, tag), `lib/themeSuggest.ts` (fill rule), `lib/themeSuggestMock.ts`, ThemeForm wiring, the New theme page, live adapter and mock, `ErrorNotice` gained an optional `dipbot` prop, en and es catalogs (ai, errors, audit), `_theme-suggest.scss`.
- Tests: `gcp/tests/unit/ai-suggest-theme.test.ts` (26), `apps/admin/src/components/__tests__/ThemeSuggest.test.tsx` (10); price table updated in `ai-credits.test.ts` and `ai-application.test.ts`.
- Docs: `docs/design/stretch/dipbot-suggest-theme.md`, `docs/ops/ai-events.md` (price row and section), `docs/contracts/callables.md`, `docs/contracts/admin.md`.

## Validation

- `npx tsc --noEmit` in `gcp/functions` and `apps/admin`: clean.
- `node --import tsx --test` on `ai-suggest-theme`, `ai-ideas-application`, `ai-ideas-domain`, `ai-credits`, `ai-infra`, `ai-application`, `i18n-audit-errors`: all pass.
- `npx vitest run` on `ThemeSuggest.test.tsx`, `themeForm.i18n.test.tsx`, `kit.guard.test.ts`, `userError.test.ts`, `auditLabels.test.ts`, `credits.test.ts`: all pass.
- `npx eslint` on the touched portal files: clean. `npm run check:admin-i18n` (and `--remaining` at 0), `npm run check:backend-i18n`, `npm run check:generated`, `npm run test:docs`: pass.
- `npm run test:contracts` could not run in this worktree: the shared root `node_modules` symlink lacks `ajv-formats` (environment, not this change).
- Mock-mode screenshots at 1440, 768, 390 and 320 in en and es (idle, loading, filled, kept, undone, error, out of credits, long text) reviewed by fresh design reviewers; rounds below.

## Decisions

- Overwrite rule: fill only fields the admin has not changed by hand; changed fields are kept and listed with an explicit "Replace mine too"; Undo restores the form as it was before the first fill. A fill marks the form as edited (unsaved guard and autosave).
- Only on the New theme page (an existing theme's fields are all the admin's own).
- The hint lives in the suggestion card ("Refine with a hint"); the header button runs at once.
- Credits: 2 per run, refunded when no model theme survives; catalog-only answers are free. Company cap 40 per day; per-admin cap reuses `AI_DAILY_GENERATIONS_PER_ADMIN` (Infinity in production).
- Enablement reads `effectiveLimits` (the AI-default rule) plus `AI_THEME_SUGGEST_ENABLED` and `aiSettings.themeSuggestEnabled`.
- No duplicates: normalized title token overlap, 0.6 against themes of the last 26 weeks and scheduled ones, 0.75 against events of the last 42 days.
- Design review changes are listed in the PR description.

## Handoff

Owner actions before use: deploy `suggestThemeV1` with the AI secrets, add TTL policies on `expireAt` for `aiThemeSuggestions` (24 h) and `aiThemeUsage` (3 days), and replace `gpt-4o-mini` before January 14, 2027. No live model run was done; the first real runs should be watched in `ai.themeSuggest` logs. The DRAFTS owner's `useFormDraft` hook should treat a Dipbot fill as an edit (ThemeForm sets `edited`).
