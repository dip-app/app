# Work session

User: sandervonk
Date: 2026-11-18
Workstream: functions-dispatcher
Agent: Claude (Opus 5.5)
Status: handoff

## Summary

Experiment requested by the owner: one warm dispatcher callable, `dipApiV1`, that routes `{ command, payload }` to the same handlers the standalone admin-portal callables use, so `minInstances: 1` is paid once instead of per function. Built the realistic version (registry, dispatcher, portal client with flag and fallback, tests, design doc) for review; the coordinator decides whether to merge. Nothing deployed.

## Changes

- `gcp/functions/src/modules/dispatcher/` (new): `registry.ts` (one row per command: handler, minRole, rate limit, request schema, mutating), `dispatch.ts` (signed-in check, envelope, 256 KiB request / 8 MiB response caps, `UNKNOWN_COMMAND`, PII-free log line), `dipApiV1.ts` (512 MiB, 1 vCPU, 60 s, minInstances 1, maxInstances 10, App Check).
- Transport refactors with no behavior change: admin (`adminHandlers(deps)` / `adminCommands`), organizer (`organizerCommands`), challenges (`challengeCommands`), submissions (`submissionReviewCommands`), places (`placeCommands`). Each standalone `onCall` now passes the same handler object the registry references.
- `gcp/functions/src/index.ts`: exports `dipApiV1` (integrator choke point; additive).
- `apps/admin/src/lib/dispatcher.ts` (new) plus `adminLive.ts` and `firebaseAdapter.ts`: the 29 commands go through `dipApiV1` unless `NEXT_PUBLIC_ADMIN_DISPATCHER=off`; dispatcher-level failures (UNKNOWN_COMMAND, missing function, 503, status-0) fall back to the standalone callable with the same payload and requestId.
- Tests: `gcp/tests/unit/functions-dispatcher.test.ts`, `apps/admin/src/lib/__tests__/dispatcher.test.ts`.
- Docs: `docs/design/functions-dispatcher.md` (design, measurements, rollback, how to add a command, recommendation), a section in `docs/contracts/callables.md`, `CURRENT_STATE.md`, `apps/admin/README.md`, `apps/admin/.env.example`.

## Validation

- `tsc --noEmit` (gcp/functions) clean; `tsc --noEmit` and `eslint src` (apps/admin) clean.
- `node --import tsx --test` on functions-dispatcher (37 pass) and the unit tests of every touched module (admin-*, organizer-events, challenges, challenge-submissions, places, ai-application): 420 pass, 0 fail.
- `vitest run` on dispatcher, api, liveConfig, bugReports, insights, tagStats, themes tests: 83 pass; the emulator adapter test skipped (needs LIVE_EMULATORS).
- `python3 scripts/check-docs.py` passes.
- Not run: `npm run test:admin:live` (Firestore emulator port 8080 was held by another process), rules tests (no rules change), full suites (targeted only per owner preference). Nothing deployed.

## Decisions

- Migrated only commands the portal calls, with no secrets, at most 60 s and 512 MiB (29). Kept AI/Dipbot, covers, suggestions, the 300 s admin jobs, `resolveMembershipV1`, all iOS callables, `upsertTeamV1` (no caller), HTTP functions, triggers and schedules standalone.
- No per-command schema validation in the dispatcher: the handler's own parser runs, so error reasons stay identical. The registry names the contract schema and a test checks it exists.
- Signed-out callers are refused before any handler runs (same code and reason; message can differ from the submission callables).
- No contract (`contracts/v1`) change: the envelope is transport-only and documented in callables.md; add a schema if this is merged and iOS ever adopts it.
- Found that none of the 29 commands is called by iOS (searched `ui/`), so a phase 2 that deletes their standalone functions is possible (58 -> 30 HTTP services) but removes the automatic fallback; left as a separate decision.

## Handoff

Draft PR for the coordinator's review. Before merging: decide whether ~$10/month for warm admin calls is wanted; optionally run `npm run test:admin:live` when emulator ports are free (exercises `dipApiV1` through the adapter). After a deploy: add a log-based metric on `dipApi.dispatch` `command`, watch for fallbacks, and only then consider phase 2. Cost and traffic-share numbers in the design doc are list-price arithmetic and estimates, not billing data.
