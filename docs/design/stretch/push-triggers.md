# Push notifications: triggers and category settings (stretch S4)

Status: implemented in code, not deployed, device-unverified (see the [runbook](../../ops/push-apns-runbook.md)). Builds on the existing, device-unverified push pipeline ([push client](../push-client.md)). Part of the [V2 stretch goals](../../milestones/v2/STRETCH_GOALS.md). This document owns the **notification category and preference model** that [email](email.md) reuses.

## Implementation status

| Item | State |
| --- | --- |
| PUSH-1 Category registry and preferences | Merged (#228) |
| PUSH-2, PUSH-5, PUSH-6 Router, APNs payload polish, token hygiene | #229 |
| PUSH-3, PUSH-4, PUSH-7 Trigger migration, new triggers, iOS settings | Follow-up PR |
| Email channel in the router | Wired (`routerDependencies` adds `routerEmailChannel(emailChannelDependencies())`; triggers pass `request.email` for event change and cancel, reminder, invite, invite answered, attendee added and challenge reviewed; chat and weekly theme send none). No email goes out until `EMAIL_ENABLED` is set and a company is enabled |
| PUSH-8 Invite action buttons | Optional, not started (see Work breakdown) |
| PUSH-9 Device verification | Blocked on the APNs key (owner); script in the [runbook](../../ops/push-apns-runbook.md) |

## Decisions (assumptions while owner questions are open)

- Defaults follow the recommendation: social and discovery off, the rest on.
- Reminder emails default off.
- An answered invite notifies the sender on accept only; declines are silent.
- Weekly theme push runs Monday 09:00 America/New_York until a company time zone exists.
- Keep the 15-minute reminder poll (about 1 hour precision).
- No quiet hours in V2.
- Caps: 20 pushes per hour and 100 per day per member.
- In-app notices are not governed by push switches.
- Reminders now also create an in-app notice in router mode.
- The `event_interest` trigger is deferred.
- `PUSH_ROUTER_ENABLED` defaults to true; false rolls back to the legacy path.

## Goal and user stories

Members get pushes for things that today only show up when the app is open, honor the per-activity reminder level already in the activity chat, and can switch categories on or off in profile settings.

- As a member, I get a push when an activity I joined is about to start, when a coworker invites me, when an event I joined changes or is canceled, and when an admin adds me.
- As a member, the per-activity level (All, Changes, Reminders, None) still controls chat, change and reminder pushes for that activity.
- As a member, Profile > Notifications lets me turn whole categories off, and shows a clear "Notifications are off in iOS Settings" row with a shortcut when the system permission is denied.
- As an admin, I know a push never contains more than a title and a short snippet.

## Current state (findings)

Backend (`gcp/functions/src/modules/notifications`, nothing deployed):

- `registerDeviceV1` / `unregisterDeviceV1` keep a server-only token registry (`users/{uid}/devices`).
- `sendPush` (`application/sendPush.ts`) multicasts in batches of 500 and deletes tokens FCM reports as unregistered or invalid.
- Triggers: `onEventMessageCreated` (chat), `onEventChanged` (changes), `onRsvpChanged` (creates the default per-event level), `sendEventReminders` (`onSchedule` every 15 minutes, windows 24 h and 1 h, exactly-once receipts, `domain/reminders.ts`). Invitations push from `modules/invites/infrastructure/invitePushNotifier.ts` and also write an in-app notice to `users/{uid}/notifications`.
- Per-event level: `companies/{c}/events/{e}/subscriptions/{uid}` with `all | changes | reminders | none` (`domain/subscription.ts`); chat needs `all`, changes need `all` or `changes`, reminders need any but `none`.
- APNs mapping (`infrastructure/messaging.ts`): `apns-collapse-id`, `thread-id`, default sound. No `apns-expiration`, no `interruption-level`, no badge, no category.

iOS (`ui/DIP`):

- `PushFeature` flag (off by default), `PushRegistrar`, permission priming after the first accepted RSVP, deep links through `DIPShareLink` and `EventLinkInbox` ([push client](../push-client.md)).
- The level menu lives in the activity chat (`ui/DIP/Features/Chat/DIPActivityChatScreen.swift`, `DIPNotificationLevel`). There is **no profile-level notification settings** yet.
- The notifications center (`ui/DIP/Features/Notifications/DIPNotificationsScreen.swift`) already shows in-app kinds: invite, event_updated, event_cancelled, reminder, challenge_approved, challenge_changes_requested, attendee_added, comment, photo (`ui/Packages/DIPCore/Sources/DIPCore/DIPNotifications.swift`) and a permission banner (turn on / open Settings).
- Project board already tracks "Push notifications: enable and verify" and "[Blocked] Push delivery on a real device" (prerequisites: paid Apple team, APNs key). This stretch item does not duplicate them; it starts after them.

Conclusion: "activity soon" and "invited" pushes exist server-side but are unverified and flag-off. The new work is the category preference model, a few more triggers, payload polish, and the settings UI.

## Categories (canonical registry)

One registry shared by push, email and the in-app center. Stored in code (`gcp/functions/src/modules/notifications/domain/categories.ts`) and mirrored in iOS (`DIPCore`).

| Category id | Examples | Per-event level gates it? | Push default | Email default (see email doc) |
| --- | --- | --- | --- | --- |
| `invites` | Coworker invited you; your invite was accepted or declined | no | on | on |
| `event_updates` | Time or venue changed, event canceled, an admin added you | yes (`changes`) | on | on |
| `reminders` | Starts in about 24 h, starts in about 1 h | yes (`reminders`) | on | off (open question 2) |
| `chat` | New message in an activity chat | yes (`all`) | on | not offered |
| `challenges` | Submission approved or changes requested; new weekly theme | no | on | on |
| `social` | Comment or photo on your photos or albums | no | off | off |
| `discovery` | New event matching your interests (weekly digest at most) | no | off | off |

Precedence for one candidate notification of category C to member M: (1) category C enabled in M's preferences for the channel; (2) for event-scoped categories, the per-event level allows it; (3) a device token exists and the system permission was granted (push) or a deliverable email exists (email). All three must pass. The per-event level stays authoritative for event-scoped kinds, so existing behavior does not change when preferences are absent.

## Triggers

| Trigger | Status | Source | Notes |
| --- | --- | --- | --- |
| Starting soon (24 h, 1 h) | exists | `sendEventReminders` | Keep the 15-minute poll. Add `apns-expiration` = event start so a late push is dropped |
| Invited | exists | `sendInviteV1` notifier | Add invite accepted or declined to the sender |
| Event changed / canceled | exists | `onEventChanged` | Cancel push uses `event_updates` and a stronger copy |
| Added by an admin | new | `addEventAttendeeV1` | In-app `attendee_added` exists; add the push |
| Challenge approved or changes requested | new push | submission review callables | In-app kinds exist |
| Weekly theme started | new | `onSchedule` Monday 9:00 company time | Needs company time zone (open question 3) |
| Event interest match | new, later | `onEventCreated` + user interests | Weekly digest only, off by default |
| Calendar conflict | not a server trigger | on device | See [calendar](calendar.md); server never learns the calendar |

### Event-soon scheduling choice

Compared (sources below): Cloud Scheduler polling versus Cloud Tasks scheduled tasks. A scheduled task per event gives exact timing but needs create, delete and re-create on every edit, and a deleted or run task name cannot be reused for up to 24 hours, so names must embed the start time. Polling costs one Scheduler job (3 free per account, then $0.10 per month) and has no per-event cancel bookkeeping. **Recommendation: keep polling.** The existing windows tolerate a 4 h outage; if "about 1 hour" feels loose, tighten the schedule to every 5 minutes (still one job, a bounded `startTime` range query). Move to Cloud Tasks only if the owner needs exact-minute reminders (open question 4).

### Payload polish per category

Use the APNs fields FCM passes through the `apns` override: `apns-collapse-id` (already used), `apns-expiration`, `apns-priority: 10` for alerts, `thread-id` per event (already), `aps.category` for actionable invites, `aps.interruption-level` `active` (default). **Do not use `time-sensitive`** unless the Time Sensitive Notifications capability is added (UNVERIFIED Apple pages did not render, see sources). Never use data-only background pushes for these; they are throttled and need priority 5.

Tokens, not topics: FCM topics suit public broadcast, have no per-user control, and per-category preferences would need subscribe calls on every toggle ([topic messaging](https://firebase.google.com/docs/cloud-messaging/topic-messaging)). Keep per-device tokens with server-side preference checks.

## Data model and contract changes

`users/{uid}/settings/notifications` (single doc, client-owned fields only):

```json
{
  "contractVersion": 1,
  "push":  { "invites": true, "event_updates": true, "reminders": true, "chat": true, "challenges": true, "social": false, "discovery": false },
  "email": { "invites": true, "event_updates": true, "reminders": false, "challenges": true },
  "updatedAt": "<server timestamp>"
}
```

- Rules: own document only, `hasOnly` the keys above, booleans only, `updatedAt` equal to `request.time`. This matches how per-event levels and profile fields are written (direct, rules-validated), so no new callable is needed. A missing document means the registry defaults, evaluated server-side (so default changes need no migration).
- Server code reads it through a `PreferencesPort` with a short per-invocation cache.
- Router: `deliverNotification({uid, category, eventId?, payload})` in `modules/notifications/application/router.ts` writes the in-app notice, then applies the precedence rules and fans out to push (and, later, the email outbox). Existing triggers are migrated onto it one at a time.
- Contract: additive (`NotificationPreferences` schema; no existing type changes). Adding a category later is additive; renaming one is a breaking wire change and needs a new version plus migration.
- Token hygiene: add `lastSeenAt` on each device doc (updated by `registerDeviceV1`), a daily prune of tokens older than 60 days, and treat `UNREGISTERED` as delete (existing). FCM guidance is to refresh tokens at least monthly and prune stale ones ([manage tokens](https://firebase.google.com/docs/cloud-messaging/manage-tokens)).

## iOS design

- New Profile > Notifications screen (reached from Profile and from the permission banner): master "Push notifications" row showing the iOS state (on, off with "Open iOS Settings", not asked with "Turn on"), then one toggle per category with a one-line description. The "Per-activity settings" row explains that each activity's bell overrides chat, change and reminder alerts. Uses the design system components (`DIPToggleRow` style; confirm component names in `docs/design/components.md`), tinted info cards per the locked decisions.
- Open iOS Settings via `UIApplication.openNotificationSettingsURLString` (iOS 15.4+) with `openSettingsURLString` as fallback (UNVERIFIED, Apple page did not render).
- Actions on invite pushes (Accept, Decline) through a `UNNotificationCategory` are optional and out of the first cut ([push client](../push-client.md) lists categories as not covered). They need a background handler that calls `respondToInviteV1` and App Check in a short-lived launch.
- Badge: optional later. The server would send the unread in-app count as `aps.badge`; keep it out until the center's unread count is trustworthy on device.
- Copy never includes private data beyond title and a snippet; chat keeps its existing 80-character cap.

## Security and privacy

- Tenant isolation: every trigger reads the company from the event or member document and only addresses members of that company. Recipients are derived server-side, never from payloads.
- App Check on callables stays on; new triggers have no client entry points. Preferences writes are rules-validated, own-document only.
- No message text, names or emails in logs; log counts and ids only. No health or sensitive categories are inferred from interests in pushes.
- Consent: the OS permission is the consent for push; the in-app priming remains. Privacy policy gains a short "Notification preferences" line (see Privacy updates in [calendar](calendar.md) and [email](email.md) for the combined policy edit).
- Rate: a per-member cap (for example 20 pushes per hour, 100 per day) in the router, with collapse ids, prevents a runaway trigger from flooding a phone.

## Testing plan

- Unit: precedence matrix (category x per-event level x token x permission), defaults, router fan-out, payload mapping including `apns-expiration`.
- Emulator integration (`npm run test:notifications:integration`): reuse `EmulatorOutboxMessaging`; add per-category cases, preferences rules tests (own only, key allow-list, other tenant), attendee-added and challenge pushes.
- iOS: pure tests for the preference view model and registry mirror; UI test for the settings screen with a fake permission provider; extend the device checklist in [push client](../push-client.md) with one row per new category.
- Device: two phones as in the existing checklist. Pending until the APNs key and paid team exist.

## Rollout and flags

Keep `DIP_PUSH_ENABLED`. Server: `PUSH_ROUTER_ENABLED` param so migrated triggers can fall back to the old path. Ship categories behind the existing flag; no data migration (missing doc equals defaults). Rollback: flip the param.

## Risks

Notification fatigue (defaults and caps); APNs key and paid team still blocking; double-sending during the router migration (mitigate with receipts keyed by notification id); `time-sensitive` expectations (not offered).

## Open questions for the owner

1. Confirm the category list and which are on by default.
2. Reminder emails default off (push covers it) or on? Owner asked for reminder emails, so on may be right for users without push.
3. Company time zone: is there a field? None was found in the contracts; the weekly-theme push and quiet hours need one.
4. Is "about 1 hour" precision acceptable (15-minute poll), or exact-minute reminders?
5. Quiet hours (do not disturb window) in V2 or later?
6. Should an invite accepted or declined notify the sender?

## Work breakdown

| ID | Title | Scope | Acceptance | Est | Area | Depends |
| --- | --- | --- | --- | --- | --- | --- |
| PUSH-1 | Category registry and preferences contract | Registry module (TS and Swift mirror), `NotificationPreferences` schema, rules for `users/{uid}/settings/notifications`, regenerate | Rules tests: own doc only, key allow-list, other tenant denied; defaults documented; `npm run check:generated` clean | M | backend | none |
| PUSH-2 | Delivery router | `deliverNotification` applies precedence, writes the in-app notice, fans out to push; rate caps and receipts | Unit matrix passes; replayed notification id sends once; caps enforced | M | backend | PUSH-1 |
| PUSH-3 | Migrate existing triggers | Chat, change, reminder and invite pushes call the router behind `PUSH_ROUTER_ENABLED` | Existing integration tests still pass with the flag on and off; no duplicate pushes | M | backend | PUSH-2 |
| PUSH-4 | New triggers | Admin-added, invite answered, challenge reviewed, weekly theme start pushes | Emulator tests assert recipients, copy, deep link and category per trigger | M | backend | PUSH-2 |
| PUSH-5 | APNs payload polish | `apns-expiration`, priority 10, optional `aps.category`; per-category mapping in `messaging.ts` | Unit tests on the produced multicast message; stale reminder is dropped after start | S | backend | PUSH-2 |
| PUSH-6 | Device token hygiene | `lastSeenAt` on register, daily prune job, metrics log | Emulator test prunes stale tokens only; live tokens untouched | S | backend | none |
| PUSH-7 | Profile notification settings | Settings screen, view model, repository adapter, iOS Settings shortcut, permission state row | Pure tests for the view model; UI test with fake permission; toggles persist and reload | L | ios | PUSH-1 |
| PUSH-8 | Invite action buttons (optional) | `UNNotificationCategory` with Accept and Decline calling `respondToInviteV1` | Device test: action works from lock screen; failure shows a recoverable state | M | ios | PUSH-4 |
| PUSH-9 | Device verification and docs | Run the extended checklist on two phones, update push client doc and CURRENT_STATE | Results recorded in a session log with build, devices, pass or fail per row | M | infra | PUSH-3, PUSH-7 |

## Sources

- FCM topic messaging limits and intent: https://firebase.google.com/docs/cloud-messaging/topic-messaging
- Send with the Admin SDK (`sendEach`, 500): https://firebase.google.com/docs/cloud-messaging/send/admin-sdk
- Manage tokens (pruning, staleness): https://firebase.google.com/docs/cloud-messaging/manage-tokens
- Message priority on Apple: https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-priority
- ApnsConfig reference: https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging.apnsconfig
- Cloud Tasks quotas (30 day schedule, name reuse): https://docs.cloud.google.com/tasks/docs/quotas
- Task queue functions: https://firebase.google.com/docs/functions/task-functions
- Scheduled functions and pricing: https://firebase.google.com/docs/functions/schedule-functions
- Not verified (Apple pages returned titles only): `apns-collapse-id`, `apns-expiration`, `interruption-level`, `UNNotificationCategory`, `openNotificationSettingsURLString`. Confirm at build time against https://developer.apple.com/documentation/usernotifications.
