# Push device verification: what to tap, what to see, which log lines

Closes the instructions side of PUSH-9 (#213). I could not run any of this: it needs two physical iPhones, the APNs key and a deploy. Nothing below has been executed. Do the setup in the [APNs runbook](push-apns-runbook.md) sections 1 and 2 first; its section 3 is the base test script (21 rows). This page adds the rows for the newer triggers, the exact log lines to read, and a short smoke test you can do in 15 minutes.

Catalog of what should arrive: [push catalog](../design/push-catalog.md). Never paste tokens, the APNs key or its Key ID anywhere. Record results (build number, devices, iOS versions, deployed commit, Pass or Fail per row) in a session log, never in a chat.

## Setup

- Two iPhones, **A** and **B**, signed in as different members of one test company. A is also an admin or the organizer of the test activities. Use a test company, never a real team.
- A TestFlight build with `Push.xcconfig` included (`DIP_PUSH_ENABLED=YES`, `aps-environment` `production`). Xcode Debug builds use the sandbox environment instead; see the troubleshooting table in the runbook.
- Functions deployed with the [push-related functions](push-apns-runbook.md#23-functions) including the two new triggers `onPhotoCommentPush` and `onPhotoAddedPush`. `PUSH_ROUTER_ENABLED` left at its default (true).
- Cloud Logging open on project `team05-dip`, Cloud Function logs, "Last hour".

## Log lines to read (all contain ids, kinds and counts only, never tokens, names or message text)

Filter used below: `resource.type="cloud_function"` plus the quoted message.

| Message | Severity | Meaning |
| --- | --- | --- |
| `notification delivered` | INFO | One line per router delivery: `kind`, `notificationId`, `companyId`, `recipients`, `tokens`, `sent`, `failed`, `removed`, `inApp`, `emailsEnqueued` and `blocked` (`category_off`, `event_level`, `no_destination`, `rate_limited`, `inactive`). **This is the main line to check.** `sent: 1` for a recipient with one phone means FCM accepted it. |
| `chat push`, `event change delivered`, `reminders`, `weekly theme pushes`, `photo comment push`, `photo added push` | INFO | Per-trigger summary with the same counts. `duplicate: true` means a retry was absorbed by the receipt. |
| `push send failed: FCM/APNs credentials rejected` | ERROR | The APNs key is missing or wrong (`errorCodes` holds `messaging/third-party-auth-error`). Redo runbook section 1. |
| `push send failed: every token failed`, `push send partially failed` | ERROR / WARNING | `errorCodes` shows aggregated FCM codes. Stale-token codes alone are not logged. |
| `trigger.dropped_stale` | ERROR | A retried trigger was older than its limit and dropped. |
| `push delivery failed` | WARNING | A post-commit push (added, removed, accepted, reviewed) failed; `kind` and a reason code. The command itself succeeded. |
| `PUSH_ROUTER_ENABLED=false: legacy push path ...` | WARNING | The emergency rollback flag is on. Fix before testing preferences. |

Reading a blocked count: `blocked.category_off` means the member's switch is off, `event_level` the per-activity bell is too low, `no_destination` no device row, `rate_limited` a cap, `inactive` the member left or was deactivated.

Where a push should have arrived but did not, check in this order: the log line for the notification id (was it sent, blocked or never triggered), then `users/{uid}/devices` has a row (server-only; read it in the Firebase console), then the phone (iOS Settings > DIP > Notifications, Focus modes, Low Power Mode).

## 15-minute smoke test

| # | Do | See on the phone | See in the logs |
| --- | --- | --- | --- |
| S1 | On A: open the app, join any upcoming activity, accept the priming dialog and the iOS prompt | Prompt appears once | Console: one row under `users/{A}/devices` |
| S2 | On B: invite A to that activity (event page, Invite a Coworker) | A: banner "New invitation"; tap opens the event; bell badge shows 1 | `notification delivered` kind `invite`, `sent: 1`, `inApp` 1 |
| S3 | On A: accept the invite | B: banner "Invitation accepted" | `kind: invite_answered`, `sent: 1` |
| S4 | As admin (portal): change the activity time | A (level Changes or All): one banner; tap opens the event | `kind: event_changed`, `sent` at least 1; `event change delivered` |
| S5 | As admin: add B to an activity with "notify" on, then remove B with "notify" on | B: "You were added" then "Your spot was released" | `kind: attendee_added`, then `kind: attendee_removed` |
| S6 | In A: Profile > Notifications > Activity updates off; as admin change the time again | No banner; in-app notice still appears | `blocked.category_off: 1`, `sent: 0` |
| S7 | Turn it back on; lock A's screen; send a chat message from B (A at level All) | Lock screen shows sender and snippet | `kind: chat`, `sent: 1` |

## Rows for the newer triggers (continue the runbook table from row 22)

| # | Step | Expected | Pass/Fail |
| --- | --- | --- | --- |
| 22 | Admin removes A from an activity with "notify" on; repeat the same request once | One "Your spot was released" push; the in-app notice exists; the repeat sends nothing (`duplicate: true` or no second line) | |
| 23 | Admin removes A with "notify" off | No push and no notice | |
| 24 | Photos: after an activity has ended, B (went) adds a photo. A (went) has Comments and photos **off** | No push to A; in-app notice `photo_added` appears in A's center | `kind: photo_added`, `blocked.category_off: 1` |
| 25 | A turns Comments and photos **on**. B adds another photo once the next UTC hour has started (photos in the same hour as row 24 are absorbed by the dedupe) | A: banner with the activity title and "B added a photo to the album." One banner only even if B adds five photos in a row | `kind: photo_added`, `sent: 1`; later photos in the same hour log `duplicate: true` |
| 26 | B comments on A's photo, A has Comments and photos on | A: "New comment on your photo", body "B: snippet" (at most 80 characters). B gets nothing | `kind: photo_comment`, `sent: 1` |
| 27 | A comments on A's own photo | No push | no `notification delivered` line for it |
| 28 | A switches the language to Spanish (iOS Settings > DIP > Language > Español, then open DIP once; or the admin portal Language setting), then repeat rows 25 and 26 | Spanish copy ("Nuevo comentario en tu foto") | `setMyLocaleV1` once after the app opened; then `sent: 1` |
| 29 | Social cap sanity (test company only): B posts 12 comments on A's photo within an hour | The first 10 push (they collapse into one visible banner per photo), later ones are dropped; the in-app notices all appear | `blocked.rate_limited` greater than 0 after the 10th |
| 30 | Invite push action buttons (app 0.1.2 or later; the simulator cannot test them). B invites A; on A, long-press (or pull down) the invite banner | Accept and Decline appear, in Spanish on a Spanish phone ("Aceptar", "Rechazar") | |
| 31 | A taps Accept on the banner with the phone unlocked and DIP in the background (also once with DIP force-quit) | DIP does not open; the invitation is accepted and A is going (Invitations shows Accepted, the activity shows Joined); B gets "Invitation accepted". Logs: one `respondToInviteV1`, then `kind: invite_answered`, `sent: 1` | |
| 32 | Lock A's phone; B sends a new invitation; on the lock screen tap Decline | iOS asks for Face ID or the passcode first; after unlocking, the invitation is declined without opening DIP; B gets no push (declines are silent) | |
| 33 | Answer the same invitation twice (Accept on the banner, then Accept again from Notification Center if it is still listed) | Nothing visible the second time: an already answered invitation counts as done | |
| 34 | Airplane mode on A, then Accept on a new invite banner | A local notification "Couldn't answer the invitation" appears; tapping it opens the activity, where A can join. No `respondToInviteV1` line | |
| 35 | DIP open in the foreground, Accept on an invite banner while in airplane mode | The app opens the activity instead of posting a notification | |
| 36 | Sign out of DIP on A, then Accept on an older invite banner still in Notification Center | The fallback notification as in row 34; nothing is answered | |
| 37 | Tap a push of a type the build does not know (for example a test message with only `eventId`, or a future type) | The app opens the activity from `deepLink`, or from `eventId` when `deepLink` is missing; never a crash | |
| 38 | Open the in-app center after rows 22 and 24 to 26 | Comment rows show a speech bubble, photo rows a photo icon, the removed row a person-minus icon; tapping opens the activity | |
| 39 | Language: set iOS Settings > DIP > Language to Español, open DIP, then set it back to English and open DIP again | One `setMyLocaleV1` call per change, none on later launches without a change; emails and pushes follow (row 28). With the network off nothing is shown and the call is retried at the next launch | |

## Quick actions on the other pushes (functions and app after 0.1.2)

Needs the functions deploy that adds `aps.category` to every push and an app build after 0.1.2. On an older build the same pushes show no buttons; that is expected. "Long-press" means long-press the banner or pull it down; on the lock screen swipe left and tap Options for older iOS versions.

| # | Step | Expected | Pass/Fail |
| --- | --- | --- | --- |
| 40 | Admin adds A to an activity with "notify" on; long-press the banner | Open and Can't make it (red). Spanish phone: "Abrir", "No puedo ir" | |
| 41 | Tap Can't make it with A unlocked and DIP in the background (repeat once with DIP force-quit) | DIP stays closed; A is no longer going (My Events, attendee count one lower). Logs: one `setRsvpV1` | |
| 42 | Lock A; admin changes that activity's time (A going again first); on the lock screen tap Can't make it | Face ID or the passcode first; then A leaves without DIP opening | |
| 43 | Tap Open on an activity update banner | DIP opens on the activity page | |
| 44 | Admin cancels an activity A is going to; long-press the banner | Only Open (no Can't make it) | |
| 45 | A 1-hour reminder arrives (or wait for the 24-hour one); long-press | Directions and Can't make it. Directions opens Apple Maps at the venue (or a search for the activity title when it has no venue) | |
| 46 | Airplane mode on A, then Can't make it on a reminder | A local notification "Couldn't leave the activity" ("You're still going ..."); tapping it opens the activity; no `setRsvpV1` line | |
| 47 | Can't make it on an old reminder after the activity started | The same local notification (the server refuses with `EVENT_CLOSED`) | |
| 48 | A at chat level All; B sends a chat message; on A long-press and tap Reply, type "On my way", Send | Reply needs an unlock on a locked phone; the message appears in the chat as A for everyone; B gets the usual chat push. DIP does not open | |
| 49 | Reply to the same chat banner twice quickly with the same text | One message only | |
| 50 | B comments on A's photo (A has Comments and photos on); on A tap Reply, type "Thanks", Send | The comment appears under the same photo as A; B gets nothing (comment pushes only go to the uploader) | |
| 51 | Sign out of DIP on A; Reply to an older chat banner still in Notification Center | Local notification "Couldn't send your reply"; tapping it opens DIP; nothing is posted | |
| 52 | Long-press an "Invitation accepted", "New photo", "Your spot was released" and a weekly challenge push | Each shows only Open; Open behaves like a tap | |

## When something fails

Use the troubleshooting table in the [runbook](push-apns-runbook.md#4-troubleshooting), then this page's log table. Open an issue with the row number, the `notificationId` and the log line only. Do not attach screenshots that show tokens or settings pages with keys.
