# Work session

User: sandervonk
Date: 2026-11-11
Workstream: RSVP profile snapshot
Agent: Claude Code
Status: active

## Summary

The Participants list now shows job title and department. RSVPs snapshot `userJobTitle` (new, optional) next to `userDepartment`; a new users/{uid} update trigger keeps the snapshot current on upcoming and recent events; a dry-run-first backfill fills existing RSVPs.

## Changes

- contracts/v1/models.schema.json: optional `userJobTitle` on RSVP (additive); regenerated TypeScript and Swift models.
- gcp/functions: setRsvp snapshots userJobTitle; new participation domain/application/infrastructure/transport for `onUserProfileUpdated` (exported in src/index.ts); unit tests in gcp/tests/unit/rsvp-profile-snapshot.test.ts and participation.test.ts.
- gcp/scripts/backfill-rsvp-profile.mjs (dry-run by default).
- docs/contracts/callables.md: RSVP snapshot field and the trigger.
- iOS: DIPParticipant.jobTitle and one-line subtitle "Job title · Department", RsvpAttendee mapping of `userJobTitle`, participants screen; DIPCore and DIPTests tests.
- No rules change (RSVPs are server-written; the attendee list is read as before).

## Validation

- npm run build, npm run test:unit (171 tests, 0 fail), test:contracts, check:generated, test:docs passed.
- DIPCore ParticipantSubtitleTests; DIPTests MemberParticipationTests and MemberEventAppRepositoryTests (see PR).

## Decisions

- The trigger queries events by `endTime >= now - 30 days` (single-field automatic index) and reads only the user's own rsvps/{uid} per event; no collection-group query, no counts touched, at most 500 events.
- Deploy only functions (`setRsvpV1`, `onUserProfileUpdated`); then run the backfill with --apply.

## Handoff

Backfill counts and the deploy output are recorded in the PR.
