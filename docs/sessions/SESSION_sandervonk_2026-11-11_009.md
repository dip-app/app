# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Share link rich previews
Agent: Claude Code
Status: completed

## Summary

Server-rendered Open Graph / Twitter preview page for event share links (`/e/<id>`).

## Changes

- gcp/functions/src/modules/share/** (new) and one export in gcp/functions/src/index.ts.
- gcp/functions/src/modules/organizer/infrastructure/firestoreOrganizerStore.ts: createEvent also writes eventShares/{eventId}.
- firebase.json (shared choke point): the /e/** rewrite now targets eventSharePageV1; other rules unchanged.
- apps/admin/public/share/og/*.jpg, scripts/generate-share-og-images.sh, gcp/scripts/backfill-event-shares.mjs.
- Removed apps/admin/public/share/event.html. Updated docs/design/share-links.md, docs/milestones/v2/FRONTEND_PLAN.md, scripts/tests/test_hosting_share_links.py. Added gcp/tests/unit/share-page.test.ts.

## Validation

- node --import tsx --test gcp/tests/unit/share-page.test.ts (18 pass); npm run check (157 pass, 0 fail); python hosting test.

## Decisions

- Chose an eventShares/{eventId} index because no id field or collection-group index exists; two field-masked reads; every non-shareable id returns the same generic 200 page.

## Handoff

Owner approved deployment; deploy and live verification results are in the PR.
