# Work session

User: sandervonk
Date: 2026-11-03
Workstream: 04-organizer-events
Agent: Claude Sonnet 5.5
Status: handoff

## Summary

First V1 admin (organizer) portal at apps/admin, built from the sandervonk/nextjs-template setup, running against a mock API until the organizer callables exist.

## Changes

- apps/admin: Next.js 15 static export, DIP-token SCSS, pages for login, events list (Upcoming/Past/Cancelled), create and edit.
- src/lib/contract.ts: EventDraft/Event types, client-side validation mirroring the contract, timestamp-based classification.
- src/lib/api.ts: `AdminApi` interface and a localStorage mock enforcing authorization, requestId deduplication, expectedRevision conflicts, capacity floor and server-assigned fields.
- Vitest tests for validation, price parsing and the mock API.

## Validation

- `npm test`: 10 tests pass; `npm run build` succeeds; `tsc --noEmit` clean.
- In the browser: login, event list, empty-form validation errors, and deep-link reload of /events/new/ (fixed a bug where a reload bounced to the list).
- Not run: the create and edit flows end to end in the browser, mobile layout, the root `npm run check`, CI wiring.

## Decisions

- Mock mode and apps/admin location were chosen by the user. Authorization is modeled in the mock but only the backend is a real boundary.
- Cover images are placeholder gradients because the approved catalog is pending.
- No CI job added for apps/admin (shared workflow files belong to integration).

## Handoff

Implement createEventV1/updateEventV1 and admin event read rules, then add a Firebase adapter behind `AdminApi`. Add an apps/admin job to CI. Swap placeholder covers for the approved catalog.
