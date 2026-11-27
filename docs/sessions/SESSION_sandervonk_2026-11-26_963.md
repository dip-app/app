# Work session

User: sandervonk
Date: 2026-11-26
Workstream: admin-structure-1
Agent: Claude (Opus), admin structure and content owner
Status: completed

## Summary

Admin portal structure and content polish, waves 1 and 2 of docs/design/polish-2026-11/admin-structure.md.
Audited every page in mock mode (126 captures: 21 screens at 1440, 1024, 768 and 390 px in English, 1440 and 390
in Spanish) with three Sonnet sweeps, had an Opus reviewer critique the audit before building, then built the kit
pieces and the list pages (wave 1) and the Overview's "what changed and what is next" (wave 2). Wave 3 (bug reports
layout, sticky form footer, settings layout) is the next PR.

## Changes

- Audit and plan: docs/design/polish-2026-11/admin-structure.md (ranked findings S1 to S27, the reviewer's critique and
  what was accepted or rejected, the wave plan, handoffs to the interaction owner).
- Kit: PageHeader `back`, `eyebrow`, `meta`; Shell props for them and `useShellHeader` so a detail page names its object
  once loaded; `SortHeader`, `SortSelect`, `useTableSort`, `sortRows` (sort in the URL, last choice remembered per list);
  `RelativeTime` with a shared minute clock; TableRegion edge shadows; SearchBox `shortcut` key cap (the "/" hint left
  the placeholders); LoadMore `hideCount`. New stylesheet apps/admin/src/styles/structure.scss (loaded after pro.scss).
- Lists: Events (search, sortable columns, a phone sort select, day and time on two lines, Status column folded into
  Going, sticky row actions, mid-width sub line); Members and Roster (exceptions-only status chips, compact phone cards,
  mid-width sub line, outline row actions, one count); Audit log (sort by time, day groups, relative times today,
  compact phone cards); Challenges (outline review links, nav item renamed to "Challenges"); Weekly themes (no-wrap
  week, mid-width columns).
- Detail pages: Attendees, Album, Member, Edit event and Review name their object in the h1 with a back link and a
  facts line; the "All events / All members / All themes" buttons are gone; New and Edit event and theme have a back
  link. Attendees shows check-in buttons only once check-in opens and outline everywhere.
- Overview: "Last 7 days" band (RSVPs and photos against the 7 days before with a 14-day spark, events held, this
  week's challenge), Needs attention gains new bug reports (from the nav badge's existing fetch), "Coming up" (next two
  weeks), "Recent activity" for admins (audit log), a "Last 30 days" heading over the existing tiles; the theme card's
  button is outline.
- Mock (showcase only for events): 12 more events, review queues that differ per week, 20 more audit entries.
- Tests: lib/__tests__/overviewWeek.test.ts (new helpers), components/__tests__/shellMock.tsx (Shell stand-in with the
  header hook), updated memberDetail, review and OverviewRefresh tests.

## Validation

- `npx tsc --noEmit -p apps/admin`: clean.
- `npx eslint src` in apps/admin: clean.
- `npm run check:admin-i18n`: OK, 2177 keys in en and es.
- Targeted vitest: kit, kit.guard, TableRegion, ChallengeRows, members/audit/challenges, roster, attendees and album,
  member detail, review, events i18n, adminTools, api, a11y, Shell.scroll, ui i18n, importer, editor, submissions,
  bugReports, Skeleton, bugs i18n, Overview i18n, OverviewRefresh, OverviewUnavailable, insights, ActivityChart,
  InterestsCard, overviewWeek: all pass. No full suite (owner rule: targeted tests only).
- Design review: fresh Opus reviewers on before/after captures, three rounds (see Decisions).

## Decisions

- Audit critique accepted: phone person cards raised to P1; Price kept on Events; audit sorted by time only (the log
  is the latest 100, sorting by person would look complete and is not); "Last 7 days" not "This week"; absolute
  changes, no percentages; nav renamed instead of the page. Rejected: "bug detail does not stay in view at 1440" (it is
  sticky; the full-page capture grows the viewport, so nothing can stick).
