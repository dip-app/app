# Work session

User: sandervonk
Date: 2026-11-19
Workstream: email-catalog
Agent: Claude (Opus), email area owner, with Sonnet design reviewers
Status: completed

## Summary

Audited every planned and candidate email into docs/design/email-catalog.md and built the valuable missing ones: a new `account` outbox category with three templates on the shared layout (roster invitation, welcome, problem report resolved), en and es copy, plain-text parts and golden snapshots; the roster invitation callable `sendRosterInviteEmailV1` with limits, opt-out and audit; the welcome trigger; the resolved-report email in `updateBugReportV1`; the admin portal Send invite email flow (row action, confirm dialog with the copy-message fallback, invite status per row, email switch in Add person) and a read-only "Other emails from DIP" section in Your settings. Weekly theme, discovery and admin join emails are deferred with reasons. Nothing deployed, no email sent.

## Changes

- Email module: `domain/categories.ts` (`account`, `OutboxCategory`), `domain/outbox.ts` (`newOutboxData`, `locale`, `emailInviteOptOuts`), `domain/templates/{types,copy,render}.ts` and `i18n/{en,es}.ts` (three templates, steps, bold address, footer override, roster key helpers), `domain/unsubscribeToken.ts`, `application/{sendOutboxEmail,unsubscribe,enqueueEmail,ports,welcome}.ts`, `infrastructure/firestoreEmailStore.ts` (roster invitee reads, opt-outs), `transport/emailFunctions.ts` (`welcomeEmailOnMemberCreated`), `scripts/previewCases.ts`, `tools/emailCompat/checks.ts`.
- Admin module: `application/{roster,bugReports,accountEmails,ports}.ts`, `domain/{rosterView,errors,auditActions,auditSummaries}.ts`, `transport/adminCallables.ts`; `i18n/domain/errorMessages.ts`; exports in `index.ts`.
- Contracts (additive): `SendRosterInviteEmailRequest/Response`, `RosterEntry.inviteEmailCount/lastInviteEmailAt`, `ListRosterResponse.inviteEmail`; regenerated TS and Swift.
- Tests: `gcp/tests/unit/email-account.test.ts` (new), `email-templates.test.ts` filter, new golden snapshots en and es.
- Admin portal: roster page, AddPersonDialog, OtherEmails, UserSettings, adminTypes/Api/Live/Mock, inviteMessage, catalogs (roster, account, errors, audit), auditLabels, one style rule, tests.
- Docs: email-catalog.md (new), stretch/email.md, contracts/email.md and admin.md, ops/email-runbook.md (deploy list, section 12 manual test plan), CURRENT_STATE.md, STRETCH_GOALS.md.

## Validation

- `node --import tsx --test ../tests/unit/email-*.test.ts ../tests/unit/admin-*.test.ts ../tests/unit/i18n-audit-errors.test.ts ../tests/unit/notificationEmailPayloads.test.ts` (from gcp/functions): 530 pass, 0 fail, plus the new email-account suite 21 pass.
- `npm run check:email`: no errors. `npm run check:backend-i18n` and `npm run test:backend-i18n`: OK. `npm run check:admin-i18n`, `npm run test:admin-i18n`: OK. `npm run check:generated`, `npm run test:docs`: OK.
- `tsc --noEmit` in gcp/functions and apps/admin: clean. `eslint` on the touched portal files: clean.
- Portal vitest: AddPersonDialog, adminTools, auditLabels, backendMessages (50 pass).
- English golden snapshots unchanged (git shows only new snapshot files).
- Not run: `npm run test:contracts` (the shared node_modules lacks `ajv-formats` in this worktree; environment, not code), rules and emulator suites (targeted-tests rule), real sends.

## Decisions

- `account` category outside the shared preference registry (no rules, contract or iOS mirror change); member account emails stop only when every email category is off; roster invitees opt out per address.
- Roster invitation: only on an admin action, to the entry's own address (domain-validated at creation), 5 per entry an hour apart, inviter's language, outbox doc created inside the command transaction for exactly-once.
- Weekly theme email deferred: its category (`challenges`) defaults on, and a weekly fan-out must default off; needs a new shared category owned by the push workstream.
- Design review, emails: round 1 FAIL (390 clipping was a capture artifact of headless window sizing, fixed by device emulation; accepted: bold sign-in address, "Open DIP" label, dropped the welcome step that repeated the footer; rejected: shared button contrast, a locked brand decision). Round 2 FAIL (accepted: realistic long company sample, Spanish "listos"). Round 3 PASS; noted P2s rejected with reason: admins also use the app, so app steps stay in the admin welcome; Get DIP opens the site, which links the App Store.
- Design review, portal: round 1 FAIL (accepted: Spanish error key in the mock, stale toast cleared when the dialog opens, copy-message fallback as an outline button, Add and send invite label, Spanish double period, settings captured; rejected: 36 px small buttons on phones are the portal-wide size, and status notes growing a row is the existing roster pattern). Round 2 FAIL (accepted: shorter Spanish status note "Correo enviado 1×, último ..." so the Added column no longer wraps; rejected: shared Dialog button sizes and layout, which has only confirm and cancel slots, so the copy-message alternative stays an outline button in the body). Round 3 FAIL on one P2 (Spanish Added column wrapping in es-send-error-1440 and es-add-dialog-1440); those two shots were taken before the round 2 fix, and a fresh capture of es-send-error-1440 shows single-line dates and equal rows. Three rounds reached; no further round run.

## Handoff

- Owner: run docs/ops/email-runbook.md section 12 (and section 11 calendar checklist) with real mailboxes before any company gets email; deploy needs the new functions listed in section 7.
- Follow-ups: weekly theme email with a new default-off `weekly_themes` category (push workstream), discovery email when `event_interest` exists, a daily admin digest for joins, reminder emails could carry the venue (the scheduler passes only times).
- Contract tests need `ajv-formats` installed in the shared node_modules to run here.
