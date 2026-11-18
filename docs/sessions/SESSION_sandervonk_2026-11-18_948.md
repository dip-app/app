# Work session

User: sandervonk
Date: 2026-11-18
Workstream: cover-live-fallback
Agent: Claude Code (Opus lead, Sonnet subagents)
Status: completed

## Summary

"Search more photos" in the admin CoverPicker, built on the live Pixabay fallback (#293). Admins type words, the server searches Pixabay (same PII-stripped query builder, 24 h cache, shared quotas and limiter, safesearch and tag blocklist) and returns preview candidates. Results are shown only temporarily, credited "Photos from Pixabay" as the API terms require, and never persisted on the client. Selecting a candidate imports it server-side: only the key is sent, and the hit must have been remembered from a search in the last 24 h, so a client can never supply a URL. The import then goes through the same download, validation, sharp and storage path as the live fallback.

## Changes

- gcp/functions/src/modules/covers/application/searchCoverPhotos.ts (new), liveCover.ts (shared materializeCover), transport/coverCallables.ts (searchCoverPhotosV1, importCoverPhotoV1), index exports.
- gcp/functions/src/modules/admin/domain/errors.ts: COVER_SEARCH_UNAVAILABLE, COVER_CANDIDATE_EXPIRED, COVER_IMPORT_FAILED.
- contracts/v1/models.schema.json (SearchCoverPhotos*, ImportCoverPhoto*, CoverPhotoCandidate, CoverSearchStatus) and generated outputs; docs/contracts/callables.md, docs/contracts/admin.md.
- apps/admin: adminApi, adminLive, adminTypes, adminMock, lib/covers.ts, CoverPicker.tsx (button, candidate grid, credit link, busy and status states), styles, tests.
- firebase.json: admin CSP (report-only) img-src allows pixabay.com and cdn.pixabay.com for the temporary previews.
- docs/design/cover-library.md, docs/ops/ai-events.md.
- gcp/tests/unit/covers-live-search.test.ts.

## Validation

- `npx tsc --noEmit` clean in gcp/functions and apps/admin.
- `node --import tsx --test gcp/tests/unit/covers*.test.ts`: 179 pass, including 17 search and import tests (auth denial, PII, cache, quota, 429, filtering, remembered-candidate requirement, reuse, failures).
- Admin vitest (covers, CoverPicker): 38 pass.
- `generate-contracts --check` and `check-docs` pass. The rules emulator was not run locally because no new rules are needed (the collections were already server-only).

## Decisions

- Search and import are free (no credits). They count only against the live daily quotas on a cache miss, and they are admin-only (ai.generate).
- Import accepts a key, never a URL; the Pixabay hit comes from the server-side 24 h candidate record.
- Preview images hotlink webformatURL only while the result grid is open (allowed for temporary display), with the Pixabay credit line.

## Handoff

- Deploy: searchCoverPhotosV1 and importCoverPhotoV1 bind PIXABAY_API_KEY (sync secrets first with scripts/secrets/sync-gcp.sh). Hosting redeploys the admin build and the CSP change.
- Follow-up: perceptual dedupe against the static library.
