# Push client (device-unverified)

Status: built, behind a feature flag (off), unit-tested with fakes. **Not tested on a device**: real delivery needs the paid Apple Developer team's APNs key (uploaded to Firebase) and the `aps-environment` entitlement. Enablement is prepared: one `#include "Push.xcconfig"` line (below).

## What the client does

- **Flag.** `PushFeature.isEnabled` is true only when Info.plist `DIPPushEnabled` is `YES` (build setting `DIP_PUSH_ENABLED`, default `NO` in `ui/Config/Base.xcconfig`) or the app is launched with `--push-enabled`. With the flag off, no push code runs: no permission prompt, no registration, no delegates.
- **Registration.** `PushRegistrar` registers the device through `registerDeviceV1` (`{contractVersion: 1, token, platform: "ios", appVersion}`) when a member session is ready and notifications are already authorized, again when FCM refreshes the token, and calls `unregisterDeviceV1` before sign-out (best effort, never blocks sign-out). A token already registered is not sent twice; failures are retried at the next launch or token refresh.
- **Permission priming.** Never at launch. After the member's first accepted RSVP, once, and only while the system status is undetermined, the app shows its own dialog ("Get updates for activities you join?"). "Turn on notifications" shows the system prompt; "Not now" is remembered and never asked again (Settings still works).
- **Deep links.** A tapped notification carries `deepLink` (`dip://events/{id}` or `dip://events/{id}/chat`, written by the notifications module). It goes through the same `DIPShareLink` parser and `EventLinkInbox` as share links, so the shell opens the event; `/chat` also opens the chat when the member is going and the event is not over. A push without a usable `deepLink` opens `dip://events/{eventId}`; the `type` is never needed to route, so new or unknown types still open.
- **Member language.** Not push code, but it decides push copy: the app sends its language through `setMyLocaleV1` when it differs from the profile (see [backend-i18n](backend-i18n.md)).
- **Notification settings.** The per-event All / Changes / Reminders / None menu in the chat screen (bell, top left) is the setting; there is no separate settings page.

## To make it work on a device (enablement)

The whole client switch is one line. In the untracked `ui/Config/Local.xcconfig` add:

```
#include "Push.xcconfig"
```

`ui/Config/Push.xcconfig` sets `DIP_PUSH_ENABLED = YES` and selects `Config/DIP-Paid-Push.entitlements` (the paid-team entitlements plus `aps-environment`). Remove the line to turn push off; the committed default stays `DIP_PUSH_ENABLED = NO` in `ui/Config/Base.xcconfig`. Use the include instead of the `DIP_ENTITLEMENTS` line for share links, because the push entitlements file also carries `applinks:letsdip.work`. Prerequisites, in order:

1. **(owner)** Join the paid Apple Developer team; enable Push Notifications for the App ID `work.letsdip.app`.
2. **(owner)** Create an APNs authentication key (.p8, Keys, Apple Push Notifications service) and upload it in the Firebase console: Project settings, Cloud Messaging, Apple app configuration, APNs Authentication Key (with the Key ID and Team ID). Keep the .p8 out of the repository.
3. Set the bundle ID and team in `Local.xcconfig`; add the `#include` line above; regenerate the project and build to a physical device (the simulator cannot receive real APNs pushes).
4. Make sure the notification functions are deployed (`registerDeviceV1`, `unregisterDeviceV1`, `onEventMessageCreated`, `onEventChanged`, `onRsvpChanged`, `sendEventReminders`, and for invitations `sendInviteV1`) with `firebase deploy --only functions --force` as described in the [deploy runbook](../ops/deploy-runbook.md).
5. `aps-environment` is `development` in the file for Xcode device builds; TestFlight and App Store archives are re-signed with `production` from the provisioning profile. Check the exported entitlements before the first TestFlight upload.

## Containment and sign-out

