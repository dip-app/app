# Work session

User: sandervonk
Date: 2026-11-11
Workstream: V2-01 coworker invitations (F4)
Agent: claude
Status: active

## Summary

Coworker invitations end to end on `feature/v2-coworker-invites` (from `origin/feature/v2-combined`): backend first (callables, rules, notifications, tests, contracts), then the iOS invite action, coworker picker, invitations inbox and Firebase adapter.

## Changes

Backend (PR 1):
- `contracts/v1/models.schema.json` (additions only) + generated TS/Swift: `SendInviteRequest/Response`, `RespondToInviteRequest/Response`, `ListCoworkersRequest/Response`, `Coworker`; optional `EventInvite` display fields.
- `gcp/functions/src/modules/invites` (domain / application / infrastructure / thin transport): `sendInviteV1`, `respondToInviteV1`, `listCoworkersV1`; exported from `src/index.ts`.
- `participation/application/setRsvp.ts`: the transaction body is extracted as `applyRsvp` (behavior unchanged) and reused by invite acceptance.
- `notifications/domain/push.ts`: `PushType` (`invite`) and `invitePush`; the push uses the existing `sendPush` pipeline.
- `gcp/firestore.rules`: `companies/{c}/invites/{id}` (sender/recipient reads, no writes) and `users/{uid}/notifications/{id}` (recipient read, isRead-only update).
- Tests: `gcp/tests/unit/invites.test.ts`, `gcp/tests/rules/invites.test.ts`, `gcp/tests/integration/invites-callable.test.ts`, `contracts/tests/invites.test.mjs`; `npm run test:invites:integration` in CI.
- Docs: callables.md (Coworker invitations), data-ownership.md, FRONTEND_PLAN F4 row.

## Validation

- Run: `npx tsc --noEmit` (functions) clean; `node --import tsx --test` for `invites`, `participation` and `notifications` unit tests pass (19 + 36 tests).
- Not run (deferred by the coordinator until integration): `npm run check`, `npm run test:rules`, `npm run test:invites:integration`, `test:contracts`.

## Decisions

- Coworker list: server-provided minimal directory callable (`listCoworkersV1`), name + avatar id + team only, query >= 2 characters, rate limited; no company-wide profile list and no `users` rules change.
- Invite id `{eventId}_{toUserId}`: one invitation per person per event, concurrency-safe by construction; a declined invite blocks a re-invite.
- Acceptance reuses `applyRsvp` inside one transaction, so full/closed events leave the invite pending.
- Push only after commit, best-effort, via the existing token registry (the client push flag controls whether tokens exist).

## Handoff

Deploy list (owner, nothing deployed): Firestore rules (invites, notifications), functions `sendInviteV1`, `respondToInviteV1`, `listCoworkersV1`; optional TTL policy on `inviteRateLimits.expiresAt`. No new indexes.
