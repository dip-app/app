# Work session

User: sandervonk
Date: 2026-11-18
Workstream: smart-location
Agent: Claude (Opus lead, Sonnet implementers)
Status: completed

## Summary

Admin portal half of Smart location (backend and contract are session 108, PR #307). The event form's Where section gets an address typeahead backed by the `autocompletePlacesV1` / `resolvePlaceV1` callables, and admins get "Dipbot venues": a one-credit venue finder near the company office, built on the shared `DipbotAction` button. Reviewed through several screenshot and audit rounds at 1440 and 390 px until no P1 or P2 items were left.

## Changes

- Where section (`apps/admin/src/components/WhereSection.tsx`, `AddressCombobox.tsx`, `DipbotPickedTag.tsx`; `EventForm.tsx` wiring only; optional `badge` on `Toggle`). No latitude/longitude inputs: coordinates and `venue.placeId` are set by a pick, a Dipbot venue click, or the save step `lib/location/saveLocation.ts` (unchanged saved address keeps stored coordinates; typed text is resolved once; Places off saves 0/0): typeahead combobox with Places session tokens. After a pick, a summary row replaces the input; "Change" brings the input back prefilled and focused. Order: address, venue name and city/area, Outdoor toggle, Dipbot venues last. A typed address that is not found (`PLACE_NOT_FOUND`) blocks Create with "We couldn't find that address. Pick one from the suggestions."; a stale place id on a pick shows the same message in the dropdown.
- Location client (`apps/admin/src/lib/location/**`: callable-backed and fake providers, `venueFill`, `highlight`; api additions in `adminApi`/`adminLive`/`adminMock`/`adminTypes`/`firebaseAdapter`; `contract.ts` coordinate validation moved to the save step): `LocationError` has a `notFound` kind; a typed-address lookup treats it as not found.
- Dipbot venues (`DipbotVenues.tsx`, `lib/venues.ts`): office setup and "Change office", radius select, single-column venue list (hairline rows, hover, pressed and focus states, "Use" / "Selected"), Google Maps attribution. The find button is the shared `DipbotAction` (credit cost, loading, disabled when out of credits, full width on phones); the no-title state keeps `aria-disabled` with the hint linked by `aria-describedby`. Duplicated button styling was removed from `_where.scss`; unused `venues.findShort` and `venues.findAria` strings removed.
- Styles (`_where.scss`), strings (`aiStrings.ts`), invalid inputs show a red focus ring only.
- Tests: `Where.test.tsx` (combobox, DOM order, venues, save paths), `location.test.ts`.

## Validation

- `npx tsc --noEmit` and `npx eslint src` (apps/admin): clean.
- `npx vitest run src/lib/__tests__ src/components/__tests__` (emulator test excluded): 512 tests, all pass on a clean run. `Ideas.credits.test.tsx` timed out once while the machine was under disk pressure and passed on rerun (6 of 6).
- Screenshots: 14 images (7 states at 1440 and 390 px) retaken with `shots.mjs` against the dev server on port 3111 and inspected; the audit P1 and P2 items hold. Dev server stopped and `apps/admin/.next` removed.
- Not run: root checks, rules emulator, Xcode (no changes outside `apps/admin` and docs).

## Decisions

- One shared button for every Dipbot action with a credit cost: `DipbotAction`, not a venue-specific pill.
- The disabled no-title state stays focusable (`aria-disabled`, not `disabled`) so the reason can be read; out of credits uses real `disabled` plus the visible credits note.

## Handoff

- No live Places calls were made; the admin UI was exercised against the fake provider (`?places=` scenarios). Owner switches before use: `PLACES_ENABLED=true` and `AI_VENUES_ENABLED=true` in the functions env after PR #307 is deployed.
- Confirm the first live Autocomplete (New) response (no field mask) and the 30-day coordinate refresh on a real event.
- The machine's disk was nearly full during this session; free space before the next large build.
