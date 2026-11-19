# Work session

User: sandervonk
Date: 2026-11-18
Workstream: admin-usability-study
Agent: Claude (Opus 5.5), participants Sonnet 5.5
Status: completed

## Summary

Admin portal fixes from the November usability study (simulated participants; study documents in their own PR under
docs/research/admin-usability-study-2026-11/). Built after a design-auditor review of each candidate fix, audited
again on before/after screenshots at 1440 and 390 (round 1 FAIL on four items, fixed, round 2 PASS), then re-tested
with fresh participant agents. Rebased on #333 (plain-language errors) before building; no overlap with that work.

## Changes

- Event editor (`EventForm.tsx`): new kit `ErrorSummary` lists every error as a link (replaces "Fix N fields to
  continue."), focused on submit; "Everything is required unless it says optional.", "(optional)" on Tags and Price;
  line under Create event ("Members see it in the app as soon as you create it. You can edit or cancel it later.");
  Enter in a text field never submits; editing a field clears its error.
- Dipbot banner copy: "Dipbot filled this in. Nothing is saved yet. ..."; create-failed copy no longer says "draft".
- `WhenPicker`: the first click sets a one-day event at once; a later day extends it; leaving the calendar or using
  the dial ends the range step. Help and summary copy updated.
- `AddressCombobox`: Enter never submits while the popup is open, never in pick-only (office) mode; office-specific
  empty message. Mock `fake.ts`: a typed street address is offered as a suggestion and resolves by id.
- Roster: "Add person" dialog (`AddPersonDialog.tsx`) runs the import dry run and apply for one row; refuses rows that
  would update an existing entry. "Resend invite" is now "Get invite message"; misleading toast removed; copy updates.
- Your settings: Language first; weekly email scope copy no longer contradicts itself; test result is a toast;
  buttons keep focus (`loading`, `aria-disabled`).
- Review submissions: after Approve or Request changes, focus moves to the next person's heading with a status line.
- Phone cover library: no inner scroller; six tiles plus "Show more covers". Dipbot step tabs size to their label.
- Overview: "29 can sign in" instead of "29 active accounts"; mock seeds review queues so counts match.
- Shared: InlineNotice error text is a div (holds a list); `.header-action` is a flex row with a gap;
  `.pill-btn[aria-disabled]` style. Docs: admin-components.md (ErrorSummary), apps/admin README.

## Validation

- `npx tsc --noEmit`, `npx eslint src` (apps/admin): pass.
- `node --import tsx scripts/admin-i18n/check.ts` (same as `npm run check:admin-i18n`): "Admin i18n OK: 2033 keys".
- Targeted vitest, 19 files, 228 tests pass (WhenPicker, AddressCombobox, kit, kit.guard, UserSettings, roster.i18n,
  review.i18n, CoverPicker, AddPersonDialog (new), Where, Dialog, Overview.i18n, events.i18n, location, submissions,
  adminTools, suggestions, insights, i18n). Full suites not run (owner preference: targeted tests only).
- Not run: `npm run check`, rules and Swift tests (no backend or app changes), the static build.

## Decisions

- Recorded in docs/research/admin-usability-study-2026-11/decisions.md. Rejected: a draft/unpublished event state
  (contract), sending invite email (product), an office settings page (new surface), Overview weekly range (needs
  aggregates), Dipbot retry feedback (left to the #333 error work).
- Add person reuses the import callables; no new endpoint or contract change.

## Handoff

- Not re-tested with participants (agents stopped by an API safety filter): Review focus, weekly email copy and
  toast, phone cover library, the office-manager and phone personas. They rest on the audit and unit tests.
- Open: Members has no link to Add person; Dipbot "Try again" gives no feedback; required-field note is easy to miss.
- Spanish strings added here are drafts like the rest of the catalog and need a native review.
