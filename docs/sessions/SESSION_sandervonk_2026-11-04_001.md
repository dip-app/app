# Work session

User: sandervonk
Date: 2026-11-04
Workstream: 04-organizer-events
Agent: Claude Sonnet 5.5
Status: handoff

## Summary

Aligned `updateEventV1` with the V1 decision recorded in issue #14: any RSVP record, including cancelled ones, locks both the start and end time. The first deployed version only blocked start-time changes while attendeeCount > 0, which could leave stale start-time snapshots on cancelled RSVPs.

## Changes

- organizer module: `hasAnyRsvp` in the transaction port and Firestore adapter (reads one document of `events/{id}/rsvps` in the same transaction); `StoredEvent` carries `endTime`; any change to start or end with an RSVP record present fails `TIME_CHANGE_BLOCKED` (fields startTime and endTime). Other fields and the cancelled status stay editable.
- Tests: unit tests for a cancelled-only RSVP locking start and end, unchanged times staying editable, and times changing freely without RSVPs; the emulator test now writes a cancelled RSVP and asserts both locks.
- Portal: the mock mirrors the lock (attendeeCount > 0) and the edit form disables the time fields with an explanation; two portal tests.
- Docs: callables.md (time lock and receipt retention decisions from #14), CURRENT_STATE.md, packet 04 table.

## Validation

- `npm run check` passes (unit: 84 run, 78 pass, 6 pre-existing TODOs). `npm run test:organizer:integration` passes against the emulators. Portal: 16 tests, lint, typecheck.
- Not run: iOS/Xcode (no Swift changes).

## Decisions

- Decisions from issue #14 applied: receipts retained without automatic deletion; any RSVP record locks start and end.

## Handoff

Deploy functions after merge (rules did not change). The portal mock approximates "any RSVP record" with attendeeCount > 0; the server is the authority.
