# Work session

User: sandervonk
Date: 2026-11-18
Workstream: smart-location
Agent: Claude (Opus lead, Sonnet implementers)
Status: completed

## Summary

Backend and contract half of Smart location: Google Places API (New) behind a server `LocationProvider` port, called with the Functions service account over OAuth (no API key anywhere). New callables `autocompletePlacesV1`, `resolvePlaceV1`, `setCompanyOfficeV1`, `findVenuesV1` (Dipbot venue finder, Jev ranking, 1 credit), the scheduled `refreshPlaceLocations` job for the 30-day coordinate caching limit, and the design/ops docs. The admin portal half follows in its own PR (session 109).

## Changes

- Contract (`contracts/v1/models.schema.json`, regenerated TS and Swift): additive `Venue.placeId`, `Event.venueLocationAt` (server-owned), `Company.officeAddress`/`officePlaceId`/`officeLocationAt`, `AiCreditCosts.venueSearch`, new `CompanyOffice`, `PlaceSuggestion`, `ResolvedPlace`, `VenueOption` and the request/response pairs of the four callables.
- New module `gcp/functions/src/modules/places/**` (domain: categories, ranking, venueQuestion, geo, office, paths; application: placeLookups, findVenues, setCompanyOffice, refreshPlaceLocations, quota, ports; infrastructure: googlePlaces, googleToken, fakePlaces, firestoreBucketLimiter; transport: placesCallables), tests `gcp/tests/unit/places.test.ts`.
- Edited: `gcp/functions/src/index.ts`, admin `permissions` (`company.manage`), `auditActions` (`company.office.update`), `errors`, ai `ports`/`credits`/`paths`/`aiConfig` (`venuePick` step), organizer event draft (`venue.placeId`, `venueLocationAt` stamping), `gcp/firestore.indexes.json` (TTLs, `events.venueLocationAt` collection-group override), `gcp/firestore.rules` (comment only), `gcp/tests/rules/ai.test.ts`, credit expectations in two unit tests.
- Docs: `docs/design/smart-location.md`, `docs/contracts/{callables,admin}.md`, `docs/ops/{ai-events,launch-switches,secrets}.md`.

## Validation

- `node --import tsx --test ../tests/unit/places.test.ts` (from gcp/functions): 36 pass.
- Functions unit suite: 1411 tests, 1405 pass, 0 fail (rest skipped).
- `npm run build`, `npm run check:generated`, `npm run test:contracts` (59 pass), `python3 scripts/check-docs.py`, `npm run test:sessions`: pass.
- `swift test --package-path ui/Packages/DIPContracts`: pass (generated Swift is source compatible; new fields optional).
- Not run: rules emulator suites; no call to the real Google API (fake provider and fake fetch only).

## Decisions

- Provider: Google Places API (New), owner decision. Server side only; typeahead is a pass-through callable with Places session tokens (a session ending in Place Details Pro makes its autocomplete requests free), so no browser key exists. Geoapify stays documented as the fallback.
- Field masks keep calls on Essentials/Pro SKUs; no Enterprise fields (ratings, hours, price, website), so nothing unverified can be shown.
- Storage follows the Google Maps Platform terms: place IDs kept; coordinates refreshed within 25 days or retired to 0/0 after the event ends; the venue cache stores only place IDs and derived ranks and re-fetches details on a hit; suggestion lists are never stored.
- Cost guards: `PLACES_DAILY_LIMIT` (default 400 per company), per-user typing limiter, `AI_VENUES_DAILY_LIMIT`, kill switches `PLACES_ENABLED` and `AI_VENUES_ENABLED`.

## Handoff

Deploy (owner, not done here): set `PLACES_ENABLED=true` and `AI_VENUES_ENABLED=true` in the functions env, deploy the indexes before the refresh job, deploy functions, add a $5 Cloud Billing budget alert and Places API per-day quota caps. The runtime service account already has `roles/editor` (includes `serviceusage.services.use`). Open: Autocomplete (New) is called without a field mask; confirm on the first live call.
