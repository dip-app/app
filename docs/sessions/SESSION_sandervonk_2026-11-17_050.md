# Work session

User: sandervonk
Date: 2026-11-17
Workstream: stretch-ai-events
Agent: Claude Opus 5.5 (lead) with Sonnet 5.5 subagents
Status: handoff

## Summary

AI event ideas and prompt-to-event drafts (stretch S2, #186), second PR after the contract slice (#233): the `modules/ai` backend with two admin-only callables, OpenAI generation (Responses API, zod structured output) behind an LLM port, a provider-neutral decision port (TypeSafe AI Jev with an OpenAI mini fallback) for note triage and draft checks, free OpenAI moderation, budget and rate caps (monthly and daily per company), audit entries, the admin portal card flow at `/ideas/` with "Open in editor", an offline eval harness, docs and a runbook. The first version used Anthropic Claude; the owner asked to switch to OpenAI and to wire Jev. Off by default, not deployed, no real API call made.

## Changes

- `gcp/functions/src/modules/ai/**`: domain (vocabulary, request parsing and note sanitizing, interest buckets with small-cell suppression, prompt and output schemas, draft validation, cover mapping, pricing, quota, decision questions and thresholds), application (`getEventIdeaContext`, `generateEventDrafts`: reserve, run, settle), infrastructure (`aiConfig` per-step model matrix, `OpenAiLlm` with `zodTextFormat`, `store: false` and moderation, `JevDecisions`, `OpenAiDecisions`, `StepDecisions` router, `ScriptedLlm` and demo fakes, Firestore sources reading the tag-counts store, settings from environment), transport (callables, `OPENAI_API_KEY` and `JEV_API_KEY` secrets by name only); exported from `gcp/functions/src/index.ts`.
- Tests: `gcp/tests/unit/ai-domain.test.ts`, `ai-infra.test.ts`, `ai-application.test.ts` (auth denial, tenant isolation, kill switches, idempotency, caps, budget, prompt injection, output safety, audit and log content), `gcp/tests/integration/ai-usage.test.ts` (Firestore emulator: parallel calls cannot pass a cap), `gcp/tests/rules/ai.test.ts` (clients denied on every AI document); `npm run test:ai:integration` and its CI line.
- `gcp/tests/ai-eval/`: 20 cases, runner ported to OpenAI and Jev (offline by default with `DemoLlm` and `DemoDecisions`; live only with `--live`, `OPENAI_API_KEY` and `--yes`; `--jev` adds Jev), rubric README.
- `apps/admin`: Event ideas page (`src/components/Ideas.tsx`, `src/lib/ideas.ts`, `src/lib/ideasMock.ts`, `src/styles/_ideas.scss`), API in mock and live modes, `ai.generate` capability and nav item, EventForm pre-fill from an AI draft, tests, README section.
- Docs: `docs/contracts/admin.md` (permission row, AI section, error reasons including the daily budget), `docs/contracts/callables.md`, design doc (OpenAI lineup, per-step model matrix, Jev slot, safety, cost, Decisions), `docs/milestones/v2/STRETCH_GOALS.md`, `docs/ops/ai-events.md` (owner actions for both secrets, env table, deploy notes, pilot, kill switches), the ops index, and the privacy page (Service providers: OpenAI and TypeSafe AI).

## Validation

- Unit, integration and rules tests: see PR (results filled in by the lead).
- `npm run check:generated`, `npm run test:contracts`, `npm run test:docs`, `tsc --noEmit` in `gcp/functions`: see PR.
- Portal: lint, typecheck, `ideas.test.ts`, `api.test.ts` and build: see PR.
- Eval runner: `node --import tsx gcp/tests/ai-eval/run.ts` offline run completes (20 cases, 19 generated, demo triage accuracy 85% as expected because the demo only flags the literal injection phrase). Live maximum for the default models with `--jev` is about $31.87; typical about $4.
- Not run: any live OpenAI or TypeSafe AI call (owner action, `gcp/tests/ai-eval`), full test suites (targeted only by standing instruction), the functions emulator end to end through the callables.

## Decisions

Recorded in the design doc's Decisions section: admins only; $30 per company per month and $6 per company per day, 30 generations per month, 10 per admin per day, 3 declined notes per day; catalog covers only (AI-9 deferred); OpenAI `gpt-6-astra` drafting at low effort, `gpt-6-luna` for decision steps, free `omni-moderation-latest`, all per-step and configurable; Jev behind a `DecisionPort` per step, default `openai-mini` until the owner has a key (provider switch made at the owner's request); zod validation at every boundary; `store: false` on OpenAI calls; weekly theme in the prompt; no web search; dayparts instead of exact times. The worst-case reservation per generation is about $1.32 and the typical cost about $0.19.

## Handoff

Owner: create the `OPENAI_API_KEY` secret and an OpenAI project spend limit, create `JEV_API_KEY` (enter `none` until a Jev key exists), confirm that "jeb" means TypeSafe AI Jev, confirm the budget, read both providers' data retention terms (UNVERIFIED), run the live eval, deploy the privacy page, then pilot (`docs/ops/ai-events.md`). Both callables bind `OPENAI_API_KEY` and the generator also binds `JEV_API_KEY`, so both secrets must exist before deploying them. Open issues: #193 (AI-7 live run), #195 (AI-9, deferred), #196 (AI-10 pilot).