- With the flag off, FirebaseMessaging is linked but inert: Info.plist sets `FirebaseMessagingAutoInitEnabled` to NO, and only `PushComposition.make()` (flag on) enables FCM auto-init. No token is minted and no FCM traffic starts.
- The registered device is remembered per member (`uid|token`), so another member on the same phone always registers again; sign-out calls `unregisterDeviceV1` and deletes the FCM token. A failed unregister is remembered as `uid|token` and only retried while that same member signs in again (never as another member); the token deletion needs no sign-in, so it is retried at every activation and launch until it succeeds, which stops a signed-out phone receiving the previous member's pushes. The cleanup runs on the session ending (button, expired or revoked session, another account), not only on the sign-out button; forced sign-outs cannot call the server, and the server moves a token to the next registering member and prunes dead ones.
- Register, refresh and sign-out run one at a time. A register that finishes after the member signed out is not remembered and is unregistered again.
- Registration is re-run whenever the app becomes active, so a permission granted later in iOS Settings takes effect. If notifications are turned off in iOS Settings while registered, the next activation unregisters the device.

## Device verification and enablement checklist

The APNs key steps, the deploy checklist and a numbered two-phone script are in the [push APNs runbook](../ops/push-apns-runbook.md).

Status: nothing below has been run on a device yet. Use two physical iPhones (A and B, both members of the same company, A also the organizer or an admin) on a build with `Push.xcconfig` included.

**Setup and registration**

- [ ] Fresh install, sign in as A: no permission prompt at launch.
- [ ] Join an activity: the priming dialog appears once; "Turn on notifications" shows the system prompt; accept. A document appears under `users/{uid}/devices` (token, platform `ios`, app version).
- [ ] "Not now" on the priming dialog is remembered (not asked again); enabling later in iOS Settings takes effect the next time the app becomes active.
- [ ] Sign out and sign in as B on the same phone: the device document moves to B; A no longer receives pushes there. A failed unregister is retried at the next sign-in.
- [ ] Cold start from a notification tap opens the event; the `/chat` link falls back to the event page if the snapshot has not loaded yet.

**Test plan per notification type** (set the per-event level to All unless stated; the levels are All / Changes / Reminders / None, default Changes)

| Type | Trigger | Expected on the device | Also check |
| --- | --- | --- | --- |
| Invitation | B invites A to an event (`sendInviteV1`) | A gets a push about the invitation; tap opens the event; the bell badge counts it; accepting from the sheet joins A | A in a different company cannot be invited; a declined or accepted invite stops further pushes; the notice also exists under `users/{uid}/notifications` with no push permission |
| Event change | An admin edits title, time or venue (`updateEventV1`) | Going members at level All or Changes get one push per change; tap opens the event; Change history lists it | Level Reminders or None: no push; cancelling an event pushes once |
| Reminder | Event starts in about 24 h and about 1 h (`sendEventReminders`, every 15 minutes) | One push at each point for going members at All or Reminders, exactly once even across scheduler runs | Level Changes or None: none; an event that was cancelled or already started: none; leaving before the reminder: none |
| Chat | B posts in the activity chat (`onEventMessageCreated`) | A (going, level All) gets a push with the sender and a message snippet; tap opens the event with the chat; B (the sender) gets none | Level Changes, Reminders or None: none; a member who is not going: none; after the chat closes (24 h after the end): no new messages |
| RSVP trigger | A joins | Per-event level document is created with the default (Changes) | Leaving keeps the level but stops pushes |

**Notification settings (Profile > Notifications) and categories** (default push switches: invites, activity updates, reminders, chat, challenges on; comments and photos, suggestions off)

