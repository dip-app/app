# Work session

User: sandervonk
Date: 2026-11-18
Workstream: dipbot-daily-ideas
Agent: claude-opus
Status: completed

## Summary

Dipbot daily ideas: a tool-using model (gpt-4o-mini via the Responses API, behind a new AgentModelPort with a fake) proposes 4 to 6 event ideas from scratch using six read-only, tenant-scoped aggregate tools; the server validates and repairs them (catalog tags, number grounding, schedule in the next 4 weeks, dedupe and diversity), ranks them with the decision chain (Jev, OpenAI mini, prior) into fit labels, picks covers from the static library and stores them per company. New callable getDipbotIdeasV1 (load, auto, refresh) and a compact "Ideas for you" section at the top of the portal Dipbot page.

## Changes

- Contract: GetDipbotIdeasRequest, DipbotIdea, GetDipbotIdeasResponse, AiCreditCosts.ideas (additive); regenerated TS and Swift.
- Server: gcp/functions/src/modules/ai/domain/{ideaTypes,ideaTools,ideaValidate,ideaCache}.ts, application/{ideaAgent,ideas}.ts, infrastructure/openAiAgent.ts, transport/ideaCallables.ts; additive edits to ports, credits (ideas: 3), paths, pricing, aiConfig, settings, fakes, demo, errors (AI_IDEAS_REFRESH_LIMIT); gatherSignals exported from suggestions buildDigest; exports in modules/ai/index.ts and src/index.ts.
- Rebased onto main after #304 to #312; audit actions ai.ideasGenerated and ai.ideasFailed added to auditActions.ts and auditLabels.ts.
- Portal (built on the admin kit and DipbotAction): apps/admin/src/components/IdeasForYou.tsx, lib/{dipbotIdeas,ideasForYouMock}.ts, Ideas.tsx (render section, credits fold, customize prefill), adminTypes/adminApi/adminLive/adminMock/ideasMock, aiStrings, styles/_ideas.scss.
- Docs: docs/design/stretch/dipbot-daily-ideas.md (new), docs/ops/ai-events.md (credits row, Dipbot daily ideas section), docs/contracts/admin.md.
- Tests: gcp/tests/unit/ai-ideas-domain.test.ts, ai-ideas-application.test.ts, ai-credits.test.ts price table, gcp/tests/rules/ai.test.ts (aiCache/ideas denied), apps/admin IdeasForYou.test.tsx.

## Validation

- `npx tsc --noEmit -p gcp/functions`: clean.
- `node --import tsx --test` on ai-ideas-application, ai-ideas-domain, ai-suggestions, ai-credits, ai-infra, suggestions-domain, suggestions-application, email-admin-suggestions: 220 pass, 0 fail.
- `npm run check:generated`, `npm run test:docs`, `npm run test:contracts` (59 pass): clean.
- Portal (apps/admin): `npx tsc --noEmit` and `npx eslint src` clean; vitest components and lib 549 pass, 2 skipped; targeted rerun after the last edits (auditLabels, IdeasForYou, Ideas cache and credits, aiStrings) 50 pass.
- Design crit: two auditor rounds on screenshots at 1440x900, 1024x768 and 390x844 (default, computing, empty, exhausted, error, collapsed); round 2 PASS with minor notes. Section 208px expanded, 36px collapsed on desktop.
- Not run: rules emulator (new aiCache/ideas assertion), full suites (targeted tests only by owner preference). No real OpenAI, Jev or Pixabay calls.

## Decisions

- Lazy daily refresh, no scheduler: load never calls a model; the portal starts one `auto` call when due; unchanged fingerprint extends freshness for free; at most one auto run per company per local day.
- Tools read a snapshot loaded for the caller's verified company before the model runs; arguments cannot select a company (unknown keys stripped).
- 3 credits per run, reserved in the lease transaction and refunded when no model idea survives; a late replay of an already paid requestId returns the stored ideas without running.
- Covers: static library lexical pick (no live Pixabay search exists on main), no extra model call.
- A visit with stored ideas reads only the cache and settings documents (dataLevel stored with the ideas).

## Handoff

- Deploy (owner): deploy getDipbotIdeasV1 (binds OPENAI_API_KEY and JEV_API_KEY), rebuild admin hosting. Switches: AI_IDEAS_ENABLED, AI_IDEAS_MAX_AGE_HOURS, AI_IDEAS_MANUAL_PER_DAY, AI_MODEL_IDEAS, aiSettings.ideasEnabled. Move AI_MODEL_IDEAS off gpt-4o-mini before January 14, 2027.
- A live eval of the tool loop has not been run (no real calls in this session).
- Minor design notes left from audit round 2: duplicate out-of-credits text next to the wizard notice, Refresh icon hidden at 390px, chip order on phone.
