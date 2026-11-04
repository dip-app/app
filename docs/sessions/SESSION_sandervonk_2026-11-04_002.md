# Work session

User: sandervonk
Date: 2026-11-04
Workstream: 04-organizer-events
Agent: Claude Sonnet 5.5
Status: handoff

## Summary

Added a Firebase "live mode" to the admin portal behind the existing AdminApi interface, proven end to end against the emulators. The hosted preview stays on the mock until production configuration exists.

## Changes

- apps/admin/src/lib/firebaseAdapter.ts: Google sign-in (popup), `resolveMembershipV1` on first sign-in, session role from `users/{uid}`, Firestore reads for the event feed and `tags`, `createEventV1`/`updateEventV1` callables, mapping of callable errors to portal errors (definite server answers become ApiErrors with field messages; transport failures stay plain errors so forms reload before saving again), emulator and App Check hooks. Selected at build time by `NEXT_PUBLIC_FIREBASE_*` variables; `.env.example` documents them.
- AdminApi gained `mode`, an optional persona on `signIn` and `listTags()`; the form loads tags from the catalog instead of a hardcoded list; `normalizeDraft` now projects exactly the EventDraft fields (the server rejects unknown keys).
- Tests: `firebaseAdapter.emulator.test.ts` (sign-in, member vs organizer, tags, create with retry, edit, stale revision, validation fields, cancelled-RSVP time lock, cancel) via `npm run test:admin:live`, wired into the checks workflow (accounts-integration job).
- Docs: apps/admin README (live-mode setup), CURRENT_STATE, V1 status row, packet 04.

## Validation

- Portal: 17 tests (16 unit, 1 emulator), lint, typecheck. `npm run test:admin:live` passes against the Auth/Firestore/Functions emulators.
- Not done: any production configuration (web app registration, App Check key, organizer assignment) or a hosted live-mode build.

## Decisions

- Mock stays the default so the hosted preview does not break: production callables enforce App Check, which needs a registered reCAPTCHA key for the web app.

## Handoff

Register the web app, create and register an App Check reCAPTCHA Enterprise key, assign the first organizer, build with the variables set and deploy (steps in apps/admin/README.md).
