# Push notifications: APNs key, deploy checklist and device test script

Prepares PUSH-9 (#213, stretch issue #204). A shorter smoke test, the log lines to read and the rows for the newest triggers are in the [device verification guide](push-device-verification.md). Nothing here has been run: the code is implemented but not deployed, the APNs key is not uploaded, and delivery is unverified on a device. Owner steps are marked **(owner)**; deploys are human-only ([deploy runbook](deploy-runbook.md)). Never put the key file, its contents or its Key ID in the repository, a session log, a chat or a screenshot.

Related: [push client](../design/push-client.md), [push triggers](../design/stretch/push-triggers.md), [notification preferences](../design/stretch/notification-preferences.md), [TestFlight and Universal Links](testflight-universal-links.md).

Facts: bundle ID `work.letsdip.app`, Apple team `AX2A775SS6`, Firebase project `team05-dip`, `DIP_PUSH_ENABLED=YES` in the push config and the `aps-environment` entitlement present in the push entitlements.

## 1. APNs authentication key (owner)

An APNs auth key (.p8) is normally valid for both sandbox and production and does not expire, so one key should serve Debug and TestFlight builds (UNVERIFIED, see below).

- [ ] **(owner)** Apple Developer, Certificates, Identifiers & Profiles, Keys, add (+). Name it (for example "DIP APNs"), tick **Apple Push Notifications service (APNs)**, continue, register.
- [ ] **(owner)** Note the **Key ID** (10 characters) shown on the key page. Download the `.p8` once: Apple offers the download a single time.
- [ ] **(owner)** Store the `.p8` and the Key ID in the team password manager. Never commit them, paste them into chat, or leave the file in Downloads.
- [ ] **(owner)** Identifiers, App IDs, `work.letsdip.app`: confirm **Push Notifications** is enabled (the TestFlight checklist, section A, already requires it). If you change capabilities, regenerate the provisioning profile (Xcode automatic signing does this on the next build).
- [ ] **(owner)** Firebase console, project `team05-dip`, Project settings, Cloud Messaging, **Apple app configuration**, select the iOS app `work.letsdip.app`: under **APNs Authentication Key** upload the `.p8`, enter the Key ID and Team ID `AX2A775SS6`.

UNVERIFIED (not stated in repo docs; confirm in the official pages before relying on them): the exact console labels and menu paths above, that one key covers both APNs environments, and any limit on keys per team. Apple: https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns . Firebase: https://firebase.google.com/docs/cloud-messaging/ios/certs .

Done when: the console shows the key under Apple app configuration for the iOS app. Record that fact only (no ids) in the session log.

## 2. Coordinator deploy checklist (nothing has been run)

One integrator, from a clean checkout of the agreed commit, in this order ([deploy runbook](deploy-runbook.md) sections 0, 1, 8 and 9). Always type `--project team05-dip` yourself.

**2.1 Firestore rules and indexes**

```sh
firebase deploy --only firestore:rules,firestore:indexes --project team05-dip
```

- Rules: new `users/{uid}/settings/notifications` block (own document only, boolean switch allow-list per category, no list or delete). `devices`, `pushReceipts`, `notificationReceipts`, `pushRateLimits` and `emulatorPushOutbox` stay server-only (deny-all).
- Indexes: the `devices.lastSeenAt` collection-group field override (used by the stale-token prune) and the `challenges` collection-group composite (`type` ascending, `startDate` ascending; used by the weekly theme job). Wait until both show `Enabled` in the console before deploying the functions that query them (a query on a building index fails with `failed-precondition`).

**2.2 TTL policies** (one time; deletes lag by up to about 24 hours, never treat `expireAt` as exact)

```sh
gcloud firestore fields ttls update expireAt --collection-group=notificationReceipts --enable-ttl --project team05-dip
gcloud firestore fields ttls update expireAt --collection-group=pushRateLimits --enable-ttl --project team05-dip
gcloud firestore fields ttls update expireAt --collection-group=pushReceipts --enable-ttl --project team05-dip
```

`pushReceipts` is the existing reminder receipt collection (optional, tiny). The first two are new in this workstream.

**2.3 Functions**

```sh
nvm use 20
firebase deploy --only functions --force --project team05-dip
```

Read the plan first; no deletion is expected. Subset while iterating: `--only functions:dip:pruneStaleDeviceTokens,functions:dip:sendWeeklyThemePushes`.

| Function | Kind | State |
| --- | --- | --- |
| `pruneStaleDeviceTokens` | Scheduler, daily 03:30 UTC | New. Deletes device rows not refreshed for 60 days; logs counts only |
| `sendWeeklyThemePushes` | Scheduler, Monday 09:00 America/New_York | New. Always uses the router; receipts make a rerun idempotent |
| `sendEventReminders` | Scheduler, every 15 minutes UTC | Changed. Router path behind `PUSH_ROUTER_ENABLED`; now also writes an in-app notice in router mode |
| `onEventMessageCreated`, `onEventChanged` | Firestore triggers | Changed. Route through the router (chat and event_updates categories) |
| `onRsvpChanged` | Firestore trigger | Unchanged behavior (creates the default per-activity level); redeployed with the codebase |
| `registerDeviceV1`, `unregisterDeviceV1` | Callables | Changed. Registration records `lastSeenAt` |
| `sendInviteV1` | Callable | Changed. Invite push goes through the router |
| `respondToInviteV1` | Callable | Changed. Notifies the sender on accept only; declines are silent |
| `addEventAttendeeV1` | Callable | Changed. Admin-added push to the member |
| `approveChallengeV1`, `rejectChallengeV1` | Callables | Changed. Submission approved and changes requested pushes |
| `removeEventAttendeeV1` | Callable | Changed. "Your spot was released" push when the admin chose to notify |
| `onPhotoCommentPush`, `onPhotoAddedPush` | Firestore triggers | New. Comment on your photo and new photo in an album you attended (category `social`, default off). Always through the router |

Cloud Scheduler job count for this codebase: three (`sendEventReminders`, `pruneStaleDeviceTokens`, `sendWeeklyThemePushes`); two are new. Confirm in the Cloud Scheduler console after the deploy that all three exist and show a next run time. The first deploy of a scheduler may need the Cloud Scheduler API enabled (the CLI offers to).

**2.4 The `PUSH_ROUTER_ENABLED` param**

A boolean function parameter, default `true` (router on). Set `false` to fall back to the legacy direct-send path for chat, change and reminder pushes (the new triggers and the weekly theme job always use the router), then redeploy functions. Flip it between reminder windows (not near a :00, :15, :30 or :45 run, and not near an activity's 24 h or 1 h mark) so a reminder is not sent by both paths. Rollback to the legacy path is this flag plus a functions deploy; rules and indexes can stay.

**Compliance warning:** the legacy path does not read notification preferences, applies no per-user rate caps, uses single-phase claims and skips the send-time membership check, so a member who switched a category off still gets the push. Treat `PUSH_ROUTER_ENABLED=false` as a short emergency rollback only, never a resting state. Every cold start with the flag off logs a single warning (`PUSH_ROUTER_ENABLED=false: legacy push path bypasses notification preferences ...`); alert on it.

**2.5 Smoke after deploy**

Check Cloud Logging (severity `ERROR`, Cloud Function) for ten minutes; confirm the three scheduler jobs exist; run section 3. Record the deploy (what, commit, time, results) in the session log and [CURRENT_STATE.md](../../CURRENT_STATE.md), and tag the commit as in the deploy runbook.

## 3. Device test script

Needs the APNs key (section 1) and the deploy (section 2) first. Two physical iPhones, A and B, signed in as different members of one company (A also an admin or the organizer). A TestFlight build with push enabled (`Push.xcconfig` included, `aps-environment` `production`). The default per-activity level is Changes; set A's level per row as noted. Mark each row Pass or Fail.

| # | Step | Expected | Pass/Fail |
| --- | --- | --- | --- |
| 1 | Fresh install, sign in as A | No permission prompt at launch | |
| 2 | A joins an activity (first RSVP) | Priming dialog once; "Turn on notifications" shows the system prompt; accept | |
| 3 | Check `users/{A}/devices` in the console; confirm the app cannot read it | One device row with token, platform `ios`, `lastSeenAt`; client rules deny access | |
| 4 | B invites A to an activity (invites) | Push to A; tap opens the event; bell badge counts it; in-app notice exists | |
| 5 | A accepts the invite; then A declines a second invite | B (the sender) gets an "accepted" push; the decline sends B nothing | |
| 6 | Admin changes the time or venue (A level All or Changes) | One push to A; tap opens the event | |
| 7 | Admin cancels an activity | One push to A with cancel copy | |
| 8 | Admin adds A to an activity | Push to A (admin added you) | |
| 9 | Activity starting in about 65 minutes, A going (level All or Reminders); a second one about 24 h out | 1 h reminder arrives within about 15 minutes of its window, and appears as an in-app notice; the 24 h reminder likewise; each arrives once | |
| 10 | B posts in the activity chat (A level All) | Push to A with sender and snippet; B gets none; tap opens the chat | |
| 11 | A submits a challenge; admin approves | Approved push to A | |
| 12 | A submits again; admin requests changes | Changes-requested push to A | |
| 13 | Weekly theme (Monday 09:00 New York, or the coordinator runs the job once from the Cloud Scheduler console) | Push to A and B with the theme title | |
| 14 | A: Profile > Notifications, switch each category off in turn (invites, activity updates, reminders, chat, challenges) and repeat the matching trigger | Only that category is suppressed; the others still arrive; the in-app notice still appears | |
| 15 | Per-activity bell: set None, Reminders, Changes, All in turn; repeat chat, change and reminder | None gets nothing; Reminders only reminders; Changes changes and cancel; All also chat; category on with level None gives no push | |
| 16 | iOS Settings > DIP > Notifications off; reopen Profile > Notifications | "Notifications are off in iOS Settings" row with an Open Settings button that works; switches disabled | |
| 17 | Tap each push type from the lock screen, from the background and from a cold start | Invite, change, cancel, added, reminder: event page. Chat: event with chat. Challenge pushes: challenge area. Weekly theme: Home theme card. A removed event shows "Activity unavailable" | |
| 18 | Collapse: A offline (airplane mode), make two quick changes to one activity, reconnect | One notification replaces the other; they do not stack | |
| 19 | Expiry: A offline, a reminder window passes and the activity starts, reconnect | The stale reminder is not shown after start | |
| 20 | A signs out; trigger a change | A's phone receives nothing; the device row is gone or moved | |
| 21 | Rate cap sanity (shared 20 per hour and 100 per day per member; chat has its own 30 per hour and 200 per day; event changes 60 per hour and 300 per day; cancellations and reminders are never capped): B sends a burst of chat messages in a test activity | After the cap, further pushes are dropped (see logs) while in-app notices continue. Never run this against a real team | |

Where to record: create a session log with `npm run session:new`, then add the build number, both devices and iOS versions, the deployed commit and Pass or Fail per row. No tokens, key ids or personal data. Then update [CURRENT_STATE.md](../../CURRENT_STATE.md) and the [push client checklist](../design/push-client.md#device-verification-and-enablement-checklist).

## 4. Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `messaging/third-party-auth-error` in function logs | FCM cannot authenticate to APNs: the APNs key is not uploaded, the Key ID or Team ID is wrong, or the key lacks the APNs service. Redo section 1. |
| `messaging/registration-token-not-registered` or invalid token | Expected for uninstalled apps; the sender prunes that device row. If it happens for a fresh install, suspect an APNs environment mismatch (next row). |
| Works on Xcode builds, not TestFlight (or the reverse) | Xcode Debug builds use the sandbox APNs environment; TestFlight and App Store builds use production. The `aps-environment` entitlement must match the build and the Firebase key must cover that environment (UNVERIFIED for one key, see section 1). Check the exported entitlements ([TestFlight checklist](testflight-universal-links.md), section C). |
| No push but the in-app notice exists | Category switched off, per-activity level too low, permission denied, no device row, or a rate cap hit. Check the preference document, the bell level and the logs. |
| Every send failed and logs show `push send failed: FCM/APNs credentials rejected` (severity ERROR) | `errorCodes` holds aggregated FCM codes (never tokens). `messaging/third-party-auth-error` means a wrong or missing APNs key: redo section 1. Stale-token errors alone are not logged. |
| A push was lost after a crash or timeout | Receipts are two-phase: `notificationReceipts/{hash}` is `processing` with `leaseUntil` (5 minutes) until delivery completes, then `done`. A retry inside the lease is a duplicate (the Firestore triggers throw `DELIVERY_IN_PROGRESS` so the platform retries after the lease); after it expires the retry delivers. Receipts without a `state` field (older) count as done. |
| Recipient dropped with `blocked.inactive` in the log stats | The member is deactivated or no longer in the notification's company at send time. `registerDeviceV1` also refuses deactivated accounts (`ACCOUNT_DEACTIVATED`). |
| Reminder missing | Outside the 15-minute poll precision (about 1 hour), cancelled, already started, or the member left. |
| Duplicate reminder after changing `PUSH_ROUTER_ENABLED` | The flag was flipped between the two paths inside one window. Wait for the next window. |

**Emulator outbox (local, no APNs):** with the Functions and Firestore emulators running, the sender never contacts FCM; each multicast is recorded in the server-only `emulatorPushOutbox` collection, visible in the Emulator UI Firestore tab. Use it to check recipients, category, title, body and deep link without a device. In-app notices are under `users/{uid}/notifications`; receipts and caps are under `notificationReceipts` and `pushRateLimits`.
