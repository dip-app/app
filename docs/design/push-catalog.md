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
| 11 | New weekly challenge | Every active member of the company, whatever the role (member, organizer, admin); invited and deactivated users excluded | `challenges` | on | none | Built | P2 | `weekly_theme_{company}_{challengeId}` (pages `_p{n}`) | shared | Medium. One push a week, Monday 09:00 New York. Expires at the window end. Disable-able in the category. Until November 22 the member pager skipped organizers (bug, fixed with `isCompanyAudienceMember`). |
| 12 | New message in an activity chat | Going members at level All, except the author | `chat` | on | All | Built | P2 | `chat_{messageId}` | chat | Medium. The level All requirement makes it opt-in per activity; own cap bucket. |
| 13 | Comment on your album photo | The uploader (never the commenter) | `social` | **off** | none | **Built (new)** | P3 | `photo_comment_{commentId}` | social | Medium for the uploader, low overall. Off by default, own small cap. There are no comment replies (no thread model), so only the uploader is notified. |
| 14 | New photo in the album of an activity you attended | The other members who went | `social` | **off** | none | **Built (new)** | P3 | hash of event, uploader and UTC hour | social | Low to medium. One push per uploader, activity and hour, so a burst of 20 uploads is one push. Off by default. |
| 15 | Event matches your interests | Members whose interests match a new activity | `discovery` | off | none | Deferred | P3 | n/a | n/a | Medium, high spam risk. Needs a weekly digest job and interest matching; the weekly admin and Dipbot idea emails cover discovery for now. The registry kind `event_interest` and the setting already exist, so building it later needs no contract change. |
| 16 | Points awarded (check-in, adjustment) | The member | none | n/a | none | Deferred (decision) | P3 | n/a | n/a | Low. The admin checks the member in face to face, so the member already knows. Challenge points are covered by 9. Needs a new category and an iOS settings row for little value; revisit with rewards. |
| 17 | Weekly challenge ends soon | Members who have not submitted | `challenges` | on | none | Deferred | P3 | n/a | n/a | Medium, but it needs a "has not submitted" read per member and a second weekly schedule. Candidate once the weekly push is verified on devices. |
| 18 | Calendar conflict | The member | none | n/a | none | Not a server push | n/a | n/a | n/a | The server never sees the calendar ([calendar](stretch/calendar.md)); in-app only. |
| 19 | Invite declined | The sender | `invites` | n/a | none | Rejected by design | n/a | n/a | n/a | A decline notification is discouraging; the invitations sheet still shows the status. |
| 20 | Invite Accept and Decline buttons | The invitee | `invites` | on | none | Built (iOS 0.1.2) | P3 | n/a | n/a | See "PUSH-8" below. |
| 21 | Quick actions on every other push (Can't make it, Directions, Reply, Open) | Each push's recipient | n/a | n/a | none | Built (server and iOS, after 0.1.2) | P2 | n/a | n/a | See "Quick actions" below. |

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

`calendar_invites`, `admin_suggestions`, `weekly_themes` (weekly challenge announcement email) and `admin_digest` (daily roster digest for admins) are email only; the last two default off. The iOS Email list (Profile > Notifications) shows **Weekly challenge email** to every member and **Daily admin digest** to admins only; `admin_suggestions` stays portal-only. The admin portal's Your settings page offers language and the admin email switches only. It has no push settings because the web portal has no push channel; members set push categories in the iOS app. Email categories in the portal belong to the email workstream.

## PUSH-8: invite action buttons

Server side: invite pushes carry `aps.category` `DIP_INVITE` and the data keys the app needs (`type` `invite`, `companyId`, `eventId`, `inviteId`). App side (0.1.2, device-unverified): the app registers `DIP_INVITE` with `DIP_INVITE_ACCEPT` and `DIP_INVITE_DECLINE` (background, unlock required) and answers through `respondToInviteV1`, the same call as the in-app buttons; on failure it posts a local notification that opens the activity. Details in [push client](push-client.md#invite-action-buttons-push-8).

## Quick actions

Audit of November 22, 2026 (owner request: "accept and decline and similar actions for all other actionable notifications"). Built and unit-tested on the server (`APNS_CATEGORIES` in `modules/notifications/domain/push.ts`, `notificationQuickActions.test.ts`) and in the app (`SystemPushAdapter.categories()`, `PushQuickActionResponder`, `PushQuickActionTests`); **not deployed, device-unverified**. Every push carries `aps.category`; titles, bodies and data keys are byte-identical to before (pinned per kind in the test), so a build without the categories shows the plain notification. Client details: [push client](push-client.md#quick-actions-on-every-other-push).

Rules applied (Apple HIG): at most two actions per category so the lock screen shows all of them; short titles; the default tap already opens the item, so Open is only offered where it is the only choice or next to a destructive one; anything that changes data runs in the background and requires an unlocked device; leaving is styled destructive.

| Push kind | `aps.category` | Actions (options) | What each calls | Idempotency | Auth and tenant |
| --- | --- | --- | --- | --- | --- |
| `invite` | `DIP_INVITE` | Accept, Decline (background, unlock) | `respondToInviteV1`, same as the in-app buttons | in-flight dedupe; `INVITE_ALREADY_RESPONDED` counts as done | signed-in user; server checks company and recipient |
| `attendee_added` | `DIP_EVENT_GOING` | Open (foreground); Can't make it (background, unlock, destructive) | Open: `deepLink`. Can't make it: `setRsvpV1` status `cancelled`, the event page's Leave | in-flight dedupe; the server returns an unchanged RSVP without a count change | `setRsvpV1` derives the member from the auth and checks the company; after the start it refuses (`EVENT_CLOSED`) and the app falls back |
| `event_changed` (time, place, back on) | `DIP_EVENT_GOING` | Open; Can't make it | as above | as above | as above |
| `event_cancelled` (same `type` `event_changed`, status to cancelled) | `DIP_OPEN` | Open (foreground) | `deepLink` | n/a | n/a |
| `reminder` (24 h, 1 h) | `DIP_REMINDER` | Directions (foreground); Can't make it | Directions: event document read (same-company rule), then the event page's `directionsURL` in Apple Maps. Can't make it: `setRsvpV1` as above | read only; leave as above | read rules: same company, scheduled event |
| `chat` | `DIP_CHAT` | Reply (text, background, unlock) | the chat composer's own-author message write, author from the member's own profile | message id `push-` + SHA-256(notification id, text); create-only document, an identical committed retry counts as done | rules: going RSVP, own author equal to the server profile, chat open until 24 h after the end |
| `photo_comment` | `DIP_PHOTO_COMMENT` | Reply (text, background, unlock) | the photo viewer's own-author comment on the push's `photoId` | same id scheme as chat | rules: same company, own author, existing photo |
| `photo_added` | `DIP_OPEN` | Open | `deepLink` | n/a | n/a |
| `attendee_removed` | `DIP_OPEN` | Open | `deepLink` (no Rejoin: an organizer decided) | n/a | n/a |
| `invite_answered` | `DIP_OPEN` | Open | `deepLink` | n/a | n/a |
| `challenge_approved`, `challenge_changes_requested`, `weekly_theme` | `DIP_OPEN` | Open | opens the app (Home shows the weekly challenge; `dip://challenges/{id}` is not routed yet, same as the tap) | n/a | n/a |

Considered and left out:

- **Add to calendar on reminders.** Not cheap: it needs EventKit permission in a foreground action, and a reminder 24 h or 1 h before is late for it. The event page and the calendar invite email cover it.
- **"Still going" on changes and organizer adds.** Going is the default; an action that changes nothing only adds a button.
- **Rejoin on "Your spot was released".** An organizer removed the member on purpose; rejoining stays a deliberate step on the event page.
- **Accept on "Invitation accepted".** Nothing to answer.
- **Like or react on photos.** There is no reaction model.

Unknown action identifiers (a future server category on an old build) fall back to opening the payload's link.

## Email quick actions: designed, deferred

The coworker-invite email could carry one-tap Accept and Decline, and the reminder email a "Can't make it", through signed links. **Not built in this pass**, for three reasons: it needs a new public HTTPS function and a Hosting rewrite (`firebase.json`, a shared choke point), changes to the invite and reminder templates and their golden snapshots (owned by the email workstream, which is changing them in parallel), and a decision on the forwarded-email risk below. Exact design for the follow-up:

- **Token.** Same construction as the unsubscribe token (`email/domain/unsubscribeToken.ts`) with its own domain separation string `dip-email-action.` and its own Secret Manager key (`EMAIL_ACTION_KEY`, at least 32 bytes; never the unsubscribe key, so one leak cannot do both): `base64url("v1:" + action + ":" + companyId + ":" + inviteId-or-eventId + ":" + uid + ":" + nonce + ":" + expiry) + "." + HMAC-SHA256`. `action` is `accept`, `decline` or `leave`. Expiry: the earlier of 7 days and the event start. `nonce` is 16 random bytes stored with the outbox row.
- **Endpoint.** `emailActionV1` at `https://letsdip.work/a/<token>` (public, no cookies, no redirects, `Cache-Control: no-store`, `noindex`, the unsubscribe page's CSP). **GET and HEAD only render a confirmation page** ("Accept the invitation to Pizza night?" with one button), because mail scanners and link previews prefetch GETs. **POST performs the action**, with a form field `confirm=1`.
- **Single use.** A transaction creates `emailActionReceipts/{sha256(token)}` (server-only, TTL 30 days) before calling the application service; an existing receipt answers the same "Done" page without acting again, so a double click is harmless.
- **Action.** POST calls the same application services as the callables with the uid from the token: `respondToInvite` (checks the invite is in `companyId`, the uid is its recipient, still pending) and `applyRsvp` with `cancelled` for leave. The membership check runs as in the callable (an inactive or moved member is refused). Already answered and event closed show a neutral page that links to the app. Every failure (forged, expired, malformed, wrong recipient, missing invite) shows the same "Link not valid" page, so the endpoint reveals nothing.
- **Rate limit.** Per token hash and per IP bucket (10 per minute), like the share pages.
- **Tests required before shipping.** Forged signature, expired, reused token (second POST is a no-op), scanner GET changes nothing, HEAD changes nothing, double POST, already answered invite, wrong recipient (token for uid A on an invite to B), another company's invite id, deactivated member, event started (leave refused), oversized and malformed tokens.
- **Risk to decide.** Anyone holding the email (a forward, a shared inbox, an assistant) can answer for the member without signing in. The confirmation page names the activity but not the member. Mitigations: short expiry, single use, only reversible actions (an accept can be undone in the app; Decline and leave free a spot that may be taken meanwhile). The owner should confirm that this trade-off is acceptable for leave before the reminder link is built.

## iOS follow-ups

Done in 0.1.2 (device-unverified):

1. Settings copy for Comments and photos now reads "Comments on your photos and new photos from activities you went to" (Spanish too). The category key `social` is unchanged.
2. In-app center: `comment` (speech bubble) and `photo_added` (photo) rows open the activity; `attendee_removed` has its own row icon; any unknown kind falls back to a generic bell row.
3. The `DIP_INVITE` category and actions (PUSH-8).
4. Every push `type`, known or not, opens its `deepLink`, else `dip://events/{eventId}`.

Done after 0.1.2 (device-unverified): the quick action categories above.

Open:

1. Optional: open the album instead of the event page for social pushes once an album deep link exists.

## Notification text language (November 22, 2026)

Push copy and in-app notices (`users/{uid}/notifications` title and body, shown as stored by the app) follow each
recipient's `users/{uid}.locale` (en or es; missing means English). English is byte-identical to before.

| Text | Language |
| --- | --- |
| Push titles and bodies of every router kind (chat, change, cancel, reminder, invite, invite answered, attendee added and removed, challenge reviewed, weekly challenge, photo comment, photo added) | Recipient locale (`pushFor`) |
| In-app notices written by the router: change, cancel, reminder, invite answered, photo comment, photo added | Recipient locale (`NotificationRequest.inAppFor`; the router reads the locales of every in-app recipient, falls back to English on a failed read or builder) |
| In-app notices written by commands: invite (`sendInviteV1`), attendee added (`addEventAttendeeV1`), challenge approved (`approveChallengeV1`) | Recipient locale, from the recipient document the command already reads (`notifications/domain/notices.ts`) |
| Event change fallback title "Activity update" (event without a title) | Recipient locale (`push.change.fallbackTitle`) |
| In-app notice attendee removed (`removeEventAttendeeV1` and deactivation) | **English.** The removal transaction does not read the member document; localizing needs one more read per removal. |
| In-app notice changes requested (`rejectChallengeV1`) | **English** title "Changes needed" and fallback body (the body is normally the reviewer's own note, which is never translated). Same reason: the reject transaction does not read the submitter. |
| Legacy push path (`PUSH_ROUTER_ENABLED=false`, rollback only) | English |

Notices written before this change keep their stored English text.
