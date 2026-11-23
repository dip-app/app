# Work session

User: sandervonk
Date: 2026-11-22
Workstream: push-actions
Agent: Claude (Opus), push quick actions area owner
Status: handoff

## Summary

Owner request: "accept and decline and similar actions for all other actionable notifications are also needed." Audited every push kind and added quick actions: every push carries an `aps.category` (server, additive, payload text and data byte-identical) and the iOS app registers six categories with localized (en, es) actions: Open and Can't make it (organizer add, activity change), Directions and Can't make it (reminders), text Reply (chat, photo comment), Open (look-only pushes), plus the existing invite Accept and Decline. Email one-tap actions are designed and deferred. Nothing deployed, nothing verified on a device.

## Changes

- `gcp/functions/src/modules/notifications/domain/push.ts`: `APNS_CATEGORIES`; every builder sets `apnsCategory`; `changePush` takes a trailing `cancelled` flag (cancelled pushes get `DIP_OPEN`).
- `gcp/functions/src/modules/notifications/application/handlers.ts`: passes `cancelled` on the legacy and router change paths.
- Tests: new `gcp/functions/tests/unit/notificationQuickActions.test.ts` (category, English copy and data pinned per kind); router test asserts categories; `gcp/tests/unit/notifications.test.ts` updated for the reminder category.
- iOS: `ui/DIP/Domain/Push/PushNotificationActions.swift` (categories, action ids, `PushQuickActionResponder`, `PushMemberActions` seam), `PushCoordinator.swift` (dispatch and fallbacks), `PushRegistration.swift` (`postActionFallback`, `openExternal`), `ui/DIP/Data/Push/FirebasePush.swift` (category registration, fallback texts, text input), new `ui/DIP/Data/Push/FirebasePushMemberActions.swift`, `ui/DIP/Support/FirebaseBootstrap.swift` (`makePushMemberActions`), String Catalog keys `push.action.*`, `push.leave.fallback.*`, `push.reply.fallback.*` (en, es).
- iOS tests: new `ui/DIPTests/Push/PushQuickActionTests.swift`; `PushRegistrarTests.FakeSystem` follows the protocol.
- Docs: `docs/design/push-catalog.md` (Quick actions table, email action design), `docs/design/push-client.md`, `docs/ops/push-device-verification.md` rows 40 to 52, `CURRENT_STATE.md`.

## Validation

- `node --import tsx --test` on the notification unit tests (notificationQuickActions, notificationTriggersRouter, notificationSocial, notificationRouter, notificationPreferences, gcp/tests/unit/notifications, push-i18n): 171 pass, 0 fail.
- `npx tsc --noEmit -p gcp/functions`: clean. `npm run check:backend-i18n`: OK. `npm run check:generated`: OK.
- `xcodebuild build-for-testing` (iOS Simulator) then `test-without-building` on iPhone 17e (iOS 27.2) with `-only-testing` PushQuickActionTests, PushNotificationActionTests, PushRegistrarTests: 47 tests, 0 failures.
- `npm run ios:i18n-sync` from that build, Spanish filled, `npm run check:ios-i18n`: OK.
- No full suites (owner rule); no Swift package touched, so no package `swift test`.
- The existing invite test `testASecondPressWhileTheFirstIsRunningIsIgnored` hung on iOS 27.2 (a `Task.yield()` spin on the main actor); it and the new leave test now wait on an explicit start signal.
- Not verifiable here: real remote pushes with actions (the simulator build has the push flag off, so the categories are never registered there; no screenshot). Device rows 40 to 52 are not run.

## Decisions

- At most two actions per category; Open only where it is the only choice or next to a destructive one; data-changing actions need an unlocked device; leaving is destructive.
- Reply ids are `push-` plus 40 hex of SHA-256(notification id, text) so a repeated delivery writes one document.
- Reply author comes from the member's own `users/{uid}` profile, which must belong to the push company.
- Skipped: Add to calendar on reminders, Still going, Rejoin after removal, actions on challenge pushes beyond Open.
- Email Accept, Decline and Can't make it links deferred: they need a public function, a Hosting rewrite in firebase.json and template changes owned by the email workstream, and an owner decision on the forwarded-email risk. Design recorded in the push catalog.

## Handoff

Deploy functions and ship an app build after 0.1.2, then run device rows 40 to 52 on two iPhones. Spanish action titles need native review with the rest of the catalog. Build the email action endpoint from the design in the push catalog once the owner accepts the forwarding risk.
