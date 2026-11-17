# Work session

User: sandervonk
Date: 2026-11-17
Workstream: stretch-ai-events
Agent: Claude Opus 5.5 (lead) with Sonnet 5.5 subagents
Status: handoff

## Summary

First, small PR of the AI event drafts stretch item (S2, issue #186): the additive v1 contract types and the `ai.generate` permission land early so the other stretch leads can rebase onto them. The backend, portal flow and docs follow in a second PR from the same branch.

## Changes

- `contracts/v1/models.schema.json` (additive): `AiInterestTag`, `AiIdeaTheme`, `AiUsageSummary`, `GetEventIdeaContextRequest`/`Response`, `AiEventChoices`, `GenerateEventDraftsRequest`/`Response`, `GeneratedEventDraft`; regenerated `gcp/functions/src/generated/models.ts` and `ui/Packages/DIPContracts/Sources/DIPContracts/Models.swift`.
- `contracts/tests/ai.test.mjs`: accept and reject cases for every new type.
- `gcp/functions/src/modules/admin/domain/permissions.ts`: `ai.generate` (admin only); `errors.ts`: code `unavailable` and reasons `REQUEST_IN_PROGRESS`, `AI_DISABLED`, `AI_PROMPT_REJECTED`, `AI_FLAG_LIMIT`, `AI_DAILY_LIMIT`, `AI_MONTHLY_LIMIT`, `AI_BUDGET_EXHAUSTED`, `AI_OUTPUT_INVALID`, `AI_UNAVAILABLE`; `gcp/tests/unit/admin-permissions.test.ts` asserts `ai.generate` is admin only.
- `gcp/functions/package.json`, `package-lock.json`: `@anthropic-ai/sdk` 1.9.0 (used by the adapter in the next PR).

## Validation

- `npm run check:generated`: clean.
- `node --test contracts/tests/ai.test.mjs`: 7 of 7 pass.
- `node --import tsx --test gcp/tests/unit/admin-permissions.test.ts`: pass.
- `npx tsc --noEmit` in `gcp/functions`: clean.

## Decisions

- Every structured choice is an enum so only the admin's free-text note is unvalidated text.
- `GeneratedEventDraft` has no venue or exact times (the admin picks them in the event form) and its `coverImageURL` is always an approved `catalog://default/*` value, so `createEventV1` is unchanged.
- Interest counts cross the wire only as buckets (`5-9`, `10-19`, `20+`); tags under 5 members are listed without counts.
- `ai.generate` is admin only (owner default).

## Handoff

The second PR on `feature/stretch-ai-events` adds `modules/ai`, the callables, tests, the portal flow and the docs. No deploy, no secret, no real API call.
