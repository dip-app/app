# Email coverage

Status: November 22, 2026 (email end-to-end verification pass). Answers the owner's question "are you sure you created emails for all the invite, upcoming event and other situations?" with one row per situation in which a member, organizer, admin or invited person could reasonably expect an email: whether an email is built, whether it is wired to the trigger production uses, its switch and default, and whether it has been exercised end to end. The [email catalog](email-catalog.md) describes each template; this page is the coverage view. Nothing here was deployed and no real email was sent.

## How it was verified

`npm run test:email:e2e` ([runbook, pre-release check](../ops/email-runbook.md#13-pre-release-check-email-end-to-end-suite)) starts the Auth, Firestore and Functions emulators and drives every email through its real trigger: the same callables the app and the admin portal call (sign-in and membership resolve, invites, RSVPs, event create, edit and cancel, admin add, deactivation, submission reviews, roster, problem reports, language), the Firestore triggers they fire, and the three scheduled jobs (reminders, weekly challenge email, admin digest) through their application functions with the production Firestore adapters and a chosen clock, because the emulator has no scheduler. The functions emulator sends through `EmulatorOutboxEmailProvider`, which records every message (subject, From, Reply-To, HTML, text, headers, attachments; the address only as a hash). Every step asserts the exact set of (recipient, template) emails, then waits for a quiet period, so a missing, extra or duplicate email fails the step. Shared checks on every message: one-click unsubscribe headers, the shared header and footer art, the footer contact, no address stored, no template holes, no attachment except on calendar emails, the `notify@` sender (calendar emails: `DIP Events <events@letsdip.work>`, Reply-To `support@letsdip.work`).

"E2E" below means the suite covers the row; "unit" means only unit tests (the [email catalog](email-catalog.md) lists them).

## Coverage matrix

### Invitations and joining

| Situation | Email (template) | Trigger in production | Recipient | Switch, default | Status |
| --- | --- | --- | --- | --- | --- |
| A coworker invites you to an event | `invite_received` | `sendInviteV1` -> router | the invitee (never the sender) | `invites`, on | **Fixed in this pass**: never sent before (see bug 1); venue added (bug 2). E2E: English and Spanish, Where row, company zone, replay sends once, cross-tenant invite refused, invitee with `invites` off gets none |
| Your invite was accepted | `invite_answered` | `respondToInviteV1` accept -> router | the inviter | `invites`, on | **Fixed in this pass** (bug 1, bug 2). E2E: one email, replay sends nothing |
| Your invite was declined | none | | | | By design: declines are silent (push too). E2E: decline sends nothing |
| You join an event (app, invite accept, admin add) | `calendar_invite` (METHOD:REQUEST, `invite.ics`) | RSVP document becomes `going` (`calendarInviteOnRsvp`) | the member who joined | `calendar_invites`, on | E2E: SEQUENCE 0, UID `dip-<event>-<hash>@letsdip.work`, ORGANIZER, ATTENDEE accepted without RSVP, alarm, LOCATION, URL, DTSTART in UTC, replay sends once |
| You leave an event | `calendar_cancel` (METHOD:CANCEL) | RSVP leaves `going` | that member | `calendar_invites`, on | E2E: same UID, SEQUENCE + 1; rejoining sends a fresh REQUEST on the same entry |
| An admin adds you to an event | `attendee_added` plus the `calendar_invite` | `addEventAttendeeV1` with "notify" -> router | the added member | `event_updates`, on | **Fixed**: venue added (bug 2); an admin who adds themself no longer gets "you were added" (bug 4). E2E: one each, replay sends once, "notify" off sends only the calendar invite |
| An admin removes you from an event | `calendar_cancel` only ("Removed from your calendar") | `removeEventAttendeeV1` (RSVP canceled) | the removed member | `calendar_invites`, on | Built (calendar). No separate notification email; push and in-app only. **Not built** (low value, see follow-ups) |

### Events you joined

| Situation | Email (template) | Trigger | Recipient | Switch, default | Status |
| --- | --- | --- | --- | --- | --- |
| Place or title changes | `event_changed` plus updated `calendar_invite` | event update (`onEventChanged` change log, `calendarInviteOnEventUpdated`) | going members with event level `changes` or `all`; never the editor (the editor's own calendar entry is still updated) | `event_updates` and `calendar_invites`, on | E2E: old place struck through, new place, Spanish subject, calendar SEQUENCE + 1 on the same UID for every going member, deactivated member gets nothing |
| Time changes | `event_changed` plus updated `calendar_invite` | same | same | same | Built, unit-tested. Not reachable in the product once anyone has responded: `updateEventV1` refuses time changes after the first RSVP (`TIME_CHANGE_BLOCKED`), so there is nobody to email |
| Event canceled | `event_canceled` plus `calendar_cancel` | event status becomes `cancelled` | going members (not the editor); the cancel goes to every going member who holds a calendar entry | `event_updates`, `calendar_invites`, on | E2E: one of each per member, calendar SEQUENCE + 1 |
| A canceled event is reopened | `calendar_invite` (REQUEST again) | event status `cancelled` -> `scheduled` | going members | `calendar_invites`, on | **Fixed in this pass** (bug 3): calendars kept the canceled entry before. E2E. A "back on" notification email is **not built** (push and in-app only; see follow-ups) |
| Starts in about 24 hours | `event_reminder` (24 h) | `sendEventReminders` every 15 minutes, `notAfter` = start | going members with event level `reminders`, `changes` or `all` | **`day_before_reminders`, on (changed in this pass)** | E2E: everyone going gets it, including a member whose stored map still has the old iOS default `reminders: false`; a member who set the event's level to "none" does not; Spanish; company zone; second scheduler run sends nothing; one-click unsubscribe turns off only this switch |
| Starts in about 1 hour | `event_reminder` (1 h) | same | same | `reminders`, off (opt in) | E2E: nobody by default; the member who turned it on gets one; rerun sends nothing |
| Pending invite and the event is canceled | none | | | | Not built: the invitee never joined. Low value |
| Waitlist or capacity changes | none | | | | Not applicable: DIP has no waitlists |

### Weekly challenges

| Situation | Email (template) | Trigger | Recipient | Switch, default | Status |
| --- | --- | --- | --- | --- | --- |
| Your submission was approved | `challenge_reviewed` | `approveChallengeV1` -> router | the submitter | `challenges`, on, only when push will not be delivered | E2E: Spanish subject, a member with a registered device gets push only, replay sends once |
| Changes were requested on your submission | `challenge_reviewed` | `rejectChallengeV1` -> router | the submitter | same | E2E: the reviewer's reason is never in the email |
| A new weekly challenge started | `weekly_theme` | `sendWeeklyThemeEmails`, Monday 09:00 New York | active members and admins who turned it on | `weekly_themes`, off (opt in) | E2E: nobody by default; one per opted-in member in their language with the theme art; rerun sends nothing. Organizers are not in the member pager, so an organizer who turns it on in the portal gets nothing: owned by the notification follow-ups workstream (weekly challenge audience) |

### Account

| Situation | Email (template) | Trigger | Recipient | Switch, default | Status |
| --- | --- | --- | --- | --- | --- |
| First sign-in | `welcome` | `users/{uid}` created by `resolveMembershipV1` (`welcomeEmailOnMemberCreated`) | the new member | `account` (stopped only by "unsubscribe from all") | E2E: exactly one per member in every company with email on, signing in again sends nothing, an organizer invited through the roster gets the admin portal step |
| An admin invites you before you have an account | `roster_invite` | `sendRosterInviteEmailV1` (or Add person with "Email them an invitation now") | the roster address | `account`, per-address opt-out | E2E: the admin's name and company, the sign-in address in the body (redacted in the record), portal button for organizers, a second send within the hour refused; the invitee's first sign-in claims the entry |
| Your problem report was resolved | `bug_report_resolved` | `updateBugReportV1` to Resolved the first time | the reporter | `account` | E2E: Spanish, never the report text, reopen and resolve again sends nothing |
| Member deactivated | none | | | | By design. E2E: a deactivated member gets no further email (update, cancel, calendar) |

### Admins and organizers

| Situation | Email (template) | Trigger | Recipient | Switch, default | Status |
| --- | --- | --- | --- | --- | --- |
| Invited people joined, imports finished | `admin_digest` | `sendAdminDigestEmails` hourly, from 08:00 company time, previous local day | admins who turned it on | `admin_digest`, off (opt in) | E2E: nobody by default; one email next morning naming the invited person who joined; rerun sends nothing |
| Weekly event ideas | `admin_suggestions` | `sendAdminSuggestionsEmails` weekly | admins who turned it on | `admin_suggestions`, off | Built and owner test-sent; not in the suite (needs the suggestions data set) |
| An event you organize got its first RSVPs, or is full | none | | | | Not built. Recommendation: in-app or push, not email (frequent, low value) |
| A submission is waiting for review | none | | | | Not built. Recommendation: the admin digest could count them later |

### Never emailed by design

Chat messages, photo comments and new album photos (`chat`, `social`), points and achievements, event suggestions (`discovery` has no trigger yet).

## Summary

- 26 situations in the tables: 19 built and exercised end to end, 2 built but only unit-tested (time change, which the product blocks once anyone joined; the admin ideas email, which the owner test-sent), 4 not built because they are low value (admin removal notice, pending-invite cancel, organizer RSVP or full notices, review queue; plus the reopened "back on" email inside the reopen row), 1 not applicable (waitlists). Five more kinds are never emailed by design.
- Added in this pass: the calendar re-invite when a canceled event is reopened (missing trigger), and the default-on 24 h reminder email.

## Bugs found by the suite and fixed

1. **Coworker invite and invite-accepted emails were never sent.** `FirestoreInviteStore.getEvent` converted only `startTime` from a Firestore Timestamp; `endTime` stayed a Timestamp, so `eventFacts` (which needs both as Dates) returned null and the router got no email payload (`emailsEnqueued: 0` in the delivery log). Unit tests used fakes with Dates, so they passed. Fixed by converting both times (`eventDates`); unit test with real Timestamps.
2. **Invite, invite-accepted and "you were added" emails had no Where row.** Their push inputs carried only the times. They now carry the venue name and one-line address (`venueFieldsOf`, `StoredEvent.venueName/venueAddress`).
3. **Reopening a canceled event left everyone's calendar entry canceled.** The calendar trigger ignored `cancelled` -> `scheduled`. It now sends the REQUEST again (same UID, higher SEQUENCE) to going members.
4. **An admin adding themself to an event got "You were added".** The in-app notice, push and email are now skipped when the actor is the added member (`notified: false`).
5. **Stale emulator test.** `email-outbox.test.ts` still expected an `.ics` on the invitation email, removed when calendar invites took over the calendar entry; corrected.

## Owner decision applied: 24 hour reminder email on by default

- New email-only switch `day_before_reminders` (shared registry, rules, contract `EmailCategoryPreferences.day_before_reminders`, additive), **default on**. It governs only the about-24-hour reminder email; the email `reminders` switch now governs only the about-1-hour email and stays default off. Push `reminders` is unchanged and still covers both push windows. The per-event level still applies (a member who sets an activity to "none" gets no reminder email).
- Why a new key instead of flipping `reminders`: iOS writes the whole resolved email map when a member saves any email switch, so many stored documents contain an explicit `reminders: false` that is the old default, not a choice. Flipping the default would not reach those members; an app version that predates the new key never writes it, so the server default applies to everyone.
- Push-or-email rule: the existing rule ([email design, decision 16](stretch/email.md#decisions-defaults-taken-while-owner-questions-are-open)) sends reminder emails on the email switch alone, whatever push does; it does not make reminders push-only. Making the 24 h email depend on push would contradict "reminder emails just work" (most members have push), so the email goes out whether or not a push does. The cost is one push and one email the day before, which is the safer choice.
- Effect: every member going to an event gets one "Tomorrow: <title>" email about 24 hours before it starts (events created less than 20 hours ahead get none, as before), unless they set that activity to "none", turned the switch off, or used the one-click unsubscribe in that email (which turns off only `day_before_reminders`). The footer reads "You are getting this because day-before reminder emails are on."
- Follow-ups for the iOS and portal owners: Profile > Notifications has no row for `day_before_reminders` yet (unsubscribe and the default work without it), and the existing email "Reminders" row now controls only the 1 hour email, so its summary ("About a day and an hour before") should become "About an hour before". The weekly challenge and digest switches have the same iOS gap.

## Known limits and follow-ups

- **Not verified:** real provider delivery (Resend or Postmark), real inbox placement and rendering in Gmail, Outlook and Apple Mail (light and dark), calendar client behavior on the `.ics` (add, update, cancel), and the hosted header and footer art. Use the [15-minute production smoke check](../ops/email-runbook.md#14-production-smoke-check-15-minutes).
- "Tomorrow" in the 24 h subject is computed from the window, not the calendar: an event created between midnight and 04:00 for the same evening would read "Tomorrow" while it is today. Rare; not changed.
- Not built, low value: a "back on" email when a canceled event reopens (the calendar invite and push cover it), a removal notice when an admin removes someone (the calendar cancel covers it), organizer notices (first RSVP, event full), a review-queue notice for admins.
- The weekly challenge email does not reach organizers (member pager roles); owned by the notification follow-ups workstream.
