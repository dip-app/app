# Work session

User: sandervonk
Date: 2026-11-10
Workstream: Chat, push and change-history backend
Agent: Claude Code
Status: handoff

## Summary

Workstream C1 on `feature/chat-push-backend` (from origin/main 3f622b7): Firebase backend for live Activity Chat, FCM push infrastructure, per-event notification preferences, event change history and reminders. New Functions module `gcp/functions/src/modules/notifications` (domain/application/infrastructure/transport), additive rules/indexes/schema, unit, rules and emulator integration tests, and contract docs. Nothing deployed; no production writes. The log filename uses sequence 031 to avoid colliding with parallel agents' same-day logs.

## Changes

- `gcp/functions/src/modules/notifications/**` (new): `registerDeviceV1`, `unregisterDeviceV1` (callables), `onEventMessageCreated`, `onEventChanged`, `onRsvpChanged` (Firestore triggers), `sendEventReminders` (onSchedule every 15 minutes, Etc/UTC); reusable `sendPush` (500-token multicast, invalid-token cleanup); FCM adapter plus an emulator-only outbox adapter.
- `gcp/functions/src/index.ts`: one additive export line.
- `gcp/functions/src/modules/organizer/{application,infrastructure}`: `updateEventV1` also stores `updatedBy` (editor UID) for the change log; wire contract unchanged.
- `gcp/firestore.rules`: additive `messages` and `subscriptions` blocks before the deny-all rule; devices, pushReceipts and the emulator outbox stay denied.
- `gcp/firestore.indexes.json`: collection-group `events` (status, startTime); `devices.tokenHash` collection-group field override.
- `contracts/v1/models.schema.json` + generated TS/Swift: optional `Event.updatedBy`, `Event.changeLog`; new `EventChangeLogEntry`, `EventFieldChange`, `EventSubscription`, `DeviceRegistration`, `RegisterDevice*`, `UnregisterDevice*`, `PushNotificationData`. Inserted between Event and RSVP only; shared fixture untouched.
- Tests: `gcp/tests/unit/notifications.test.ts`, `gcp/tests/rules/chat-push.test.ts`, `gcp/tests/integration/notifications-triggers.test.ts`, `contracts/tests/notifications.test.mjs`; `test:notifications:integration` script and CI step.
- Docs: `docs/contracts/callables.md`, `docs/contracts/data-ownership.md`, `CURRENT_STATE.md`, `docs/milestones/v2/FEATURE_STATUS.md`.

## Validation

Host: Node v26.7.0 (AGENTS.md asks for 24.12+, package engines say `>=24.12 <25`; npm warned only about blocked install scripts, nothing failed). The machine was heavily loaded (load average ~780) by parallel agents.

- `npm ci`: exit 0.
- `npm run check`: exit 0 (generated drift check, session self-tests, docs links in 141 files, contracts 17/17 including 4 new, functions build, unit 119 tests: 113 pass, 0 fail, 6 pre-existing TODO; 26 new notifications tests pass).
- `npm run test:rules`: 113/113 pass, including 11 new chat/subscription/server-only tests.
- `npm run test:notifications:integration` (new, wired into CI): 6/6 pass. The first attempt failed with "Could not start Firestore Emulator, port taken" (another worktree's emulator on the shared port); the retry passed.
- Regression with the new triggers active: `npm run test:organizer:integration` 6/6, `npm run test:participation:integration` 1/1.
- `npm run generate` then `git diff --exit-code` on generated files: clean (also `generate-contracts.py --check`).
- `npm run test:swift`: exit 0, all four packages (DIPContracts, DIPDesignSystem, DIPAccounts, DIPCore) pass.
- `python3 scripts/check-docs.py`: exit 0. `npm run session:check -- --base origin/main`: run after commit (see PR).
- Not run: Xcode app build (no app code changed), `test:admin:live`, any deploy. The reminder scheduler is not emulated; it is covered by unit tests with a fake clock.

## Decisions

- Device registry via callables, not direct client writes: rules cannot bound the number of documents, compute the token hash reliably, or remove a token from a previous account on a shared phone. The registry is entirely server-only.
- Default subscription by RSVP trigger rather than inside the setRsvpV1 transaction: leaves the participation module and its tests untouched. The trigger reconciles from current RSVP/subscription state in a transaction, so duplicate/out-of-order deliveries converge. Leaving deletes the subscription (missing = none) unless the member changed it after that RSVP write.
- Chat cutoff: writable while scheduled and until 24 h after endTime; history stays readable for going participants. Clients must send trimmed text (rules compare `text == text.trim()`). Author display fields are validated against `users/{uid}` (current profile), not snapshotted.
- Chat pushes require a current going RSVP even for `all` subscribers, so previews never reach people who cannot read the chat.
- Change log `from`/`to` are display strings (generator has no union types); long text truncated to 200 chars to keep 50 entries far under 1 MiB. Push bodies name changed areas without values (no timezone context server-side).
- Exactly-once claims via create-only `pushReceipts/{key}` docs (chat per message, reminders per window+startTime); changes de-duplicated by changeLog revision+changes. Pushes are at most once (claim before send).
- Reminder windows (20 h, 24 h] and (0, 60 min]; a scheduler outage longer than 4 h skips that 24 h reminder.
- FCM registration-token multicast is deprecated in firebase-admin 14 in favour of Installation IDs; kept because FirebaseMessaging on iOS provides tokens. Revisit before the next admin major.

## Handoff

- Owner to confirm the level semantics, the 24 h post-event chat window and whether organizers who are not going should read/moderate chat.
- Deployment (rules, indexes, functions incl. Cloud Scheduler) is a separate authorized step; real pushes need the APNs key from the paid Apple Developer team and iOS push entitlements. Optionally enable a TTL policy on `pushReceipts.expireAt`. Confirm the Firestore trigger region matches the database location before deploying.
- iOS: FirebaseMessaging integration, permission prompt, `registerDeviceV1` on token refresh, `unregisterDeviceV1` before sign-out, chat repository (clientMessageId as doc ID, serverTimestamp), preference UI, routing on push `type`/`eventId` (the `dip` URL scheme is not registered).
- Shared-file merge notes: `gcp/functions/src/index.ts` and `gcp/firestore.rules` edits are additive blocks; schema edits are confined to Event and new types.
