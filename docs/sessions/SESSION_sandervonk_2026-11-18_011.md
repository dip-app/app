# Work session

User: sandervonk
Date: 2026-11-18
Workstream: audit-targets-quota
Agent: Codex
Status: completed

## Summary

Audit log shows plain target kinds instead of raw ids; disabled Regenerate gives the quota reason; the per-admin daily generation cap can be turned off with AI_DAILY_GENERATIONS_PER_ADMIN=Infinity.

## Changes

- apps/admin/src/app/audit/page.tsx: Target column shows a kind (Member, Event, Weekly theme...), none for company-wide; id moved to Details.
- apps/admin/src/components/Ideas.tsx: Regenerate tooltip gives the daily/monthly/budget reason; per-admin counter hidden when unlimited.
- gcp/functions/src/modules/ai/infrastructure/settings.ts: Infinity maps to 1,000,000 (JSON-safe); docs/ops/ai-events.md updated; production env set to Infinity (gitignored env file).

## Validation

- ai-infra unit test (33 pass), admin component tests (234 pass), admin tsc, functions tsc, eslint on touched files.

## Decisions

- Owner asked to disable the per-admin cap because users never see it; monthly and budget limits still apply and it can be lowered again via the env.

## Handoff

Deploy functions and hosting after merge.

