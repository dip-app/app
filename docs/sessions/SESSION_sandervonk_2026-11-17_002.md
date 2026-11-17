# Work session

User: sandervonk
Date: 2026-11-17
Workstream: stretch-push
Agent: Claude (Opus lead, Sonnet subagents)
Status: handoff

## Summary

Stretch S4 (#204), PR 2: delivery router (PUSH-2, #206), APNs payload polish (PUSH-5, #209) and device token hygiene (PUSH-6, #210). The router is not wired to triggers yet (PUSH-3 next).

## Changes

- Router: `gcp/functions/src/modules/notifications/application/{router,routerPorts}.ts`, `domain/rateLimit.ts`, `infrastructure/firestoreDelivery.ts` (`notificationReceipts/{sha256(companyId/id)}`, `pushRateLimits/{uid}`), `application/sendPush.ts` split into `sendToDevices` plus the `sendPush` wrapper.
- Payload: `domain/push.ts` (category in data, reminder expiry at start, change expiry at end), `infrastructure/messaging.ts` (`apns-priority: 10`, `apns-push-type: alert`, `apns-expiration`, `interruption-level: active`, optional `aps.category`; emulator outbox records them).
- Tokens: `lastSeenAt` on register, `application/pruneDevices.ts`, scheduled `pruneStaleDeviceTokens` (daily 03:30 UTC, 60 days), collection-group index override `devices.lastSeenAt`.
- Contract: `PushNotificationData` additive kinds, `category`, ids, challenge deep links, `eventId` optional; `DeviceRegistration.lastSeenAt`.
- Docs: `docs/design/push-client.md`, `docs/contracts/data-ownership.md`.

## Validation

- `tsc --noEmit` clean; unit `tests/unit/notificationRouter.test.ts`, `tests/unit/notificationPreferences.test.ts`, `gcp/tests/unit/notifications.test.ts` 81/81.
- Firestore emulator: `gcp/tests/integration/notifications-delivery-store.test.ts` 4/4 (10 parallel claims, one wins; 30 parallel admits, 20 admitted), `gcp/tests/integration/notifications-prune.test.ts` 1/1.
- `npm run check:generated`, `npm run test:contracts` 42/42.

## Decisions

- Rate caps 20 per hour and 100 per day per member across all categories; a blocked push still gets its in-app notice.
- Delivery is at most once per notification id (receipt claimed before sending), like the existing push receipts.
- In-app notices are not governed by push switches.
- Prune uses `lastSeenAt` only; nothing is deployed, so there are no legacy rows without it.

## Handoff

- Deploy notes: TTL policies on `notificationReceipts.expireAt` and `pushRateLimits.expireAt`; index override `devices.lastSeenAt`; new scheduled function `pruneStaleDeviceTokens`. Nothing deployed.
- Next: PUSH-3 trigger migration behind `PUSH_ROUTER_ENABLED`, PUSH-4 new triggers.
