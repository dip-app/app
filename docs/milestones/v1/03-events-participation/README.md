# 03 — Events and participation

**Area:** Discovery and participation. **Owner:** assign one human in the issue. Covers V1-03, V1-04, V1-06 through V1-09 from [V1](../../V1.md).

## Pasteable agent brief

> Implement the V1 events/participation packet in `docs/milestones/v1/03-events-participation/README.md`. Read root/folder `AGENTS.md`, root `SESSION.md`, and both contract documents. Own only the listed UI/domain/data and participation-module paths in an isolated branch/worktree. Build feed/details, attendees, RSVP/cancel, My Events, default imagery integration, and standard sharing against shared fixtures and setRsvpV1. Use shared UI components and the accounts membership protocol. Coordinate rules, indexes, exports, schema changes, and app composition with the integrator. Record one session log per session, which may span multiple commits. Handoff test results and integration needs explicitly.

## Owned paths

- `ui/DIP/Features/Events/**`, `ui/DIP/Features/MyEvents/**`
- `ui/DIP/Domain/Events/**`, `ui/DIP/Domain/MyEvents/**`
- `ui/DIP/Data/Events/**`, `ui/DIP/Data/MyEvents/**`
- `ui/DIPTests/Events/**`, `ui/DIPTests/MyEvents/**`
- `gcp/functions/src/modules/participation/**`
- Feature-specific files `gcp/tests/unit/participation*.test.ts`, `gcp/tests/integration/participation*.test.ts`, `gcp/tests/rules/participation*.test.ts`.
- This packet's `README.md` and your own new session log(s).

Do not edit organizer/accounts/UI-foundation owned paths. Shared rules/indexes, function exports, app composition, configuration, lockfiles, contract sources/generated files, and token sources require the integration owner.

## Prerequisites and contracts

Use [callables](../../../contracts/callables.md) for `setRsvpV1`, capacity, cancellation cutoff, retry/errors, and trusted RSVP snapshots. Use [data ownership](../../../contracts/data-ownership.md) for tenant-scoped reads, paginated feed/attendees, collection-group My Events constraints, and Firestore-listener authority. The accounts owner provides membership context; the organizer owner supplies event seed/creation compatibility. Confirm the default-image catalog with design. Do not implement photo uploads or live deep links in V1.

## Acceptance tests

- [ ] Unit-test Upcoming/Past classification using Event.endTime, empty/error/loading states, date formatting boundaries, and My Events exclusion of cancelled RSVPs.
- [ ] Test same-company feed/details/attendee reads, cursor pagination, and signed-out/cross-company denial. Attendees use the permitted RSVP snapshots, not private profile queries.
- [ ] Test first join, repeated going request, cancel, repeated cancel, and rejoin: one RSVP identity and correct attendeeCount without underflow.
- [ ] Test concurrent last-seat requests: at most one new attendee succeeds. Past/closed/full event cases return the specified errors and actionable UI states.
- [ ] Verify no direct client RSVP/count/attendance write succeeds; no client-supplied role, UID, count, or user snapshot is trusted by the server.
- [ ] Verify joined/cancelled state persists across navigation, listener refresh, and app reload. Dispose listeners when membership or account changes.
- [ ] Verify My Events queries constrain companyId, userId, and going status; test corresponding collection-group rules/indexes after integrator wiring.
- [ ] Verify standard iOS sharing supplies useful event information without creating an invite or promising in-app link opening. Use one Join action and explicit joined feedback.
- [ ] Run relevant domain/UI, backend, concurrency/emulator, and contract tests. Record manual physical-device share-sheet checks separately.

## Handoff

Give the integrator the participation export, required queries/indexes/rule changes, routes, and membership/component dependencies. Coordinate RSVP.eventStartTime consistency with organizer editing; do not independently change that strategy. Give organizer tests a reusable synthetic event/RSVP fixture and clear attendance-count expectations. Surface pending UI assets or permission dependencies before declaring the flow complete.
