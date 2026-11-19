# Work session

User: sandervonk
Date: 2026-11-19
Workstream: push-triggers
Agent: Claude
Status: handoff

## Summary

Audited every push against the push triggers design (#204) and wrote the push catalog matrix. Built the missing valuable triggers through the existing router: an admin-removed-you push, a comment-on-your-photo push and a new-photo-in-an-album push (the last two in the `social` category, default off). Added the PUSH-8 server payload (invite action category id), a per-delivery log line for device verification, and a phone verification guide. Nothing is deployed and nothing ran on a device.

## Changes

- `gcp/functions/src/modules/notifications`: kinds `attendee_removed`, `photo_comment`, `photo_added` in the registry; `social` rate class (10 per hour, 40 per day); push builders and en/es catalog keys; `application/socialTriggers.ts`, `infrastructure/firestoreAlbum.ts`, `transport/socialTriggers.ts` (functions `onPhotoCommentPush`, `onPhotoAddedPush`, exported in `src/index.ts`); `RoutedPushNotifier.attendeeRemoved`; router logs `notification delivered`; invite pushes carry `apnsCategory` `DIP_INVITE`.
- `modules/admin/application/attendees.ts` and `ports.ts`: `removeEventAttendeeV1` pushes after commit when notify is set (optional port method, best effort, replay safe).
- `contracts/v1/models.schema.json` (additive: push data types, `photoId`, `commentId`) and regenerated TypeScript and Swift models.
- Docs: `docs/design/push-catalog.md`, `docs/ops/push-device-verification.md`, updates to push-triggers, notification-preferences, push-client, data-ownership, the APNs runbook, CURRENT_STATE and STRETCH_GOALS.
- Tests: `gcp/functions/tests/unit/notificationSocial.test.ts` (new), pins in `notificationPreferences.test.ts` and `notificationRouter.test.ts`, removal push tests in `gcp/tests/unit/admin-events.test.ts`.

## Validation

Targeted only: `tsc --noEmit` in gcp/functions (clean); node tests for notification*, notifications*, push-i18n, email-*, photos, admin-*, invites* (670 passed, 0 failed); `npm run check:backend-i18n` (push 38 keys, en and es match); `npm run check:generated` clean; `python3 scripts/check-docs.py` clean. Not run: the rules emulator (rules unchanged), the emulator integration tests, Swift tests, the whole suite. No eslint config exists in this repository.

## Decisions

- No new preference category: `social` already exists in the contract, rules and iOS mirror, so photo kinds reuse it and no migration is needed. Points awarded was deferred because it would need a new category for little value.
- Photo comments notify only the uploader (there is no reply or thread model). New-photo pushes dedupe per uploader, activity and UTC hour so an upload burst is one push.
- Social has its own small cap bucket so an opt-in category cannot use up the shared budget.
- Deferred: event interest digest, theme ending soon, iOS invite action buttons and the iOS settings copy for Comments and photos.
- The admin portal Your settings page has language only; the web portal has no push channel, so no push settings were added there.

## Handoff

Owner steps: follow `docs/ops/push-apns-runbook.md` sections 1 and 2 (APNs key, deploy, never from an agent), then `docs/ops/push-device-verification.md` on two phones and record results in a session log. The deploy now includes two new Firestore triggers (`onPhotoCommentPush`, `onPhotoAddedPush`). iOS follow-ups are listed in `docs/design/push-catalog.md`. Remaining: iOS DIP_INVITE category and actions (PUSH-8), copy change for the Comments and photos row, rendering comment and photo_added notices in the center, optional emulator integration tests for the new triggers, event interest and theme-ending pushes.
