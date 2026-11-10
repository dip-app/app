# Work session

User: sandervonk
Date: 2026-11-10
Workstream: Weekly theme backend
Agent: Claude Code
Status: handoff

## Summary

Workstream T1 of the weekly-theme feature: additive contract change, the `challenges` Functions module (`createChallengeV1`/`updateChallengeV1`), Firestore read rules and tests, an emulator integration test wired into CI, and the idempotent `scripts/seed-weekly-theme.mjs` (dry-run by default). Nothing deployed, nothing written to production. This log uses sequence 011 so it does not collide with the `_002` logs that parallel weekly-theme agents create from the same base.

## Changes

- `contracts/v1/models.schema.json` + fixtures: optional `createdBy`/`createdAt`/`updatedAt`/`revision` on `Challenge`; new `ChallengeDraft`, `CreateChallengeRequest/Response`, `UpdateChallengeRequest/Response`. Regenerated `gcp/functions/src/generated/models.ts`, `DIPContracts/Models.swift` and the Swift fixture; `ContractTests.swift` decodes/round-trips the new fixtures.
- `gcp/functions/src/modules/challenges/**` (domain, application, Firestore adapter, transport); exported in `gcp/functions/src/index.ts`.
- `gcp/firestore.rules`: same-company verified `get` and bounded `list` (limit <= 20; organizers unbounded) for `companies/{c}/challenges/{id}`; no client writes; submissions stay denied. `gcp/firestore.indexes.json` unchanged (single-field `endDate` ranges only).
- Tests: `gcp/tests/unit/challenges.test.ts`, `gcp/tests/unit/seed-weekly-theme.test.ts`, `gcp/tests/rules/challenges-read.test.ts`, `gcp/tests/integration/challenges-callable.test.ts`; `npm run test:challenges:integration` in `package.json` and `.github/workflows/checks.yml`.
- `scripts/seed-weekly-theme.mjs`.
- Docs: `docs/contracts/callables.md` (Weekly themes section), `docs/contracts/data-ownership.md`, `CURRENT_STATE.md`, `docs/milestones/v2/FEATURE_STATUS.md`, `gcp/functions/src/modules/README.md`.

## Validation

Host Node is v26.7.0 (repo engines want >=24.12 <25): `npm ci` succeeded with an EBADENGINE warning; npm 11 skipped install scripts (allowScripts) but tsx/esbuild work. The machine was heavily loaded (load average up to ~1000 from parallel agents); the first `npm run test:rules` attempts failed on emulator timeouts ("client is offline", port 8080 not active in 60 s) and passed on retry.

- `npm run check`: pass (unit 113 pass, 0 fail, 6 pre-existing TODO placeholders; includes 23 challenge + 3 seed tests).
- `npm run test:rules`: 108/108 pass (6 new challenge rule tests).
- `npm run test:challenges:integration`: 1/1 pass (auth denial, tenant isolation, validation, replay, concurrent replay, overlap + concurrent overlapping creates, revision conflict, count ownership, window lock).
- `npm run generate` then `git diff --exit-code` on generated paths: no drift.
- `python3 scripts/check-docs.py`: pass. `npm run test:swift`: pass (exit 0; DIPContracts fixture round-trip includes the new challenge DTOs). No Xcode app build: no app code changed.
- Seed in the Firestore emulator for both live company IDs: aborts without a Fitness tag; dry-run plans `weekly-fitness-20261109` (2026-11-09T05:00:00Z .. 2026-11-16T04:59:59Z) per company; `--weeks 4` plans 8; emulator `--apply` then rerun creates 2 then 0; same-ID-different-window and mid-week overlap are BLOCKED.

## Decisions

- Responses: create `{ contractVersion, challengeId, revision, challenge, replayed }`, update `{ contractVersion, challengeId, revision, challenge }` (spec shape plus `challengeId`/`revision`, mirroring the event commands).
- Window lock: with participants/completions, `startDate` is fixed and `endDate` may change only to a non-past instant (`WINDOW_CHANGE_BLOCKED`).
- Create allows a window that already started (current week) but not one that ended.
- Receipts: `commandReceipts/challenge_{uid}_{requestId}` with `kind: "challenge"`; another kind under that key is `REQUEST_REUSED`.
- Overlap: inclusive windows, transactional single-field `endDate` range query (draft start .. draft end + 14 days); `details.conflict` names the conflicting week.
- List rule does not require a `companyId` filter, so the spec's Home query works without a composite index; `get` still checks the stored `companyId` matches the path.
- Server timestamps are whole seconds (Swift `.iso8601` decoding).

## Handoff

- Orchestrator: review/merge the PR, deploy `functions:dip:createChallengeV1`, `functions:dip:updateChallengeV1` and the rules as a separate authorized step, then run `node scripts/seed-weekly-theme.mjs --project team05-dip --company pNVpp3OusRvgfUV8hv5R --company zFKQd6KU14LqKr4a7yTb` (dry run) and add `--apply` after review. A tag named "Fitness" must exist in production `tags/`.
- T2 (iOS): Home query `companies/{c}/challenges` where `endDate >= now` order by `endDate` limit <= 20 (5 suggested), pick `startDate <= now`.
- T3 (admin): callables and error reasons per docs/contracts/callables.md "Weekly themes"; overlap details carry `conflict`.
- Pending: production deployment, production seeding, App Check on real clients, V2 submission/approval commands that update the counts.
