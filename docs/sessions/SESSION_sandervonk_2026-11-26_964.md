# Work session

User: sandervonk
Date: 2026-11-26
Workstream: admin-structure-2
Agent: Claude (Opus), admin structure and content owner
Status: completed

## Summary

Wave 3 of docs/design/polish-2026-11/admin-structure.md, stacked on the waves 1 and 2 PR: bug reports layout, a sticky
Save bar on the long forms, the settings layout, and a member detail touch-up. Captured before and after in mock mode
and ran two fresh Opus review rounds.

## Changes

- Bug reports (S2, S17): rows are who and when (status chip only when not New, relative time), the text clamped to two
  lines, and one muted line of facts (category, screenshot, note, assignee) instead of two rows of chips (rows about
  100 px instead of 130 px). Triage moved right after "What they wrote". Below 1001 px a chosen report replaces the list
  and "‹ All reports" (now a back link) clears the choice; with no choice only the list shows. "View full size" keeps
  its label centered at 44 px; "No changes to save" sits under its buttons.
- Event and theme forms (S10): the Save row is a bar stuck to the bottom of the page scroller (`.actions.form-footer`),
  full-bleed, hugging its buttons; pages with it drop the scroller's bottom padding. The "Members see it" note moved
  above the bar; the draft status line sits inline in it. Phone header order fixed for pages with a back link and a
  compact header action (New event, New theme).
- Your settings (S23): section titles at panel size; from 1200 px the title and description sit in a left column beside
  the controls, separated by hairlines; the language select is capped at 420 px; the weekly email panels use the full
  column.
- Member detail (S11): the card heading is "Details" (the page header names the person).
- Catalog: `bugs.item.assignedTo`, `memberDetail.profileTitle` (en, es).

## Validation

- `tsc --noEmit` and `eslint src` (apps/admin): clean. `npm run check:admin-i18n`: OK, 2179 keys.
- Targeted vitest (11 files, 66 tests): bugs i18n, bugReports, editor i18n, themeForm i18n, UserSettings, formDrafts,
  a11y, memberDetail i18n, kit guard, LanguageSettings, OtherEmails. All pass.
- Design review: round 1 FAIL (bar too tall, helper text inside the bar, phone header order, settings right edges,
  Spanish tab clipping, Filters button width), round 2 FAIL on one P2 ("View full size" label on phones), which was
  fixed and checked by the author on a new capture; no third round was run.

## Decisions

- The sticky bar background extends sideways with a border-image outset so it spans the scroller without a layout
  change; the scroller's bottom padding is dropped on pages that have the bar instead of painting over it (the first
  version left a 72 px white band under the buttons).
- Not changed (out of scope or pre-existing): the bug reports filter row and its Filters button width, the Spanish tab
  strip on phones (it scrolls with an edge fade from wave 1), toggle row offsets inside the weekly email card,
  "Next email" wrapping between time and AM/PM, member detail card spacing.

## Handoff

- Remaining from the audit: S9 merges (owner decision), S16 and server-side sort for paged lists (backend), S24 to S26,
  phone card patterns for Challenges, Themes and Attendees, Members and Review tab counts.
- Interaction owner: sticky bar has no transition; back links' 44 px hit areas use padding on coarse pointers (wave 1).
