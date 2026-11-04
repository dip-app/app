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

## Admin portal status against the acceptance tests (November 3)

`apps/admin` ([README](../../../../apps/admin/README.md), deployed preview at https://team05-dip.web.app) is a web organizer portal running against a **mock** `AdminApi`. It exercises the contract's behavior but is **not** server enforcement, so none of these count as V1-05 backend evidence until the callables exist.

| Acceptance test | Portal (mock) | Still needs |
| --- | --- | --- |
| Valid create/edit; required fields; limits; integer cents; capacity bounds; UTC order; future start on create | Covered by `apps/admin` unit tests and the form | Server validation in `createEventV1`/`updateEventV1` with its own tests |
| Valid tags and coordinates | Tags are catalog IDs checked for existence; coordinates bounded | Same-company tag lookup on the server |
| Approved default-image selection | Category covers from a placeholder catalog (`catalog://default/...`) | Design-approved catalog and server URL policy |
| Signed-out, member, other-company admin rejection | Mock rejects all three; UI shows "No organizer access" for non-organizers | Server authorization from trusted membership; Firestore rules tests |
| Create retry with the same `requestId`; changed payload fails | One key per create attempt, reused on retry; mock dedupes | Transactional receipt record, simultaneous-replay test |
| Server-assigned fields (company, author, attendeeCount 0, pointsValue 0, scheduled, revision 1) | Mock assigns them | Server implementation |
| `expectedRevision` conflicts; capacity not below attendees; cancel without delete | Mock aborts stale edits; UI offers "Reload latest" | Transactional implementation |
| Ambiguous update timeout recovery | UI says to reload the saved revision before saving again | Backend `aborted` semantics under real timeouts |
| Event time vs RSVP `eventStartTime` synchronization | Not modelled | Strategy agreed with participation, plus tests |

Not started: `createEventV1`/`updateEventV1`, admin event read rules and emulator tests, a Firebase adapter behind `AdminApi`, real Google sign-in and the organizer role check, and the physical-device/another-laptop evidence in V1-11.
