# Email catalog

Status: audit of November 19, 2026 (email area owner). Every email DIP sends or could send, with its trigger, recipient, category and default, whether it is built, and why the ones not built were deferred. Owner rule for this pass: build every planned email and every one that is clearly valuable, reuse the shared header, body card and footer, and keep anything that is not transactional off by default. Nothing here is deployed and no email has been sent; everything stays behind `EMAIL_ENABLED` (off) and the per-company `emailSettings/{companyId}.enabled` switch ([email setup](../ops/email-setup.md), [runbook](../ops/email-runbook.md)).

Sources: [email design (S5)](stretch/email.md) template catalog, [calendar emailed invites (CAL-8)](stretch/calendar.md#emailed-invites-cal-8-november-17-2026), [admin weekly ideas email](stretch/admin-suggestions-email.md), [notification categories](stretch/notification-preferences.md), issues #214 (stretch email), #215 (EML-1 domain), #216 (EML-2 provider), #224 (EML-10 policy and pilot), and the candidates listed by the owner (roster invite, welcome, reminders, event changes, weekly theme, challenge result, bug report status, coworker invite, admin digests, points).

## How to read the matrix

- **Category** is the switch that governs the email: a member category from the shared registry (`invites`, `event_updates`, `reminders`, `challenges`, `discovery`, `calendar_invites`, `admin_suggestions`, `weekly_themes`, `admin_digest`; members change them in the app under Profile > Notifications, admins also in the portal under Your settings), or `account`, the transactional account emails added in this pass. `account` is not a member switch: a member stops account emails only by unsubscribing from all DIP emails, and a roster invitee stops invitations from the link in the email.
- **Push policy** is the router's push-or-email rule ([email design, decision 16](stretch/email.md#decisions-defaults-taken-while-owner-questions-are-open)): invites and event updates go to both channels; reminders and discovery follow the email switch; challenge emails go only when push will not be delivered.
- Every email has a plain-text part, a one-click unsubscribe header and link, per-recipient language (English or Spanish), the per-member (20) and per-company (2,000) daily caps, suppression after bounces and complaints, tenant checks at send time and a deterministic outbox id (a redelivered trigger or replayed command sends once).

## Matrix

| Email (template) | Trigger | Recipient | Category | Default | Status | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| Coworker invitation (`invite_received`) | `sendInviteV1` (router) | invited coworker | `invites` | on | built, wired | P1 |
| Invitation accepted (`invite_answered`) | `respondToInviteV1` accept (router) | the inviter | `invites` | on | built, wired (acceptances only) | P2 |
| Event updated (`event_changed`) | event change log, time, place or title changed (router) | going members (per-event level `changes` or `all`), not the editor | `event_updates` | on | built, wired | P1 |
| Event canceled (`event_canceled`) | event change log, status canceled (router) | going members (same gate) | `event_updates` | on | built, wired | P1 |
| Added to an event (`attendee_added`) | `addEventAttendeeV1` (router) | the added member | `event_updates` | on | built, wired | P2 |
| Event reminder, about 24 h and 1 h (`event_reminder`) | `sendEventReminders` scheduler, every 15 minutes (router, `notAfter` = start) | going members (per-event level `reminders` or higher) | `reminders` | **off** (opt in) | built, wired | P2 |
| Calendar invite and update (`calendar_invite`) | RSVP going; event time, place or title changed | the going member | `calendar_invites` | on | built, wired, never exercised in production | P1 |
| Calendar removal (`calendar_cancel`) | RSVP left; event canceled | members who received an invite | `calendar_invites` | on | built, wired, never exercised in production | P1 |
| Submission approved or changes requested (`challenge_reviewed`) | submission review (router) | the submitter | `challenges` | on, only when push is not delivered | built, wired | P2 |
| Weekly event ideas for admins (`admin_suggestions`) | weekly job, admin schedule | admins who turned it on | `admin_suggestions` | **off** (opt in) | built, wired | P2 |
| **Roster invitation (`roster_invite`)** | admin clicks **Send invite email** (`sendRosterInviteEmailV1`), or leaves "Email them an invitation now" on in Add person | the invited person (no account yet), at the roster entry's address | `account` (opt out per address) | sent only on an admin action | **built in this pass** | P1 |
| **Welcome (`welcome`)** | `users/{uid}` created by the first membership resolve (`welcomeEmailOnMemberCreated`) | the new member | `account` | on (once per member) | **built in this pass** | P2 |
| **Problem report resolved (`bug_report_resolved`)** | `updateBugReportV1` sets a report to Resolved for the first time | the reporter | `account` | on (once per report) | **built in this pass** | P3 |
| **Weekly theme announcement (`weekly_theme`)** | `sendWeeklyThemeEmails`, Monday 09:00 America/New_York, themes that started in the last 24 hours (same schedule, lookback and member pager as the `weekly_theme` push) | active members who turned it on | `weekly_themes` (new, email only) | **off** (opt in) | **built in the follow-up pass** | P3 |
| Event suggestions (`discovery`) | new event matching interests (`event_interest` push, not built) | members with matching interests | `discovery` | off | deferred (no trigger exists) | P3 |
| **Admin roster digest (`admin_digest`)**: invited people who joined, imports that finished | `sendAdminDigestEmails`, hourly; per company from 08:00 local, reports the previous local day | admins who turned it on | `admin_digest` (new, email only) | **off** (opt in) | **built in the follow-up pass** (replaces per-join and per-import notices) | P3 |
| Points and achievements | points awarded, attendance recorded | the member | none fits | would be off | not built (too frequent) | none |
| Weekly member digest | weekly | members | `discovery` | off | not built (would be promotional) | none |
| Chat messages, comments, photos | chat, comments | members | `chat`, `social` | never emailed | by design | none |

## The emails built in this pass

All three use the shared layout (`layoutShell`, the same header band, white body card, footer rows and footer band) and the shared primary button; nothing is forked. Copy lives in the email catalogs (`email.rosterInvite.*`, `email.welcome.*`, `email.bugResolved.*`, en and es). Golden snapshots: `gcp/tests/unit/__snapshots__/email/{roster_invite,roster_invite_admin_reminder,roster_invite_long_company,welcome,welcome_admin,bug_report_resolved}` and the same under `es/`. The existing English snapshots did not change.

### Roster invitation

- **Why:** the portal's "Get invite message" made the admin copy a message into their own email. People an admin adds before they sign in now get an email from DIP with the company name, who invited them, the address to sign in with and one button: **Get DIP** (members, `https://letsdip.work/`) or **Open the admin portal** (organizers and admins). A second email to the same person reads as a reminder.
- **Who can send:** admins (`roster.manage`), for `invited` entries of their own company only. The address is the roster entry's own (validated against the company email domain when it was added), never caller input, so the portal cannot email arbitrary addresses.
- **Limits:** at most 5 invitation emails per person, at least an hour apart (`INVITE_EMAIL_LIMIT`, `INVITE_EMAIL_TOO_SOON`), on top of the admin rate limit and the daily caps (counted against `roster-<entryId>`). Refused while email is off for the company (`EMAIL_NOT_ENABLED`; the portal then keeps **Get invite message**), after the person opted out (`INVITE_EMAIL_OPTED_OUT`) or when the address bounced (`INVITE_EMAIL_UNDELIVERABLE`). Each send writes the `roster.inviteEmail` audit entry and `inviteEmailCount`, `lastInviteEmailAt`, `lastInviteEmailBy` on the entry, which the roster shows as "Invite emailed 2×, last Nov 19".
- **Idempotency:** the outbox document is created in the command's own transaction with the id `account_<entryId>_roster-<entryId>_invite<N>`; a replayed `requestId` returns the stored response and queues nothing.
- **At send time:** the sender reads `companies/{c}/roster/{entryId}` again and skips the email when the person already joined or the invite was revoked (`not_invited`), the entry belongs to another company or its address no longer hashes to the entry id (`tenant_mismatch`), or the address opted out or is suppressed. The outbox never stores the address.
- **Language:** the inviting admin's language (`users/{uid}.locale` of the admin, stored on the outbox document as `locale`); the person has no account and no language of their own yet.
- **Opt-out:** the footer link reads **Stop invitation emails** and the one-click POST records `emailInviteOptOuts/{emailHash}` (server only, deny-all rules). The footer has no "Manage in DIP" path because the person has no account.

### Welcome

- **Trigger:** `welcomeEmailOnMemberCreated` (Firestore `onDocumentCreated users/{uid}`; `resolveMembershipV1` creates the profile once, at the first sign-in). Queued only while email is on for the company; a welcome is never caught up later. Id `account_<companyId>_<uid>_welcome`, `notAfter` two days.
- **Content:** "you joined DIP at <company>", two short steps (join an event or invite a coworker; pick interests), plus a first step for organizers and admins (plan events and weekly themes in the admin portal, whose link is then the button).

### Problem report resolved

- **Trigger:** `updateBugReportV1` moving a report to Resolved for the first time; queued in the same transaction as the triage update with the id `account_<reportId>_<uid>_resolved`, so reopening and resolving again never emails twice. Skipped while email is off.
- **Content:** the date the report was sent (in the company zone), thanks, and how to report again. Never the report text, its category, the screenshot or the admin's triage note.

## Opt-in emails built in the follow-up pass (November 19, 2026)

Owner decision: build every planned email that is valuable. Both new emails use the shared layout and button, have English and Spanish copy (`email.weeklyTheme.*`, `email.adminDigest.*`), golden snapshots (`weekly_theme`, `weekly_theme_plain`, `admin_digest`, `admin_digest_joined`, `admin_digest_imports`, in English and under `es/`), and their own **default-off** category in the shared registry (`notifications/domain/categories.ts`), the Firestore rules (owner-only boolean), the contract (`EmailCategoryPreferences.weekly_themes` and `.admin_digest`, additive) and the generated TypeScript and Swift models.

**How default off is guaranteed.** Three independent places. `DEFAULT_PREFERENCES.email` has both at `false`, and `resolvePreferences` treats a missing document, a missing key and any non-boolean value as the default (unit-tested). The jobs evaluate the switch before queuing anything, so a member without a stored choice gets no outbox document. The sender re-reads the switch at send time and skips with `preference_off`. Nobody can switch it on for someone else: the rules allow only the owner to write their own preference document (emulator-tested for same company, other company, unverified and signed out), and the server only ever writes `false` (unsubscribe, complaints).

### Weekly theme announcement

- **Audience and timing:** mirrors `runWeeklyThemePushes`: the same `FirestoreThemes` reader (weekly challenges whose start is in the last 24 hours), the same member pager (active `member` and `admin` roles; organizers are not in the push audience either) and the same Monday 09:00 America/New_York schedule, as its own scheduled function so a push failure never blocks email and the reverse.
- **Once per member per theme:** outbox id `weekly_themes_<challengeId>_<uid>_announce` (create-once); a retry or a second run enqueues nothing. `notAfter` is the theme end.
- **Content:** "This week's theme" with the catalog art tile on the theme accent (`img/email/ideas/<key>.png`, the same tiles as the ideas email; no tile for an unknown key), the title, the description (shortened to 400 characters), the dates in the company zone and the points. One button, **Open DIP** (`https://letsdip.work/`): the app has no theme link yet, so a note says the theme is on the Home screen.
- **Switch:** admins and organizers in the portal (Your settings > Other emails from DIP). The iOS Profile > Notifications switch is an iOS follow-up.

### Admin roster digest

- **Trigger:** hourly job like the weekly ideas email. A company is due from 08:00 to 11:59 in its zone (`emailSettings/{c}.timeZone`, else `EMAIL_DEFAULT_TIME_ZONE`) and the digest reports the previous local day (DST and half-hour zones handled). One email per admin per company day (`admin_digest_<company-day>_<uid>_<day>`), only when something happened.
- **Content (only what admins already see):** roster entries invited by an admin or an import (not walk-in sign-ups) that were claimed that day, with up to 10 roster names and a count of the rest; imports that finished that day (completed or with errors), up to 5 with their finish time and invited, updated and failed counts. No addresses, file names or row errors. Button **Open the roster**; the footer links to Your settings.
- **Recipients:** active admins whose `admin_digest` switch is on; the role is checked again at send time (`not_admin`). Reads are single-field range queries (`claimedAt`, `updatedAt`) inside one company, so no new index is needed.

### Reminder emails now show the venue

`sendEventReminders` now passes the venue name (shortened to the template's 120 characters) and the one-line address into the reminder variables, so the existing Where row appears and the button opens the event (`/e/<id>`). The template did not change, so every English golden snapshot is byte-identical (the snapshot cases always had a venue).

## Deferred, and why

- **Event suggestions (`discovery`).** The category exists (default off) but nothing produces `event_interest` yet; build the email with that trigger.
- **Per-join and per-import admin notices.** Replaced by the daily digest (one email a day instead of one per join or import).
- **Points and achievements.** High volume and already visible in the app; not worth an email.

## Verification still owed

Real sends have never happened. Before the first pilot, run the manual checks in the [email runbook](../ops/email-runbook.md#12-manual-test-plan-for-the-email-catalog): roster invitation, welcome, problem report, reminders with the venue, the calendar invite checklist, and steps 12 to 15 for the weekly theme email and the admin digest.
