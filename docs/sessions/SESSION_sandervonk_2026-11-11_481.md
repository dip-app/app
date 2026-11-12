# Work session

User: sandervonk
Date: 2026-11-11
Workstream: admin-insights-overview
Agent: claude
Status: completed

## Summary

Added the admin Overview dashboard: backend `getCompanyInsightsV1` (organizer and admin, points admin only) and a portal Overview page that is now the landing page after sign-in. Nothing was deployed.

## Changes

- Contract: `GetCompanyInsightsRequest/Response` and `Insights*` types in `contracts/v1/models.schema.json` (additive), regenerated `gcp/functions/src/generated/models.ts` and the Swift models; `contracts/tests/admin.test.mjs`.
- Backend (`gcp/functions/src/modules/admin`): `application/insights.ts`, `domain/insights.ts`, `insights.read` permission, request parser, store methods `aggregate`, `queryDocs`, `getDoc`, `setDoc` (port, Firestore adapter, fake), callable export `getCompanyInsightsV1`.
- Indexes (`gcp/firestore.indexes.json`): collection-group `rsvps`, `photos`, `comments` (companyId, createdAt); `pointTransactions` (amount, createdAt); `users` (companyId, pointsBalance desc).
- Docs: `docs/contracts/admin.md` (Company insights section, permission row).
- Portal (`apps/admin`): `/overview/` page, `components/Overview.tsx`, `styles/_overview.scss`, `lib/insights.ts`, `lib/insightsMock.ts`, live and mock adapters, sidebar entry, home and login redirect.
- Tests written: `gcp/tests/unit/admin-insights.test.ts`, `apps/admin/src/lib/__tests__/insights.test.ts`.

## Validation

Run: `tsc --noEmit` (gcp/functions and apps/admin), `eslint src` (admin), the two new test files only (9 and 13 tests passing). Not run: full unit, rules, emulator and contract suites, `npm run check`, a production build.

## Decisions

- Lazy server-side cache document (`companies/{c}/insights/summary`, 10 minutes) over aggregation queries instead of a scheduled refresh: no cost for idle companies; see docs/contracts/admin.md.
- Organizers never receive `points`; the cache holds the admin view and is projected per caller.
- Charts are inline SVG with a data table fallback; the mock supports `?insights=empty|low|high|error|slow` for design review.

## Handoff

Deploy (human): function `getCompanyInsightsV1` and the five new indexes (wait for them to build before using the live page). Unverified: queries against the Firestore emulator or a real project (multi-field inequality on `pointTransactions`, collection-group counts), the live adapter against a deployed backend.
