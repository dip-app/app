# Work session

User: sandervonk
Date: 2026-11-17
Workstream: backend-quality-audit
Agent: Claude Sonnet (audit fixer)
Status: completed

## Summary

Fixed the verified audit findings in the push notification router: per-class rate limits, two-phase delivery receipts, logged failures, redelivery of event-change triggers, reminder isolation, bounded-parallel email, send-time membership check, a legacy-path warning and explicit function limits.

## Changes

- `gcp/functions/src/modules/notifications/domain/rateLimit.ts`: rate classes (shared, chat, changes, exempt); chat 30/h 200/day, event_changed 60/h 300/day, event_cancelled and reminder exempt; optional `buckets` map keeps old documents valid.
- `application/routerPorts.ts`, `infrastructure/firestoreDelivery.ts`: receipts gain `complete` and `isDone`; claim is a 5-minute lease (`state: processing`, `leaseUntil`), `done` after sending, receipts without `state` count as done, TTL field `expireAt` unchanged; new `MembershipReader` (`FirestoreMembership`, batched getAll) and `DeliveryLog` ports.
- `application/router.ts`: membership filter (`blocked.inactive`), receipt completion, `inProgress` flag, in-app and email failures logged, email in chunks of 20, rate class passed to the limiter.
- `application/sendPush.ts`: aggregated FCM error codes logged (error severity when every send fails, credential codes called out); batch exceptions logged; no tokens or text.
- `application/handlers.ts`: change trigger reaches the router when the changeLog entry already exists; reminders catch per event, log, count `failed`, and pre-check the receipt.
- `application/devices.ts`, `domain/errors.ts`, `ports.ts`, store: `registerDeviceV1` refuses deactivated users (`ACCOUNT_DEACTIVATED`).
- `transport/notificationFunctions.ts`, `routedTriggers.ts`, `routerDeps.ts`: timeout, memory and maxInstances on every function; `retry: true` on chat, event change and RSVP triggers; in-progress and failed reminders throw so the platform retries; one-time legacy-path warning; router wired with members and logger.
- Tests: `gcp/functions/tests/unit/notificationRouter.test.ts`, `notificationTriggersRouter.test.ts`, `gcp/tests/unit/notifications.test.ts`, `notificationEmailPayloads.test.ts`, `gcp/tests/integration/notifications-delivery-store.test.ts`.
- Docs: `docs/ops/push-apns-runbook.md`, `docs/design/stretch/push-triggers.md`, `docs/design/stretch/notification-preferences.md`.

## Validation

- `cd gcp/functions && node --import tsx --test tests/unit/notificationRouter.test.ts tests/unit/notificationTriggersRouter.test.ts tests/unit/notificationPreferences.test.ts ../tests/unit/notifications.test.ts ../tests/unit/notificationEmailPayloads.test.ts ../tests/unit/email-router-channel.test.ts ../tests/unit/notifications-new-triggers.test.ts`: passing.
- `npm run build`: passing.
- `npm run test:notifications:integration`: not run to completion; the Firestore emulator port was already in use on this machine. The new integration test for lease semantics is therefore unexecuted.

## Decisions

- event_changed gets a separate generous bucket rather than an exemption; cancellations and reminders are exempt.
- A redelivery inside the lease throws `DELIVERY_IN_PROGRESS` in the Firestore triggers so `retry: true` retries after expiry.
- `retry: true` enabled on chat, event change and RSVP triggers because receipts, revision-keyed changeLog and reconcile make them idempotent. A deterministic failure retries until the platform gives up (up to 7 days); documented in the runbook.
- Membership read failure fails closed (throws).
- Weekly theme schedule left as is (fixed Monday 09:00 America/New_York).

## Handoff

- Run the emulator integration test once the port is free.
- Reminder missing-subscriber queries, indexes and firestore.rules unchanged; no new index required.
- Legacy path (`PUSH_ROUTER_ENABLED=false`) still bypasses preferences by design; it now warns once per cold start.
