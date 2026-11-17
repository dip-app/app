# Work session

User: sandervonk
Date: 2026-11-17
Workstream: backend-quality-audit
Agent: Claude Sonnet (audit fixer)
Status: completed

## Summary

Fixed the verified audit findings in the AI event-drafts module (best-effort context reads, per-admin attempt cap, complete spend metering, run deadline, settle retry, instance caps and a platform monthly ceiling, worst-case attempts, demo provider refused outside the emulator) and the tag-interest-counts module (empty-catalog and mass-deletion guards, zero clamp, per-company isolation with bounded concurrency, hot-counter function limits).

## Changes

- gcp/functions/src/modules/ai/**: application/generate.ts (meter hoisted so every path settles real spend, estimate for failed calls with unknown usage, run deadline AbortSignal, bounded settle retry, platform reservation, attempt counter, best-effort context reads), application/context.ts, application/ports.ts (signal, new settings, log level, deadline and sleep hooks), domain/quota.ts (attempt cap, platform state, 7 minute TTL, 240 s deadline), domain/pricing.ts (attempts times checks, per-call worst case), domain/paths.ts (aiUsagePlatform), infrastructure/openaiLlm.ts (no SDK retries, 50 s timeout, signal), jevDecisions.ts, openAiDecisions.ts, settings.ts (new env values, demo refused outside the emulator), transport/aiCallables.ts (maxInstances 5, explicit timeout and memory, log levels).
- gcp/functions/src/modules/tags/**: domain/reconcile.ts (refuse deletions with an empty catalog or over half of the stat docs unless allowMassDelete, clamp to zero), application/reconcileTagStats.ts (empty catalog aborts the company, warnings, bounded concurrency 4), infrastructure/firestoreTagReconcile.ts (clamp), transport/reconcileFunction.ts (rethrow only if all companies failed), transport/tagFunctions.ts (maxInstances 10, timeout 60 s, 256 MiB).
- gcp/scripts/backfill-tag-stats.ts: --allow-mass-delete flag, warnings printed.
- Tests: gcp/tests/unit/ai-application.test.ts, ai-domain.test.ts, ai-infra.test.ts, tags-reconcile.test.ts, helpers/aiFakes.ts.
- Docs: docs/design/stretch/ai-event-creation.md, docs/design/stretch/tag-interest-counts.md, docs/ops/ai-events.md.

## Validation

- cd gcp/functions && node --import tsx --test ../tests/unit/tags.test.ts ../tests/unit/tags-reconcile.test.ts ../tests/unit/ai-application.test.ts ../tests/unit/ai-domain.test.ts ../tests/unit/ai-infra.test.ts: 233 pass, 0 fail after the rebase.
- npm run build (Node 24.12): passes. Rebased onto main after #255 (cheap models, Jev default); 233 targeted tests pass.
- npm run test:ai:integration: not run, the Firestore emulator port 8080 was already taken by another process. Tags integration not run for the same reason.

## Decisions

- The per-admin attempt cap reuses AI_DAILY_LIMIT because the reason enum lives in the admin module (outside this packet).
- The mass-deletion guard is lifted by a separate allowMassDelete option, not by force, because the backfill script passes force on every apply.
- Calls that fail with status null or 5xx are charged the per-call worst case; 4xx are not.
- The platform ceiling is a top-level aiUsagePlatform/{yyyymm} document with expiring reservations, written in the same transaction as the company reserve.

## Handoff

- Deploy: the theme read needs a collection composite index on companies/{c}/challenges (type ASC, endDate ASC), added by the lead in a separate PR; until then the read fails softly and logs ai.context_unavailable.
- New optional env values: AI_DAILY_ATTEMPTS_PER_ADMIN (20), AI_PLATFORM_MONTHLY_BUDGET_CENTS (20000).
- Not done: sharding of the tag counters; no unit test for the scheduler rethrow rule (the transport handler is not exported); emulator integration tests not run.