- [ ] Settings screen: permission row matches iOS (On; "Notifications are off in iOS Settings" with a working "Open iOS Settings" button; "Turn on" while never asked). Switches are visible but disabled without permission. Reopening shows saved switches, also after relaunch.
- [ ] Invites: switch off, B invites A: no push, notice still in the center. On: push arrives.
- [ ] Activity updates: switch off, an admin changes or cancels an event, or adds A: no push. On (and activity level All or Changes): push arrives.
- [ ] Reminders: switch off: no 24 h or 1 h push. On (and activity level All or Reminders): both arrive.
- [ ] Chat: switch off, B posts: no push even at activity level All. On: push arrives.
- [ ] Challenges: switch off: no review or weekly theme push. On: both arrive.
- [ ] Comments and photos ("Comments on your photos and new photos from activities you went to"): default off, no push; turn on, then a comment on your photo ("New comment on your photo") and a new photo in an album you attended (activity title, "X added a photo to the album.") both arrive. Rows 24 to 29 of the [device verification guide](../ops/push-device-verification.md).
- [ ] Suggestions: default off, no push; turn on and confirm the behavior the server offers (no kind yet).
- [ ] The per-activity bell still overrides: category on with activity level None gives no push.

**Negative and containment checks**

- [ ] With `DIP_PUSH_ENABLED = NO` (include line removed): no prompt, no registration, no FCM token, no `devices` document.
- [ ] Notifications turned off in iOS Settings: the app still works, no crash, registration is skipped.
- [ ] Airplane mode while tapping a notification: the event opens from cache or shows the offline state, no crash.
- [ ] Dead or revoked token (delete and reinstall the app): the server prunes the old token on the next send; no error loop in Cloud Logging.
- [ ] No notification contains private data beyond the allowed title and snippet; lock screen previews follow the user's iOS settings.

Record results (build number, devices, pass or fail per row) in the session log, then update [CURRENT_STATE.md](../../CURRENT_STATE.md) and the V2 [frontend plan](../milestones/v2/FRONTEND_PLAN.md).

## Not covered

Payload: every push is an alert (`apns-push-type: alert`, priority 10, `interruption-level: active`), never time-sensitive or content-available. Reminders expire at the activity start and change pushes at its end (`apns-expiration`); `data.category` carries the preference category and `aps.category` is only set once the app registers a matching UNNotificationCategory.

Token hygiene: `registerDeviceV1` refreshes `lastSeenAt` on every launch, and a daily server job deletes registry rows unseen for 60 days. Invalid tokens are still pruned on send.

### Invite action buttons (PUSH-8)

Built in 0.1.2, unit-tested with fakes, **device-unverified** (the simulator cannot deliver a remote push with actions). Invite pushes carry `aps.category` `DIP_INVITE` and the data keys `type` `invite`, `companyId`, `eventId`, `inviteId`.

- **Category.** `SystemPushAdapter.install()` registers `DIP_INVITE` with `DIP_INVITE_ACCEPT` ("Accept", "Aceptar") and `DIP_INVITE_DECLINE` ("Decline", "Rechazar"). Both run in the background (no `.foreground`: the app does not open) and both need an unlocked device (`.authenticationRequired`), because answering changes the member's plans and is visible to the inviter. Decline is not styled destructive; it deletes nothing. Titles follow the app language at launch.
- **Answer.** `PushCoordinator.handleResponse` passes the button to `PushInviteResponder`, which uses the same `DIPInvitesRepository.respond(inviteID:accept:)` call (`respondToInviteV1`) as the in-app buttons. The repository is built per action from the signed-in Firebase user and the push's `companyId` (a background launch has no member session on screen); the server checks membership and that the caller is the recipient. The delegate awaits the call, so iOS keeps the launch alive until it finished.
- **Idempotent.** A second press while the first is running is ignored; `INVITE_ALREADY_RESPONDED` counts as done.
- **Failure.** Missing ids, nobody signed in, offline or any other refusal: in the background the app posts a local notification ("Couldn't answer the invitation", "Open the activity in DIP to answer it.") whose tap opens the activity; in the foreground it opens the activity directly.
- **Any type.** A tap opens the payload's `deepLink`, else `dip://events/{eventId}`, whatever the `type` (new types such as `photo_comment`, `photo_added`, `attendee_removed` included); without either the app just opens.

Device steps: rows 30 to 39 of the [device verification guide](../ops/push-device-verification.md).

Background/silent pushes, badge counts, notification categories and actions other than `DIP_INVITE`, and any server change. A rich notification service extension is out of scope.
