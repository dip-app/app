# Work session

User: sandervonk
Date: 2026-11-17
Workstream: ai-cheap-models
Agent: Claude Code
Status: completed

## Summary

AI event drafts moved to cheap, small, older OpenAI models with prompts tuned for them, Jev made the default decision provider, and the AI-7 live eval was run exactly once (total spend $0.0196, cap $1).

## Changes

- `gcp/functions/src/modules/ai/infrastructure/aiConfig.ts`: defaults `gpt-4o-mini` for drafting and the decision fallback; temperature per step (0.3 drafting, 0 decisions); decision provider defaults to `jev`; output ceilings follow the model family.
- `gcp/functions/src/modules/ai/domain/pricing.ts`: prices for `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-5-nano`, `gpt-5-mini`; `isReasoningModel`, `outputCeiling`; worst case reserves a Jev call plus its OpenAI fallback per decision (7,680 micro-USD at the defaults).
- `gcp/functions/src/modules/ai/infrastructure/openaiLlm.ts`: sends `temperature` to chat models and `reasoning.effort` only to reasoning models.
- `gcp/functions/src/modules/ai/infrastructure/stepDecisions.ts`, new `heuristicDecisions.ts`: fallback chain Jev, then `gpt-4o-mini`, then deterministic keyword rules.
- `gcp/functions/src/modules/ai/infrastructure/settings.ts`: Jev-aware models with fallbacks; budgets lowered to $2 per month and $0.50 per day per company.
- `gcp/functions/src/modules/ai/transport/aiCallables.ts`: both callables bind `JEV_API_KEY`; router wired with the heuristic last resort.
- `gcp/functions/src/modules/ai/domain/prompt.ts`: short system prompt, field-by-field rules, two worked examples in the exact schema, request limits in the user turn, schema bounded by the request (count, tags, cost, capacity, daypart, duration, venue type).
- `gcp/functions/src/modules/ai/domain/drafts.ts`, `covers.ts`: loose-shape repair (tag names to ids, cover aliases, daypart and venue type forced to the choices, duration clamped to the timing).
- `gcp/functions/src/modules/ai/domain/decisions.ts`, `infrastructure/openAiDecisions.ts`, `infrastructure/jevDecisions.ts`, `application/ports.ts`: triage and unsafe questions with yes and no criteria; concise decision prompt with two examples and bounded schemas; provider `heuristic`.
- `gcp/functions/src/modules/ai/application/generate.ts`: bounded schema, model-family output ceiling, `decisionProviders` and `models` stored on the request document.
- `gcp/functions/src/modules/ai/infrastructure/demo.ts`: demo drafts fit the bounded schema.
- `gcp/tests/ai-eval/run.ts`, `README.md`: $1 hard cap, one-run lock file, keys from `--env-file` only, Jev primary with `gpt-4o-mini` comparison, calibration and agreement summaries, production retry.
- Tests: `gcp/tests/unit/ai-domain.test.ts`, `ai-application.test.ts`, `ai-infra.test.ts`, `helpers/aiFakes.ts`.
- Docs: `docs/design/stretch/ai-event-creation.md` (model choice, costs, Evaluation section), `docs/ops/ai-events.md`, `docs/milestones/v2/STRETCH_GOALS.md`.

## Validation

- `node --import tsx --test gcp/tests/unit/ai-*.test.ts` (from `gcp/functions`): 191 pass, 0 fail.
- `npm test` in `gcp/functions` (all unit tests): 848 pass, 0 fail.
- `npx tsc --noEmit -p gcp/functions`: clean.
- `npm run test:docs`: links checked.
- `npm run test:ai:integration`: not run; the Firestore emulator port was taken by another session.
- Offline eval (`node --import tsx gcp/tests/ai-eval/run.ts`): harness works with the demo providers.
- Live eval, once: 20 cases, `gpt-4o-mini` drafting, Jev and `gpt-4o-mini` decisions. 16 of 16 generations valid on the first attempt, 0 refusals, 0 automatic check failures; triage 100% for both providers; total $0.0196. Aggregates in the design doc.

## Decisions

- `gpt-4o-mini` over `gpt-4.1-mini` (2.7 times the price) and `gpt-5-nano` (reasoning tokens, shutdown December 11, 2026); `gpt-4.1-nano` is already shut down. `gpt-4o-mini` shuts down January 14, 2027 (owner question 9 in the design doc).
- Jev is the default decision provider when its key is real (owner change during the session); `openai-mini` forces OpenAI per step.
- When Jev and OpenAI both fail, keyword rules answer instead of failing closed; moderation still fails closed.
- Unknown tags and cover words are repaired, not rejected; the strict provider schema already blocks them for real calls.
- The OpenAI key was loaded only through `scripts/secrets/pull.sh --only backend` and `node --env-file`; `.secrets-cache/` was deleted after the run. No key appears in any file, log or message.

## Handoff

- Before January 14, 2027 choose and set a replacement for `gpt-4o-mini` (`AI_MODEL_*`).
- Suggested prompt changes from the eval (cover mapping line, realistic capacity, exact interest buckets in rationales) are listed in the design doc and not applied; applying them needs an owner-approved re-run (`--allow-rerun`).
- Run `npm run test:ai:integration` when the emulator port is free.
- Nothing deployed; secrets unchanged.
