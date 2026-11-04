# 04 — Organizer events

**Area:** Organizer features. **Owner:** assign one human in the issue. Covers V1-05 from [V1](../../V1.md).

## Pasteable agent brief

> Implement the V1 organizer-events packet in `docs/milestones/v1/04-organizer-events/README.md`. Read root/folder `AGENTS.md`, root `SESSION.md`, and the callable/data-ownership contracts. Work only in owned paths in a separate branch/worktree. Implement createEventV1/updateEventV1 and their SwiftUI/domain/data consumers, keeping validation and authorization on the server. Preserve requestId across create retries and use expectedRevision for edits. Coordinate denormalized RSVP date consistency with participation and the integrator. Do not edit shared rules/exports/project files or other feature folders. Log each work session under `docs/sessions/`; multiple commits may share a session. Report reviewable tests and handoffs.

## Owned paths

- `ui/DIP/Features/Organizer/**`
- `ui/DIP/Domain/Organizer/**`
- `ui/DIP/Data/Organizer/**`
- `ui/DIPTests/Organizer/**`
- `gcp/functions/src/modules/organizer/**`
- Feature-specific files `gcp/tests/unit/organizer*.test.ts`, `gcp/tests/integration/organizer*.test.ts`, `gcp/tests/rules/organizer*.test.ts`.
- This packet's `README.md` and your own new session log(s).

Do not touch other owners' paths. Shared callable exports, app composition, rules/indexes, project/package configuration, lockfiles, schemas/generated code, and token/catalog changes belong to coordinated integration.

## Prerequisites and contracts

[Callables](../../../contracts/callables.md) defines `createEventV1`, `updateEventV1`, EventDraft limits, requestId deduplication, expectedRevision, errors, and retry rules. [Data ownership](../../../contracts/data-ownership.md) defines server-owned event fields, minimal profile access, and the proposed revision seed migration. The accounts owner provides trusted membership context; backend authorization still reads trusted membership for each command. V1 organizers are manually assigned admins. Use the approved default-image catalog; no upload workflow.

## Acceptance tests

- [ ] Test valid create/edit, required fields and limits, nonnegative integer cents, capacity bounds, UTC date syntax/order, future creation, valid tags/coordinates, and approved default-image selection.
- [ ] Test signed-out, member, and other-company admin rejection. UI visibility is not the authorization boundary.
- [ ] Test create retry with the same requestId returns the same event/revision; simultaneous replay creates one event. Reusing the key with changed payload fails.
- [ ] Test server assignment of companyId, author/audit fields, attendeeCount=0, pointsValue=0, scheduled status, and revision=1 on create.
- [ ] Test full-draft update with expectedRevision; stale/concurrent edits return aborted without overwriting a successful edit. The UI reloads and lets the user reconcile.
- [ ] Test capacity cannot fall below active attendees, and scheduled/cancelled behavior follows the contract. No hard deletion is introduced.
- [ ] Agree on and test the event-time/RSVP.eventStartTime synchronization strategy with participation before editing is released. Include partial-failure/reconciliation evidence if the strategy is not one transaction.
- [ ] Test ambiguous update timeout recovery: reload revision/content before resubmitting; do not blindly retry as a new edit.
- [ ] Run relevant schema, domain/UI, backend and emulator tests; give the integrator any rule/export/test-wiring changes separately.

## Handoff

Provide discovery a compatible created/updated Event fixture and the precise revision/time synchronization behavior. Provide the integrator exports, private receipt retention/seed/migration requirements, required permissions, routing, and configuration changes. Report unresolved receipt lifetime, image catalog, or seed revision decisions explicitly. Points, challenges, rewards, and approval tools remain V2 work.

## Status against the acceptance tests (November 3)

Backend: `createEventV1`/`updateEventV1` (`gcp/functions/src/modules/organizer`) with unit tests (`gcp/tests/unit/organizer-events.test.ts`), rules tests (`gcp/tests/rules/organizer-events.test.ts`) and an emulator callable test (`gcp/tests/integration/organizer-callable.test.ts`, `npm run test:organizer:integration`). Deployed to `team05-dip` on November 3, 2026 (rules and functions; unauthenticated calls verified to be refused). Frontend: `apps/admin` ([README](../../../../apps/admin/README.md), preview at https://team05-dip.web.app) still runs on a **mock** `AdminApi` and is not connected to the callables.

| Acceptance test | Evidence |
| --- | --- |
| Valid create/edit; required fields; limits; integer cents; capacity bounds; UTC order; future start on create; tags and coordinates; approved image | Server: unit tests (validation) and emulator test. Portal: mirrored client validation. Cover catalog is a placeholder until design approves it |
| Signed-out, member, other-company admin rejection | Server: unit + emulator tests (`UNAUTHENTICATED`, `NOT_ORGANIZER`, `COMPANY_MISMATCH`); rules tests deny cross-company reads and all client writes. Portal shows "No organizer access" (convenience only) |
| Create retry with the same `requestId`; changed payload fails; simultaneous replay creates one event | Unit test and emulator test (five concurrent identical requests produce one event) |
| Server-assigned fields (company, author, attendeeCount 0, pointsValue 0, scheduled, revision 1) | Unit and emulator tests |
| `expectedRevision` conflicts return `aborted` without overwriting | Unit and emulator tests |
| Capacity not below active attendees; cancel/restore without deletion | Unit and emulator tests |
| Ambiguous update timeout recovery | Portal reloads the saved revision before another save; server `aborted` semantics tested |
| Event time vs RSVP `eventStartTime` synchronization | **Open.** Time changes are refused while people are going (`TIME_CHANGE_BLOCKED`); strategy still to be agreed with participation |
| Relevant schema, domain/UI, backend and emulator tests | Run: `npm run test:unit`, `npm run test:rules`, `npm run test:organizer:integration` |

Not done: assigning the first organizer, a Firebase adapter behind the portal's `AdminApi`, real Google sign-in with organizer assignment tooling, the approved image catalog, `ui/DIP/Features/Organizer` (the native iOS organizer screens), and the V1-11 device evidence.
