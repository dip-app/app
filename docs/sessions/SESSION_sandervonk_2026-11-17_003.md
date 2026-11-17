# Work session

User: sandervonk
Date: 2026-11-17
Workstream: stretch-push
Agent: Claude (Opus lead, Sonnet subagents)
Status: handoff

## Summary

Stretch S4 (#204), PR 3: trigger migration onto the router (PUSH-3, #207), new triggers (PUSH-4, #208), Profile > Notifications settings on iOS (PUSH-7, #211), APNs runbook and device test script (PUSH-9 prep, #213).

## Changes

- PUSH-3: `notifications/application/handlers.ts` router-mode chat, change and reminder handlers; `transport/notificationFunctions.ts` picks router or legacy by `PUSH_ROUTER_ENABLED` (`transport/routerDeps.ts`, default on); `subscribersWithLevels` in the store; invite notifier routes `invite` without a second in-app notice.
- PUSH-4: builders in `domain/push.ts`; `application/newTriggers.ts`, `transport/routedPush.ts`, `transport/routedTriggers.ts` (`sendWeeklyThemePushes`), `infrastructure/firestoreThemes.ts`; hooks after commit in `admin/application/attendees.ts`, `invites/application/respondToInvite.ts`, `submissions/application/submissionCommands.ts`; index `challenges (type, startDate)` collection group.
- PUSH-7: DIPCore `DIPNotificationPreferencesRepository`, `DIPMockNotificationPreferencesRepository`, `DIPNotificationSettingsModel`; app `FirebaseNotificationPreferencesRepository` (merge write of the push map), `DIPNotificationSettingsScreen`, Profile row and banner link behind the push flag, `invite_answered` in-app kind, UI tests.
- Docs: `docs/ops/push-apns-runbook.md`, `docs/design/stretch/push-triggers.md` status and Decisions, `docs/design/push-client.md`, STRETCH_GOALS row.

## Validation

- `tsc --noEmit`; unit notification, invites, challenge-submissions and admin-events tests 174/174.
- Emulator (subagents, temporary port config): `notifications-triggers.test.ts` 7/7 with the router on and 7/7 with `PUSH_ROUTER_ENABLED=false`; `notifications-new-triggers.test.ts` 4/4; `invites-callable`, `challenge-submissions-callable` pass. `admin-adapter.test.ts` not run locally (fixed ports busy).
- `npm run check:generated`, `npm run test:contracts` 42/42, `npm run test:docs`.
- iOS: `swift test --package-path ui/Packages/DIPCore --filter DIPNotificationSettingsModelTests` 15/15; `xcodebuild test -only-testing:DIPUITests/NotificationSettingsUITests` 3/3; design audit PASS on round 2 (screenshots in the session scratchpad, not committed).

## Decisions

- Invite answered notifies the sender on accept only; declines are silent.
- Weekly theme push Monday 09:00 America/New_York until a company time zone exists.
- Router mode also writes in-app reminder notices.
- iOS saves only the push map with a merge write, so a server-side email opt-out is never overwritten.
- PUSH-8 (invite action buttons) deferred: optional and needs device verification.

## Handoff

- Owner: upload the APNs key and run the device script in `docs/ops/push-apns-runbook.md` (PUSH-9).
- Coordinator: deploy notes in the runbook section 2 (rules, two indexes, TTL policies, functions, `PUSH_ROUTER_ENABLED`). Nothing deployed.
- Email lead: router hook for EML-8 is marked in `application/router.ts`; EML-9 adds a section to `DIPNotificationSettingsModel.Section`.
