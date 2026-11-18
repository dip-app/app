# Work session

User: sandervonk
Date: 2026-11-18
Workstream: cover-live-fallback
Agent: Claude Code (Opus lead, Sonnet subagents)
Status: completed

## Summary

Live Pixabay cover fallback for "Let Dipbot choose": when the library has few good matches, pickEventCoverV1 searches Pixabay (24 h Firestore cache, per-instance limiter, per-company and platform daily caps), Dipbot picks among the candidates by their tags (text-only Choice over the DecisionPort), and the server downloads, validates and re-encodes the chosen photo with sharp, stores it in Storage (covers-dynamic/) and records coverLibraryDynamic/pixabay-<id> for global reuse. Dynamic covers keep the catalog://cover/<key> scheme and are served at /img/covers-dyn/** through a Hosting rewrite to coverImageV1. Admin and iOS resolve dynamic keys by prefix; the picker shows "Found a new photo".

## Changes

- gcp/functions/src/modules/covers: application/{livePorts,liveCover,pickCover}.ts, domain/{dynamicCovers,pixabayRules,liveQuery,liveFallback,imageGuards,nearDuplicate,coverCatalog,shortlist}.ts, infrastructure/* (Pixabay client, SSRF-safe downloader, sharp processor, Firestore catalog/writer/cache/quota, image handler), transport/{coverCallables,liveWiring}.ts, index exports.
- gcp/functions/src/modules/ai/infrastructure/aiConfig.ts (AI_COVER_LIVE_* settings); organizer domain/application/infrastructure/transport (dynamic cover key validation in createEventV1/updateEventV1).
- contracts/v1/models.schema.json (PickEventCoverResponse newPhoto, coverAlt) and generated models; docs/contracts/callables.md.
- firebase.json (rewrite /img/covers-dyn/**), gcp/firestore.rules, gcp/storage.rules, gcp/firestore.indexes.json (TTL), gcp/tests/rules/baseline.test.ts.
- gcp/functions/package.json and package-lock.json: sharp 0.34.5 (additive lock entries only).
- scripts/covers: Pixabay rules shared from the functions domain; manifest keys may not start with pixabay-.
- apps/admin: lib/covers.ts, lib/adminLive.ts, components/CoverPicker.tsx, styles/_covers.scss, tests.
- ui/Packages/DIPCore: EventCover.swift dynamic URL plus test.
- docs/design/cover-library.md (Live fallback section), docs/ops/ai-events.md (price row, deploy notes, kill switch).
- Tests: gcp/tests/unit/covers-live-{domain,infra,application}.test.ts, covers.test.ts, organizer-events.test.ts.

## Validation

- `npx tsc --noEmit -p gcp/functions`: clean.
- `node --import tsx --test gcp/tests/unit/covers*.test.ts gcp/tests/unit/ai-application.test.ts gcp/tests/unit/organizer-events.test.ts gcp/tests/unit/share-page*.test.ts`: 317 pass.
- `npm run test:covers`: pass. `python3 scripts/generate-contracts.py --check`: pass. `python3 scripts/check-docs.py`: pass.
- Admin: `npx vitest run src/lib/__tests__/covers.test.ts src/components/__tests__/CoverPicker.test.tsx` 28 pass; `npx tsc --noEmit` clean.
- `swift test --package-path ui/Packages/DIPCore --filter EventCoverTests`: 10 pass.
- Not run locally: rules emulator tests (`npm run test:rules`) and contract tests (ajv-formats missing in the shared node_modules); CI runs them. No real Pixabay, OpenAI or Jev calls (fakes only).

## Decisions

- sharp added to functions (WebP 1200 and JPEG 960 renditions, metadata stripped, difference hash); loaded lazily so other functions do not pay at cold start.
- Dynamic keys are `pixabay-<id>`; clients resolve them by prefix to /img/covers-dyn/ (no Firestore read on clients); served by coverImageV1 behind a Hosting rewrite with immutable caching. Storage and Firestore stay server-only.
- Trigger: best lexical score below 6 or fewer than 2 matched covers. Quotas: 15 searches per instance per minute (5 instances), 20 pulls per company and 200 per platform per UTC day; 24 h search cache.
- Same 1 credit as a cover pick, refunded when no model answered. Generated drafts stay static-only.

## Handoff

- Deploy (coordinator): sync PIXABAY_API_KEY with scripts/secrets/sync-gcp.sh before deploying pickEventCoverV1; deploy functions (pickEventCoverV1, coverImageV1, createEventV1, updateEventV1), then hosting (rewrite), storage and firestore rules and indexes (TTL).
- Follow-ups: "Search more photos" in the CoverPicker (separate PR), perceptual dedupe against the static library (needs difference hashes in the generated index).
