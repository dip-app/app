# Work session

User: sandervonk
Date: 2026-11-17
Workstream: stretch-email
Agent: Claude Opus (email lead) with Sonnet subagents
Status: handoff

## Summary

Third email session, after the push workstream's #235 landed (router-migrated triggers and the Profile > Notifications screen). The triggers now hand email payloads to the router. The settings screen gains an Email section (EML-9). The event-updated email shows old values struck through. The footer has no postal address, per the owner's decision. Nothing deployed, no email sent.

## Changes

- The push workstream wired trigger payloads first (#240), so my parallel wiring was dropped. This PR only extends their `notifications/application/emailPayload.ts` and the event-change caller in `handlers.ts` with `venueAddress` and `previous` (old values), and stops the email when nothing visible changed.
- Event updated email: When and Where always show current values. The old value of each changed field is shown struck through above it; a time-only change strikes only the time, and venue name and address are struck independently. A changed title is struck too. Subjects name what changed. Updates with no visible change are not emailed (`hasVisibleChange`, shared by the renderer and the payload builder).
- Footer: "Sent by DIP · Questions? support@letsdip.work". `EMAIL_POSTAL_ADDRESS` and its sender gate are removed.
- iOS (EML-9): Email section in `DIPNotificationSettingsModel` and `DIPNotificationSettingsScreen`, showing invites, updates, reminders and challenges. Discovery is hidden because no template exists yet. Email switches work while push is denied. `toggle(_:on:to:)` is generalized. The repository saves one channel map at a time with a merge write. The mock is updated. The push section title is now "Push".
- Docs: email design decisions and compliance (transactional only; a promotional email would need a postal address), contract, setup runbook.

## Validation

- `cd gcp/functions && npx tsc --noEmit`: clean.
- Targeted unit tests (functions `tests/unit/*`, `gcp/tests/unit/notifications*`, `invites`, `email-*`, `challenge-submissions`, `admin-events`): 363 pass, 0 fail, 6 todo (existing placeholders, not counted). `check:generated`, `test:docs`, `scripts/tests`: pass.
- Email emulator suite on alternate ports: 9 of 9.
- `swift test --package-path ui/Packages/DIPCore --filter DIPNotificationSettingsModelTests`: 21 of 21.
- One simulator build. I checked the screen in the simulator with `--mock-member --notifications-push=denied`, then deleted the DerivedData (2.6 GB).
- `NotificationSettingsUITests` failed at launch in the subagent's run on this branch, including cases that already existed before EML-9 ("Multiple matching elements" on the Profile button). The cause was not investigated, so I cannot say whether this branch is responsible. I verified the screen manually.
- Design crit round 6 PASS (event-updated diff, iOS Email section); round 7 PASS on the full-bleed header and footer bands (owner request; nit left: the dark mascot panel could be flush with the band). Screenshots at 1200, 600 and 390 px, light and dark.

## Decisions

- No postal address (owner). All templates are transactional; any promotional email would need one.
- Event emails include the venue street address. Recipients are members of the event's company, who already see it in the app.
- Collapsing several change-log entries keeps the earliest old value and the latest new value.
- "Emails go to your Google account address" stays, because sign-in is Google-only (ADR 0007).

## Handoff

- Owner actions are listed in `docs/ops/email-setup.md`.
- `NotificationSettingsUITests` launch failures need someone to investigate. They hit tests that existed before EML-9, but I did not check whether they also fail on main.
- Not verified: real mail clients and a real provider.
