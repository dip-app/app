# Work session

User: sandervonk
Date: 2026-11-18
Workstream: dipbot-cached-suggestions
Agent: Codex
Status: completed

## Summary

Visiting the Dipbot page no longer spends credits when a saved answer exists. Suggestions are saved once per company and shared by all admins; the model runs (1 credit) only on the first-ever visit or an explicit Refresh. The preference chips on the last step are now a ~50 entry catalog ranked inside the same saved answer.

## Changes

- contracts/v1/models.schema.json plus generated models: getEventIdeaSuggestions request gains optional requestId and refresh (sessionId optional); response gains cacheStatus, computedAt, staleReason, creditsCharged, considerations; generateEventDrafts request gains optional considerations. Additive.
- gcp/functions/src/modules/ai: application/suggestions.ts rewritten around companies/{c}/aiCache/suggestions with a lease; domain/suggestionCache.ts (fingerprint, state), domain/considerations.ts, domain/considerationRanking.ts; request.ts and prompt.ts accept and render validated consideration ids; openAiDecisions gives room for many yes/no answers; paths.ts; suggestionCallables.ts (AI_SUGGESTION_CACHE_DAYS).
- apps/admin: Considerations component, considerations catalog (byte-identical copy of the server file), considerationsView, suggestCache helpers, Ideas.tsx (single fetch, freshness line, explicit Refresh), CreditsMeter visit cost, mock cache scenarios (?cache=fresh|stale|age|first), strings, styles.
- Tests: gcp/tests/unit/ai-suggestions.test.ts, ai-credits.test.ts, ai-considerations.test.ts; apps/admin Ideas.cache.test.tsx, considerations.test.ts.
- Docs: docs/ops/ai-events.md, docs/design/stretch/ai-event-creation.md, docs/contracts/admin.md.

## Validation

- node --test gcp/tests/unit/ai-*.test.ts and covers.test.ts: 326 pass.
- apps/admin: tsc clean, eslint clean on changed files, vitest full run 319 pass.
- python3 scripts/generate-contracts.py run; generated output committed.
- Screenshots at 1440 reviewed in the mock (fresh, stale, first run, exhausted, chips collapsed and expanded); no separate auditor agent was available, self-reviewed for calm and subtle hint.
- Not run: emulator rules/integration tests, Swift tests, full npm run check.

## Decisions

- Member-count bucket uses the largest interest count (members who picked interests), since total members is not read here.
- Heuristic-only or failed first visits are not saved, so a later visit with credits can still auto-run once.
- Weekly email unchanged (own ranking and budget key).
- Old aiSuggestions collection is no longer written; its TTL policy can stay.

## Handoff

Deploy: no new index or rules needed (aiCache is server-only under the deny-all baseline). Optional env AI_SUGGESTION_CACHE_DAYS. Existing admins see the first visit compute once per company after deploy. Keep the two considerations.ts copies identical (test enforces).