- Members and Roster are server-paged, so they are not sortable in the browser; server order needs a callable change
  and is listed as later in the audit.
- Review round 1 (FAIL): fixed inconsistent table overflow (sticky row actions everywhere), phone sort, bloated Events
  and Audit phone cards, small header links on touch, duplicate counts, "Cancelled" spelling. Rejected: translating
  mock audit summaries (server content by design).
- Review round 2 (FAIL): fixed columns hidden behind the sideways scroll at 1024 and 768 (secondary columns move into
  the row's sub line at 701 to 1279 px), Spanish truncation in Coming up, dots starting wrapped lines, audit phone
  times matching desktop, the Details button in the audit card corner, the member page's second primary. Kept the
  Overview's stacked rows below 1100 px (two panels of 340 px were too narrow for Coming up rows).
- Review round 3 (FAIL, the last allowed round): fixed key columns still covered by the pinned actions at 1024 and
  768 (tables drop their minimum width at mid widths; Challenges moves Dates into the sub line), Audit targets
  overflowing at 768, the Needs attention badge alignment, the Top events meta size, and the Spanish going count
  ("asistirán" everywhere). Re-checked by the author on new 1024 and 768 captures (Events, Challenges, Themes, Audit).
  Left open and listed in the PR: Members and Review tabs without counts and Members/Roster without sorting (server
  paging), the People card's total (pre-existing: invited people are roster entries, not members), mixed phone card
  patterns on Challenges, Themes and Attendees, and English number grouping in the Spanish Overview.
- No backend contract changed. The Overview's new numbers come from data the portal already reads.

## Handoff

- Rebased on main after #356 (admin motion and interaction states). Conflicts in `app/layout.tsx` (both stylesheets kept:
  structure.scss loads before interaction.scss so states layer over layout) and `Ui.tsx` LoadMore (their spinner button
  kept, the `hideCount` option kept). Targeted vitest re-run after the rebase: 54 files, 445 tests pass.
- Rebased again after #358 (data cache). Events and Attendees conflicts resolved on the cached `useLoad`: Events keeps
  its search and sort over the cached list (no direct fetch), Attendees keeps the optimistic check-in (`rows`,
  `busyIds`, `data-member`) inside the named frame. The optimistic check-in test now uses the shared Shell stand-in
  (`useShellHeader`), and the facts line tolerates an event without a venue. Targeted vitest: 57 files, 463 tests pass.
- Rebased again after #362 (code splitting and keyboard shortcuts): Shell keeps both the KeyboardShortcuts mount and
  the detail header; the shell catalogs keep both the `shell.keys.*` keys and `shell.docTitleDetail`. The "/" key cap in
  list searches (and its `aria-keyshortcuts`) now follows the one single-key shortcuts switch (`useShortcutsEnabled`),
  so it disappears when shortcuts are off. Targeted vitest: 58 files, 470 tests pass.
- From the interaction owner's requests (docs/design/polish-2026-11/admin-interaction.md): the Events, Members, Roster
  and Weekly themes tab panels are now keyed by the selected tab, so their shared reveal can fade a new panel in (the
  review and bug report panels are not keyed: they keep the selection and scroll). Not done here: the layout shift on
  Account and Roster (tab counts arriving) and the catalogs and cover library loaded on every page; they are listed as
  open for the next structure pass.

- Wave 3 (next PR): bug reports rows and phone master/detail (S2, S17), sticky form footer on the event and theme
  forms (S10), member detail layout (S11), settings two-column layout (S23).
- Later (need a decision or a backend change): merge Roster into Members and Challenges into Weekly themes (S9),
  per-status member counts and server-side sort for paged lists (S12, S16), bulk check-in.
- Interaction owner: the "/" shortcut now shows as a key cap in list searches; Review's keyboard legend on touch,
  the event form's calendar help on touch, keeping focus on a sort header after sorting.
