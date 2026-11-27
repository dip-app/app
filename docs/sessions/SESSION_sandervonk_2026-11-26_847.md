# Work session

User: sandervonk
Date: 2026-11-26
Workstream: dipbot-quality-1
Agent: Claude (Opus), Claude Code
Status: completed

## Summary

Owner of Dipbot prompting and model interactions for the November 2026 polish. Built an offline-first evaluation harness for every model-backed Dipbot step (`gcp/tests/ai-eval/dipbot`, `npm run eval:dipbot`) with synthetic scenarios, hard checks, a blinded Opus judge and a cumulative US$5 spend cap. Ran baselines on the existing prompts, then iterated prompts and pipelines for daily ideas, Suggest theme and event drafts, and compared replacement models for gpt-4o-mini. Results, before/after scores, latency, cost and the model recommendation are in `docs/design/polish-2026-11/dipbot.md`. Production model choice is unchanged (gpt-4o-mini).

## Changes

- `gcp/tests/ai-eval/dipbot/` (new): `scenarios.ts`, `draft-cases.json`, `checks.ts`, `run.ts`, `pack.ts`, `tally.ts`, `README.md`, git-ignored `results/`. `package.json`: `eval:dipbot`. `gcp/tests/ai-eval/README.md`: pointer.
- Daily ideas (`ai/application/ideaAgent.ts`, `ideas.ts`, `domain/ideaTools.ts`, `ideaTypes.ts`, `ideaValidate.ts`): prefetched core tool results, at most 2 extra calls, rewritten instructions, do-not-repeat list and date window in the user turn, admin language (account locale), catalog tool without titles, `interestClaimsHold`, `fitWhy`, scheduling (5 days lead, holidays, no stacking), lunch alignment, output ceiling per model, `IDEA_ALGORITHM_VERSION` 2, locale in the fingerprint for non-English only.
- Suggest theme (`themeAgent.ts`, `suggestTheme.ts`, `domain/themeTools.ts`, `themeValidate.ts`): same prefetch and call budget, rewritten instructions, do-not-repeat list, catalog without titles, schema descriptions, cold-start claim filter, interest-claim filter, output ceiling for reasoning models.
- Drafts (`domain/prompt.ts`, `application/generate.ts`): output language from the admin's account locale, prompt standards (no "Join us", honor "already did", organization names, em dashes), company reads in parallel with note screening. `domain/drafts.ts` `cleanText`: em dash to comma.
- Weekly email reasons (`suggestions/domain/reasons.ts`): theme noun in "No outdoor events yet".
- Portal copy (`apps/admin/src/lib/i18n/catalog/{en,es}/ai.ts`): drafts loading line "usually takes 10 to 20 seconds".
- Docs: `docs/design/polish-2026-11/dipbot.md` (new), `docs/design/stretch/dipbot-daily-ideas.md`, `dipbot-suggest-theme.md`.
- Tests updated and added: `ai-ideas-application`, `ai-ideas-domain`, `ai-suggest-theme`, `ai-domain`, `suggestions-domain`.

## Validation

- `node --import tsx --test` on `gcp/tests/unit/ai-*.test.ts suggestions-*.test.ts covers*.test.ts places.test.ts`: 658 pass, 0 fail. `email-admin-suggestions.test.ts` and `suggestions-application.test.ts` pass.
- `npx tsc --noEmit -p gcp/functions`: clean.
- `npm run check:admin-i18n`, `npm run check:backend-i18n`: OK. `python3 scripts/check-docs.py`: OK.
- `npm run eval:dipbot` offline: runs all six features with demo models.
- Live evaluation: 17 runs, US$0.7409 total on the cumulative ledger (cap US$5); per-run spend is in the design doc. Keys only from the git-ignored env file via `--env-file`; synthetic data only; `.secrets-cache` removed afterward.
- Judging: three blinded rounds, seven Opus judge agents, scores in the git-ignored results folder; summaries in the design doc.
- Not run: full unit suite, emulator rules tests, Swift tests (targeted tests only, per owner rule). No UI layout changed, so no screenshot review round.

## Decisions

- Prefetch the core tool results instead of letting the model fetch them turn by turn: same data and grounding, one round trip; latency and cost dropped on every model.
- Catalog tools return pitches without titles: titles were copied verbatim (47 of 50 baseline ideas).
- Language comes from the admin's stored account locale (already on the verified membership), so no contract change was needed for drafts or ideas.
- Server-side claim validation for interest buckets, "top" and "growing" lines, because number grounding let wrong buckets through.
- Fit labels are proposed, not changed: the strings are shared with the email templates and their tests.
- Model recommendation for the owner: gpt-6-luna for all OpenAI steps (best or tied best quality, fastest, cheapest). Not switched.

## Handoff

- Owner: decide the gpt-4o-mini replacement before 2027-01-14 (recommendation and numbers in `docs/design/polish-2026-11/dipbot.md`); switching is `AI_MODEL_*` environment values.
- Content/email owners: Spanish catalog ideas and themes and Spanish weekly email reasons are still English; fit label wording proposal in the doc.
- Admin structure/interaction owners: why-line basis badge and two-step theme loading narration proposals in the doc.
- Re-run `npm run eval:dipbot -- --live --yes` after any prompt change; the ledger in `results/` caps spend per checkout.
