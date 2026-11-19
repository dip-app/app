# Push catalog: every push, who gets it, and why

Status: audit of November 19, 2026. Nothing is deployed and nothing has been verified on a device ([device verification](../ops/push-device-verification.md)). Parent design: [push triggers and category settings](stretch/push-triggers.md) (issue #204). Category and preference model: [notification preferences](stretch/notification-preferences.md). Email twins: [email](stretch/email.md).

## Principles (the spam filter)

1. **Transactional first.** A push must tell the member something that changes what they do next (a time moved, a spot was released, someone answered an invite). Anything that is only nice to know is off by default.
2. **Opt-in for volume.** Chat needs the per-activity level All (the default level on join is Changes), so it is opt-in per activity. Comments and photos (`social`) and suggestions (`discovery`) are off by default.
3. **One push per cause.** Every notification has a deterministic id (receipt). A retried trigger, a scheduler overlap or an upload burst never sends twice. APNs collapse ids replace an undelivered older push of the same kind.
4. **Caps protect the phone.** Shared 20 per hour and 100 per day per member; chat 30 and 200; event changes 60 and 300; social 10 and 40; cancellations and reminders are never capped. In-app notices continue when a push is capped.
5. **Titles and short snippets only.** No reviewer notes, no emails, no private data; chat and comment snippets are capped at 80 characters.
6. **Per-recipient language.** Copy comes from the push catalogs in English and Spanish by the recipient's server-owned `users/{uid}.locale` (`npm run check:backend-i18n`).

Precedence for every push (one rule, `evaluateDelivery`): category switch on, then per-activity level (event-scoped kinds only), then a registered device. A send-time membership check drops deactivated or moved members.

## Matrix

Priority: P1 must have, P2 should have, P3 nice. "Built" means implemented and unit-tested in this repository, not deployed.

| # | Trigger | Recipient | Category | Push default | Per-activity gate | Built | Pri | Dedupe key (receipt id) | Cap class | Value judgment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Activity time or place changed | Going members at level All or Changes, except the editor | `event_updates` | on | Changes | Built | P1 | `event_{eventId}_{revision}` | changes | High. Actionable and rare. Bursts collapse (`change-{eventId}`); expires at the activity end. |
| 2 | Activity cancelled | Same as 1 | `event_updates` | on | Changes | Built | P1 | `event_{eventId}_{revision}` | exempt | Critical. Never capped. |
| 3 | Reminder about 24 h before | Going members at level All, Changes or Reminders | `reminders` | on | Reminders | Built | P1 | `reminder_{eventId}_24h_{start}` | exempt | High. Fixed two moments per activity; expires at start. Reminder email default is off because push covers it. |
| 4 | Reminder about 1 h before | Same as 3 | `reminders` | on | Reminders | Built | P1 | `reminder_{eventId}_1h_{start}` | exempt | High. 15-minute poll means about 1 hour precision. |
| 5 | A coworker invited you | The invitee | `invites` | on | none | Built | P1 | `invite_{inviteId}` | shared | High. Carries `aps.category` `DIP_INVITE` for the optional Accept and Decline buttons (PUSH-8). |
| 6 | Your invite was accepted | The sender | `invites` | on | none | Built | P2 | `invite_answered_{inviteId}` | shared | Medium. Accepts only; declines are silent so a no never becomes a notification. |
| 7 | An organizer added you to an activity | The member | `event_updates` | on | none | Built | P1 | admin request id | shared | High. The member did not ask for it. |
| 8 | An organizer removed you from an activity | The member (only when the admin chose to notify) | `event_updates` | on | none | **Built (new)** | P1 | admin request id | shared | High. Otherwise the member still believes they are going. In-app notice already existed; the push was missing. |
| 9 | Submission approved | The submitter | `challenges` | on | none | Built | P2 | notice id | shared | Medium to high. Closes the loop on effort. |
| 10 | Changes requested on a submission | The submitter | `challenges` | on | none | Built | P1 | notice id | shared | High. The member has to act. The reviewer's note is never in the push. |
| 11 | New weekly theme | Every active member of the company | `challenges` | on | none | Built | P2 | `weekly_theme_{company}_{challengeId}` (pages `_p{n}`) | shared | Medium. One push a week, Monday 09:00 New York. Expires at the window end. Disable-able in the category. |
| 12 | New message in an activity chat | Going members at level All, except the author | `chat` | on | All | Built | P2 | `chat_{messageId}` | chat | Medium. The level All requirement makes it opt-in per activity; own cap bucket. |
| 13 | Comment on your album photo | The uploader (never the commenter) | `social` | **off** | none | **Built (new)** | P3 | `photo_comment_{commentId}` | social | Medium for the uploader, low overall. Off by default, own small cap. There are no comment replies (no thread model), so only the uploader is notified. |
| 14 | New photo in the album of an activity you attended | The other members who went | `social` | **off** | none | **Built (new)** | P3 | hash of event, uploader and UTC hour | social | Low to medium. One push per uploader, activity and hour, so a burst of 20 uploads is one push. Off by default. |
| 15 | Event matches your interests | Members whose interests match a new activity | `discovery` | off | none | Deferred | P3 | n/a | n/a | Medium, high spam risk. Needs a weekly digest job and interest matching; the weekly admin and Dipbot idea emails cover discovery for now. The registry kind `event_interest` and the setting already exist, so building it later needs no contract change. |
| 16 | Points awarded (check-in, adjustment) | The member | none | n/a | none | Deferred (decision) | P3 | n/a | n/a | Low. The admin checks the member in face to face, so the member already knows. Challenge points are covered by 9. Needs a new category and an iOS settings row for little value; revisit with rewards. |
| 17 | Weekly theme ends soon | Members who have not submitted | `challenges` | on | none | Deferred | P3 | n/a | n/a | Medium, but it needs a "has not submitted" read per member and a second weekly schedule. Candidate once the weekly push is verified on devices. |
| 18 | Calendar conflict | The member | none | n/a | none | Not a server push | n/a | n/a | n/a | The server never sees the calendar ([calendar](stretch/calendar.md)); in-app only. |
| 19 | Invite declined | The sender | `invites` | n/a | none | Rejected by design | n/a | n/a | n/a | A decline notification is discouraging; the invitations sheet still shows the status. |
| 20 | Invite Accept and Decline buttons | The invitee | `invites` | on | none | Server payload built; iOS deferred | P3 | n/a | n/a | See "PUSH-8" below. |

Admin-facing events (a submission awaiting review, a bug report) are intentionally not pushed: admins work in the web portal, which has no push channel. Their email is the [admin suggestions email](stretch/admin-suggestions-email.md).

## Categories and settings

The registry has nine categories; seven are offered for push and all seven exist in the preference document, the rules allow-list and the iOS mirror, so **this work adds no category and needs no migration**:

| Category | Push switch (Profile > Notifications) | Default | Kinds |
| --- | --- | --- | --- |
| `invites` | Invites | on | `invite`, `invite_answered` |
| `event_updates` | Activity updates | on | `event_changed`, `event_cancelled`, `attendee_added`, `attendee_removed` |
| `reminders` | Reminders | on | `reminder` |
| `chat` | Chat | on | `chat` |
| `challenges` | Challenges | on | `challenge_approved`, `challenge_changes_requested`, `weekly_theme` |
| `social` | Comments and photos | off | `photo_comment`, `photo_added` |
| `discovery` | Suggestions | off | `event_interest` (not built) |

`calendar_invites`, `admin_suggestions`, `weekly_themes` (weekly theme announcement email) and `admin_digest` (daily roster digest for admins) are email only; the last two default off. The admin portal's Your settings page offers language and the admin email switches only. It has no push settings because the web portal has no push channel; members set push categories in the iOS app. Email categories in the portal belong to the email workstream.

## PUSH-8: invite action buttons

Server side is done and safe: invite pushes carry `aps.category` `DIP_INVITE` and the data keys the app needs (`type` `invite`, `companyId`, `eventId`, `inviteId`). iOS ignores an `aps.category` it has not registered, so nothing changes on today's builds. The app side (register `UNNotificationCategory` `DIP_INVITE` with actions `DIP_INVITE_ACCEPT` and `DIP_INVITE_DECLINE`, call `respondToInviteV1` from a short background launch with App Check, show a recoverable state on failure) is iOS work that cannot be tested without a device and is listed as a follow-up in [push client](push-client.md#invite-action-buttons-push-8).

## iOS follow-ups (not part of this change)

1. Settings copy for Comments and photos: "Comments and photos on your posts" no longer covers new photos in albums you attended; suggested "Comments on your photos and new photos in activities you went to". Spanish string too.
2. In-app center: render `comment` and `photo_added` (the kinds already exist; targets are `event` ids).
3. Register the `DIP_INVITE` category and actions (PUSH-8).
4. Push `type` values `photo_comment`, `photo_added` and `attendee_removed` are new; unknown types must fall back to the `deepLink` (they all open `dip://events/{id}`).
5. Optional: open the album instead of the event page for social pushes once an album deep link exists.
