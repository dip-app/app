# Work session

User: sandervonk
Date: 2026-11-03
Workstream: 04-organizer-events
Agent: Claude Sonnet 5.5
Status: handoff

## Summary

Implemented the V1 organizer backend: `createEventV1` and `updateEventV1`, event read rules and the tests behind them. Nothing was deployed.

## Changes

- gcp/functions/src/modules/organizer: domain (strict request/draft validation, error reasons), application services (authorization from server-owned membership, requestId idempotency via a private receipt, expectedRevision guard, capacity floor), Firestore transaction adapter and `onCall` transport; exported from functions/src/index.ts.
- gcp/firestore.rules: same-company event reads (members: scheduled only; organizers: all); no client writes; `commandReceipts` server-only.
- Tests: gcp/tests/unit/organizer-events.test.ts, gcp/tests/rules/organizer-events.test.ts, gcp/tests/integration/organizer-callable.test.ts; `npm run test:organizer:integration` and a CI step in checks.yml.
- Docs: callables.md (Organizer commands), data-ownership.md, CURRENT_STATE.md, V1 STATUS row, packet 04 status table, portal README.

## Validation

- `npm run check` passes (unit: 82 run, 76 pass, 6 pre-existing TODOs, 0 fail).
- `npm run test:rules`: 91 pass (5 new).
- `npm run test:organizer:integration`: passes against the Auth/Functions/Firestore emulators, including five concurrent identical creates producing one event.
- Not run: iOS/Xcode checks (no Swift changes), deployment, App Check enforcement (bypassed only in the official Functions emulator).

## Decisions

- Start-time edits are refused while attendeeCount > 0 (TIME_CHANGE_BLOCKED): RSVP eventStartTime snapshots cannot be rewritten in one transaction and the strategy is not agreed with participation.
- `APPROVED_COVER_URLS` is a placeholder for the design-approved catalog; receipt retention is still undecided.
- Shared files touched with the packet's integrator approval from the maintainer: functions/src/index.ts, firestore.rules, package.json, checks.yml.

## Handoff

Deploy the rules and functions (a deliberate manual step), connect the portal through a Firebase adapter, add real Google sign-in with organizer assignment tooling, agree the RSVP start-time strategy with participation, and settle the approved image catalog and receipt retention. A composite index for the discovery feed (status + startTime) belongs to the discovery owner.
