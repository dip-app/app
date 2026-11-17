# Work session

User: sandervonk
Date: 2026-11-17
Workstream: overview-insights-fix
Agent: Claude (Opus)
Status: handoff

## Summary

Production admin Overview failed: `getCompanyInsightsV1` threw UNEXPECTED. Root cause (confirmed with read-only REST runQuery against team05-dip): two queries had no composite index. The newest-RSVP sample (collection group `rsvps`, `companyId ==`, `createdAt >=`, order by `createdAt` desc) and the latest completed events (`events`, `status ==`, order by `startTime` desc) both returned FAILED_PRECONDITION; only ascending variants were declared and deployed. The Firestore emulator does not enforce composite indexes and the unit fake does not either, so neither could reproduce it. Fixed the indexes, made each insights section best effort, and made the real error visible in logs.

## Changes

- `gcp/firestore.indexes.json`: added `rsvps` COLLECTION_GROUP (`companyId` ASC, `createdAt` DESC) and `events` COLLECTION (`status` ASC, `startTime` DESC). Additive.
- `contracts/v1/models.schema.json` (+ generated TS/Swift): optional `unavailable` section list on `GetCompanyInsightsResponse` (additive v1).
- `gcp/functions/src/modules/admin/application/insights.ts`: per-section best effort; failures logged with section, code, bounded message and index link; partial summaries are not cached; organizers never see the `points` flag.
- `gcp/functions/src/modules/admin/domain/errors.ts`: `errorDiagnostics()`; `transport/adminCallables.ts` logs it for every UNEXPECTED failure (no payload).
- `apps/admin`: wire mapping of `unavailable`, inline "This section is unavailable" states per panel/tile, a page notice, `?insights=partial` mock scenario.
- Tests: `gcp/tests/unit/admin-insights.test.ts` (partial failure, logging, index coverage of every Overview query shape against `firestore.indexes.json`), `contracts/tests/admin.test.mjs`, `apps/admin` insights and Overview render tests.
- `docs/contracts/admin.md`: best-effort behaviour and the full index list.

## Validation

- Read-only prod probe (REST runQuery/runAggregationQuery, owner ADC): all 16 query shapes; exactly the two above failed with FAILED_PRECONDITION.
- `gcloud firestore indexes composite list --project team05-dip`: live indexes matched the old file (all READY); the two needed ones absent.
- `node --import tsx --test ../tests/unit/admin-*.test.ts` (144 pass); `node --test contracts/tests/admin.test.mjs`; `npm run check:generated`; `npm run build`; `npm run test:docs`.
- apps/admin: vitest insights, OverviewUnavailable, a11y (24 pass); `tsc --noEmit`; eslint on touched files.
- Not run: full `npm run check`, `test:rules`, `test:swift` (generated Swift change is an optional field with a defaulted init parameter).

## Decisions

- Unavailable sections keep their required shape with zeros (no breaking change) and are listed in `unavailable`; old clients show zeros.
- Partial summaries are not cached so a fixed index takes effect on the next load.
- Logging Firestore messages is acceptable: they describe the query and index, never document data; capped at 500 chars.

## Handoff

Nothing deployed. Owner: deploy indexes first and wait until both are READY, then functions, then hosting (see PR description for commands). Until the functions deploy, the Overview keeps failing as a whole; after indexes are READY the old function also works.
