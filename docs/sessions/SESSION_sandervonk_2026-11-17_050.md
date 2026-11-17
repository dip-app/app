# Work session

User: sandervonk
Date: 2026-11-17
Workstream: stretch-ai-events
Agent: Claude Opus 5.5 (lead) with Sonnet 5.5 subagents
Status: handoff

## Summary

AI event ideas and prompt-to-event drafts (stretch S2, #186), second PR after the contract slice (#233): the `modules/ai` backend with two admin-only callables, an Anthropic adapter behind an LLM port with offline fakes, budget and rate caps, screening of the admin's note, audit entries, the admin portal card flow at `/ideas/` with "Open in editor", an offline eval harness, docs and a runbook. Off by default, not deployed, no real API call made.

## Changes

- `gcp/functions/src/modules/ai/**`: domain (vocabulary, request parsing and note sanitizing, interest buckets with small-cell suppression, prompt and output schemas, draft validation, cover mapping, pricing, quota), application (`getEventIdeaContext`, `generateEventDrafts`: reserve, run, settle), infrastructure (`AnthropicLlm` with structured output and server-side refusal fallback, `ScriptedLlm` and `DemoLlm` fakes, Firestore sources reading the tag-counts store, settings from environment), transport (callables, `ANTHROPIC_API_KEY` secret by name only); exported from `gcp/functions/src/index.ts`.
- Tests: `gcp/tests/unit/ai-domain.test.ts`, `ai-infra.test.ts`, `ai-application.test.ts` (auth denial, tenant isolation, kill switches, idempotency, caps, budget, prompt injection, output safety, audit and log content), `gcp/tests/integration/ai-usage.test.ts` (Firestore emulator: parallel calls cannot pass a cap), `gcp/tests/rules/ai.test.ts` (clients denied on every AI document); `npm run test:ai:integration` and its CI line.
- `gcp/tests/ai-eval/`: 20 cases, runner (offline by default; live only with `--live`, a key and `--yes`), rubric README.
- `apps/admin`: Event ideas page (`src/components/Ideas.tsx`, `src/lib/ideas.ts`, `src/lib/ideasMock.ts`, `src/styles/_ideas.scss`), API in mock and live modes, `ai.generate` capability and nav item, EventForm pre-fill from an AI draft, tests, README section.
- Docs: `docs/contracts/admin.md` (permission row, AI section, error reasons), `docs/contracts/callables.md`, design doc status and Decisions, `docs/milestones/v2/STRETCH_GOALS.md`, `docs/ops/ai-events.md` (owner actions, deploy notes, pilot, kill switches) and the ops index.

## Validation

- `node --import tsx --test gcp/tests/unit/ai-*.test.ts gcp/tests/unit/admin-permissions.test.ts gcp/tests/unit/tags.test.ts`: 176 pass.
- `npm run test:ai:integration` (Firestore emulator): 11 pass. Rules `gcp/tests/rules/ai.test.ts`: 4 pass.
- `npm run check:generated`, `npm run test:contracts` (49 pass), `npm run test:docs`, `tsc --noEmit` in `gcp/functions`: clean.
- Portal: lint, typecheck, `ideas.test.ts` and `api.test.ts` pass, `npm run build` clean. Screenshots at 1440 and 390 px of every step, results, editor pre-fill, off and no-data states; two design-crit rounds with a design auditor.
- Not run: the live Anthropic API (owner action, `gcp/tests/ai-eval`), full test suites (targeted only by standing instruction), the functions emulator end to end through the callables.

## Decisions

Recorded in the design doc's Decisions section: admins only; $5 per company per month, 30 per month, 10 per admin per day, 3 declined notes per day; catalog covers only (AI-9 deferred); Sonnet 5.5 drafts and Haiku 5.5 screening at low effort, configurable; weekly theme in the prompt; no web search; dayparts instead of exact times.

## Handoff

Owner: create the `ANTHROPIC_API_KEY` secret, confirm the budget, run the live eval, ship the privacy line, then pilot (`docs/ops/ai-events.md`). Open issues: #193 (AI-7 live run), #195 (AI-9, deferred), #196 (AI-10 pilot).
