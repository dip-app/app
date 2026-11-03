# DIP Admin portal (V1)

Organizer portal for V1-05, built from the `sandervonk/nextjs-template` setup (Next.js 15, SCSS, strict TypeScript, static export) and styled with the DIP tokens.

## What it does

- Sign in screen (preview personas: organizer and member).
- Events list filtered by Upcoming / Past / Cancelled, classified from timestamps and status.
- Create and edit an event with every `EventDraft` field, validated like the contract: title/description limits, UTC time order, future start on create, venue and coordinate bounds, integer price, capacity bounds, cover from the default catalog.
- Create keeps one `requestId` across retries; edit sends `expectedRevision` and offers "Reload latest" on a conflict; capacity cannot drop below people already going; events can be cancelled and restored, never deleted.

## Mock mode (current)

There are no organizer callables yet (`createEventV1`, `updateEventV1` are specified in `docs/contracts/callables.md`, not implemented). `src/lib/api.ts` defines the `AdminApi` interface and a localStorage-backed mock that enforces the same rules (authorization, requestId dedupe, revision conflicts, server-assigned fields). Swap in a Firebase adapter (Google sign-in, the two callables, admin event reads under reviewed rules) without touching the UI. Visibility in the UI is never the authorization boundary.

Open items: the default-image catalog (`src/lib/catalog.ts` holds placeholders until design approves it), RSVP start-time synchronization when times change, and the live Firebase adapter.

## Run

```sh
cd apps/admin
npm install
npm run dev      # http://localhost:3100
npm test         # contract and mock API tests
npm run build    # static export to out/
```
