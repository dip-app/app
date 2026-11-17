# Work session

User: sandervonk
Date: 2026-11-17
Workstream: stretch-push
Agent: Claude (Opus lead, Sonnet subagents)
Status: completed

## Summary

Stretch S4 (#204) wrap-up: wires the email channel (EML-8, from the email workstream) into the routed push triggers, as the email lead's handoff asked of PUSH-3. Email stays off until `EMAIL_ENABLED`.

## Changes

- `notifications/transport/routerDeps.ts`: `email: routerEmailChannel(emailChannelDependencies())`, omitted if construction throws.
- `notifications/application/emailPayload.ts` (new) and payloads in `handlers.ts` (change, cancel, reminder), `newTriggers.ts` (attendee added, invite answered, challenge reviewed) and `invites/infrastructure/invitePushNotifier.ts` (invite). Chat is never emailed; weekly theme has no template.
- Event start and end times passed through the admin and invite ports for templates; `respondToInvite` reads the event before writing.
- `docs/design/stretch/push-triggers.md` status line.

## Validation

- `tsc --noEmit`; unit notification, email, invites, challenge-submissions, admin-events 348/348 (includes `notificationEmailPayloads.test.ts`, payloads checked against the real template validator).
- Emulator (subagent, temporary ports): `notifications-triggers.test.ts` 7/7; build output loads (`require` of `lib/index.js`).

## Decisions

- Outbox ids follow the email doc rule; reminders use `${window}_${startMs}` and `notAfter` = activity start.
- Invite answered emails only on accept, like the push.

## Handoff

- Workstream complete in code. Open: PUSH-8 (#212, optional, deferred) and PUSH-9 (#213, blocked on the owner uploading the APNs key; steps and device script in `docs/ops/push-apns-runbook.md`). Nothing deployed.
