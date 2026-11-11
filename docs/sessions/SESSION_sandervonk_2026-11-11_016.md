# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Stream B live albums
Agent: Claude Code
Status: active

## Summary

Stream B (FRONTEND_PLAN F5, V2-05) on `feature/v2-stream-b` from `feature/v2-remaining`. PR 1: the album backend slice (Storage rules, Firestore album/comment rules, `finalizeEventPhotoV1`, comment-count trigger, contracts, tests, docs). PRs 2-3 (iOS adapter/add flow, viewer/comments/empty states) follow in this session.

## Changes

- contracts/v1/models.schema.json (+ generated TS/Swift): `FinalizeEventPhotoRequest/Response`; optional server-owned `EventPhoto.sizeBytes`/`contentType`; descriptions on `downloadURL`, `storagePath`, `commentCount`. Additive only.
- gcp/functions/src/modules/photos/** (domain policy, application service, Firestore/Storage adapters, transport); exported from gcp/functions/src/index.ts.
- gcp/storage.rules (album slots), gcp/firestore.rules (photos + comments).
- Tests: gcp/tests/unit/photos.test.ts, gcp/tests/rules/photos.test.ts, gcp/tests/integration/photos-callable.test.ts, contracts/tests/photos.test.mjs; `test:photos:integration` script and CI step.
- Docs: docs/contracts/callables.md (Event photo albums), docs/contracts/data-ownership.md, CURRENT_STATE.md.

## Validation

- `npm run check` (Node 24.12.0): generated in sync, sessions, docs, contracts, build, 178 unit tests pass.
- `npm run test:rules`: 134/134 pass (15 new photo tests: Storage + Firestore).
- `npm run test:photos:integration`: 7/7 pass (real client SDKs, Storage/Firestore/Functions/Auth emulators).

## Decisions

- Eligibility: going RSVP (proves same-company membership), event `scheduled` and ended; no attendance (`checkedIn`) requirement; no closing window.
- Limits: 20 per member per event via 20 create-only Storage slots (`photos/{uid}/{0..19}`), 10 MiB, jpeg/png/heic with file-signature check in finalize. Slots bound orphans without a counter (Storage rules cannot count; cross-service rules are limited to two Firestore reads).
- `photoId = {uid}_{slot}` (deterministic, idempotent); no download-token URLs (`downloadURL: ""`), authenticated SDK reads only.
- Comments: client append under rules for any verified same-company member; `commentCount` recounted by a trigger (idempotent).
- Favorites and photo deletion deferred (no designed control; `favoritePhotoIds` stays server-owned).

## Handoff

Nothing deployed. Owner deploy: `firebase deploy --only storage,firestore:rules,functions:dip:finalizeEventPhotoV1,functions:dip:onPhotoCommentCreated` (accept the cross-service Storage->Firestore permission prompt).
