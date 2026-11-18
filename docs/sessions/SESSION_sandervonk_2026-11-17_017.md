# Work session

User: sandervonk
Date: 2026-11-17
Workstream: emailed-calendar-invites
Agent: Codex
Status: completed

## Summary

Emailed calendar invites (CAL-8 #185, EML-5 #219): joining an event emails the member an iCalendar METHOD:REQUEST from `DIP Events <events@letsdip.work>` (Reply-To support@); event time, place or title changes re-send a REQUEST with the same UID and a higher SEQUENCE; leaving or an event cancellation sends METHOD:CANCEL.

## Changes

- `gcp/functions/src/modules/email/domain/ics.ts`: `buildInviteIcs`, `inviteUid`, `inviteContentType`; `icsAttachmentFor` builds `invite.ics` for the new templates.
- Templates `calendar_invite` and `calendar_cancel` (types, validation, copy, preview cases, snapshots under `gcp/tests/unit/__snapshots__/email`).
- New email-only category `calendar_invites` (default on) in the notification registry, email category type, unsubscribe wording, push rate class, Firestore rules, contract schema and generated models (Swift and TS).
- `application/calendarInvites.ts` (join, leave, update, cancel services), `infrastructure/firestoreCalendarStore.ts` (`emailInviteState` SEQUENCE and delivery state, send-time RSVP and event reads), triggers `calendarInviteOnRsvp` and `calendarInviteOnEventUpdated`.
- Sender: send-time eligibility (not_going, event_canceled, event_ended, never_invited, rejoined), per-message From and Reply-To, both Resend and Postmark adapters honour them.
- `gcp/firestore.indexes.json`: TTL on `emailInviteState.expireAt`.
- iOS: `DIPNotificationCategory.calendarInvites` (email only, "Calendar invites"), tests updated.
- Docs: calendar.md (CAL-8 done), email.md, contracts/email.md, ops/email-runbook.md section 11 (manual checklist), notification-preferences.md.

## Validation

- `npm run build`: clean.
- `npm run test:unit`: 1165 tests, 0 failures (new: `gcp/tests/unit/email-calendar-invites.test.ts`, 24 tests: golden REQUEST/CANCEL, UID stability, SEQUENCE, escaping and 75-octet folding, DST, fake-server tests for Resend and Postmark, preference, idempotency, leave/rejoin and cancel flows).
- `npm run check:email`: No errors.
- `npm run check:generated`, `npm run test:docs`, `npm run test:contracts`: pass.
- `swift test --filter DIPNotification` in `ui/Packages/DIPCore`: pass.
- `npm run test:rules`: not run, Firestore emulator port was taken by another process; a rules test for `email.calendar_invites` was added but is unverified.
- No real sends, no deploy, no secrets.

## Decisions

- Default on for `calendar_invites` (transactional confirmation of the member's own join); one switch controls invites, updates and cancels.
- Attendee is ACCEPTED with RSVP=FALSE, times in UTC, 30 minute alarm on REQUEST.
- Provider APIs take no inline text/calendar part, so the invite is one attachment with `method=` in the content type (documented limit; SMTP relay fallback not built).
- The informational PUBLISH `event.ics` attachment was removed from all other emails (no duplicate calendar entries); reminder and changed emails get a note pointing to the event page.
- The optional `webcal://` feed from the CAL-8 scope is not built.

## Handoff

Owner: verify `letsdip.work` sending domain with the active provider, deploy the two triggers and Firestore indexes (TTL), then run the manual checklist in docs/ops/email-runbook.md section 11 in Gmail, Outlook and Apple Mail before enabling a pilot company.
