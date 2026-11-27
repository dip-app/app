# Admin portal: structure and content audit (November 2026 polish)

Owner: admin structure and content (page layouts, information architecture, kit structure and API, density, dynamic
content). The admin interaction and motion owner has hover/pressed/focus styling, motion, toasts, caching hooks in
`src/lib` and keyboard shortcuts; items for them are listed under "Handoffs" at the end.

Bar: the polish program quality bar (`docs/design/quality-bar.md`, added by the program lead). Review protocol: [design-review.md](../design-review.md).

## How the audit was done

- Mock mode (`next dev`, webpack), admin persona, Chrome headless through playwright-core, reduced motion,
  `America/New_York`. Full-page captures (the viewport grows to the height of `<main>`, which is the scroller).
- 21 screens at 1440, 1024, 768 and 390 px in English, plus 1440 and 390 px in Spanish: 126 captures. Screens:
  login, overview, events (upcoming, past), event new, event edit, attendees, album, members, member detail, roster,
  import, weekly themes, new theme, challenges, review, bug reports, audit log, Dipbot (step 1 and results), your
  settings.
- Three Sonnet sweeps read every capture (1440 en; 1024 and 768 en; 390 en and both Spanish sets) and returned
  measured findings; the author checked the P1s on the captures. No page scrolled the window horizontally at any
  width (only table regions scroll inside themselves).
- Captures stay in the session scratch directory (not committed); a few before and after images for the shipped fixes
  are in [img/](img/). File names below are `<screen>-<width>-<locale>.png`.

## Summary

The portal is clean and consistent in its small parts (buttons, chips, error alerts, skeletons) but the page level is
uneven, and it reads as static:

1. **Nothing says what changed.** Only Overview has a freshness label. No list shows relative time ("2 h ago"), no
   number has a delta, there is no activity feed, and Overview answers "last 30 days" when admins ask "this week"
   (usability study I10).
2. **Tables are display-only.** No sortable column anywhere, no remembered sort, the Events list has no search, and
   at 1024 px the Events table squeezes "When" to 38 px so one date runs 8 lines (P1).
3. **Detail pages do not name their object.** "Member", "Attendees", "Event album", "Edit event": the H1 is generic and
   the name sits in a card or muted text. Back navigation is a full outlined button drawn three ways ("All events",
   "All members", "Roster").
4. **Primary actions multiply.** Challenges shows five purple "Review submissions"; Roster up to five purple actions
   (header, banner, per-row). The kit rule is one primary per view.
5. **Mock data hides problems.** Four events (two upcoming), nine audit entries, every theme with exactly 13 pending,
   every attendee "Not checked in", one photo reused for every screenshot. Lists never get long enough to need sort,
   sticky headers or day grouping, and counts contradict each other (Overview 26 pending vs Challenges 13 per row).

## Findings, ranked

Severity: P1 broken or unusable, P2 clearly wrong or inconsistent, P3 polish. Effort: S (under 2 h), M (half a day),
L (a day or more). "Wave" is where the fix ships (see the plan below); "later" means proposed but not in this round.

### P1

| # | Finding | Evidence | Proposed change | Effort | Wave |
| --- | --- | --- | --- | --- | --- |
| S1 | Events table at 1024 px: "When" is 38 px wide and wraps to 8 lines (rows about 190 px); actions are cut at the table edge. Same squeeze on Challenges (Dates 3 lines, Review button off-screen at 768), Themes (Week 4 lines), Roster (Added 3 lines), Audit (Target and Details off-screen at 768). | events-1024-en, challenges-768-en, themes-1024-en, roster-1024-en, audit-768-en | Tables keep a readable minimum width and scroll inside their region instead of squeezing; date and time cells never wrap inside a value; the region shows an edge shadow while more columns are off-screen. Drop the "Price" and "Status" columns on Events in favor of a combined "Going" cell with the state (full, canceled) so the row needs fewer columns. | M | 1 |
| S2 | Bug reports at 768 px and below: the detail pane stacks under a 14-row list (about 1,800 px down); choosing a report shows nothing near the tap. | bug-reports-768-en, bug-reports-390-es | Below the two-pane breakpoint the list is the page and choosing a report shows the detail in place of the list with a "Back to reports" link (same URL state, `?id=`). | M | 3 |
| S3 | Challenges: five purple "Review submissions" buttons; every theme shows "13 pending", including past weeks, so the page and Overview contradict each other. | challenges-1440-en, overview-1440-en | One primary at most: the row with the most pending gets nothing special; every row action is outline, the current week stays first. Mock: submissions per theme vary (current week the most, one past week at 0). | S | 1 |

### P2: information architecture and page structure

| # | Finding | Evidence | Proposed change | Effort | Wave |
| --- | --- | --- | --- | --- | --- |
| S4 | Detail pages use a generic H1 ("Member", "Attendees", "Event album", "Edit event", "Review submissions"); the object's name is in a card or muted text, so the tab title and screen readers have no context. | member-detail-1440-en, event-attendees-1440-en, event-album-1440-en, event-edit-1440-en | `PageHeader` gets `back` (a small "‹ Events" link above the title) and `meta` (a line of facts under it). The H1 is the object: "Puppy Yoga", "Pat Member", "Fitness, Nov 23 to 29". The section is the eyebrow link. | M | 1 |
| S5 | Back navigation is a full outlined button in three spellings ("All events", "All members", "All themes", "Roster" on Import). | the same captures, import-1440-en | Replaced by the `back` link of S4 everywhere. | S | 1 |
| S6 | Roster: purple "Add person" in the header, purple "Add existing members" in the banner, purple "Send invite email" or "Invite again" in rows (up to five). Rows with actions are 4 px shorter than rows without. | roster-1440-en | Header keeps the one primary. The banner's button and every row action are outline. Rows share one height (actions are `sm` and centered). | S | 1 |
| S7 | Overview answers "last 30 days"; there is no "this week", no delta, no activity, and Needs attention leaves bug reports out (the largest queue, badge 10) while repeating the sidebar as "Shortcuts". | overview-1440-en, usability study I10 | A "Last 7 days" band from data the page can read without a backend change: RSVPs and photos (days -7..-1 against -14..-8 from `activity`, absolute change, a 14-day spark), events in the next 7 days with how many are going (`listEvents`), and this week's challenge (day N of 7, completed of joined). Needs attention, largest first: pending reviews per theme, new bug reports (admins, the badge's counts), invited not joined. Shortcuts go; the theme card's button becomes outline. "Recent activity" (admins): the latest audit entries with relative times, linking to the Audit log. | L | 2 |
| S8 | Overview on phones: Needs attention starts at y≈1060, below eight stat tiles. | overview-390-es | On phones the This week band and Needs attention come before the 30-day tiles. | S | 2 |
| S9 | Members and Roster list the same people; Challenges and Weekly themes list the same weeks; the nav item "Review submissions" opens a page titled "Challenges". | members, roster, themes, challenges at 1440 | Later (needs an IA decision with the owner): merge Roster into Members as an "Invitations" view, and Challenges into Weekly themes with a Pending column. This round renames the nav item to "Challenges". | S (label) / L (merge) | 1 (label), later |
| S10 | Edit and New event are 2,260 to 3,900 px tall with Save only at the bottom. | event-edit-1440-en, event-new-390-es | A sticky form footer (Save / Cancel and the draft status line) on the event and theme forms. | M | 3 |
| S11 | Member detail: the only purple button is "Adjust or reset" points; the right rail is prose around destructive buttons; no activity for the person. | member-detail-1440-en | Name in the H1 (S4), role chip and joined date in `meta`; "Adjust or reset" becomes outline; points card shows the balance with the label above. A per-person activity list is later (needs an audit query by target). | S | 3 |

### P2: density and tables

| # | Finding | Evidence | Proposed change | Effort | Wave |
| --- | --- | --- | --- | --- | --- |
| S12 | No sortable column anywhere; nothing remembers a sort. | every list | Kit `SortHeader` (a `th` with `aria-sort` and a button) and `useTableSort` (sort in the URL, the last choice remembered per list in this browser). Sorting is client side, so it is offered only where the whole list is loaded: Events, Themes, Challenges, Attendees, Audit log (latest 100). Members and Roster are paged on the server and stay in server order until the list callables take an order (a backend change, not made here). | M | 1 |
| S13 | Events list has no search and no context besides tab counts; four events in the mock. | events-1440-en | Search box (title, venue, description; `/` to focus) and sortable When, Event, Going. Mock showcase adds a dozen events across past and future with varied fill, prices and one full, so the list is long enough to judge. | M | 1 |
| S14 | Audit log: absolute time only; "Target" repeats "What happened" on several rows; actor wraps "(Organizer)" to a second line; only 9 entries. | audit-1440-en | Relative time with the absolute time as a tooltip; role under the name in muted type; the Target column shows the summary only when it adds something. Mock: about 40 entries over two weeks from several people. Sortable When and Who. | M | 1 |
| S15 | "Load more" touches its count ("Load moreShowing 25 of 30") and the count repeats the line above the table. | members-1440-en, roster-1440-en | The footer row has a gap; the count stays only above the table. | S | 1 |
| S16 | Members tabs have no counts while Roster's do. | members-1440-en | Later: the members page callable returns one total for the current filter only; counts per status need a server change. | – | later |
| S17 | Bug reports rows are about 130 px tall (two chip rows around the text); category and status chips look identical; triage controls are 800 px down the detail. | bug-reports-1440-en | Rows: one meta line (name, relative time, category) and the text clamped to two lines; status as the dot chip only when not "New"; screenshot and note as small icons. Triage (status, assignee) moves to the top of the detail. | M | 3 |
| S18 | Attendees: H1 does not name the event; 16 identical "Remove" outlined in red and disabled "Check in" buttons. | event-attendees-1440-en | S4 header. Row actions: "Check in" only when check-in is open, "Remove" as a quiet outline (red on hover, like other tables). Later: bulk check-in (needs a batch command). | S | 1 |
| S19 | **P1 (raised in review).** Members cards on phones are about 290 px with five label rows (about 7,000 px for 25 people); Roster is the same. | members-390-es | Shared phone row pattern for person tables: role and the exception status join the name line; teams and location share one muted line. | M | 1 |

### P2: Spanish and phone

| # | Finding | Evidence | Proposed change | Effort | Wave |
| --- | --- | --- | --- | --- | --- |
| S20 | Tab bars clip the last tab with no cue ("Desactivad…", "Resuelt…"). | roster-390-es, bug-reports-390-es | Tab rows scroll with an edge fade while more tabs are hidden. | S | 1 |
| S21 | Phone card label column (96 px) wraps "Lugar de trabajo" to two lines. | members-390-es | Moot for person tables after S19; other card tables keep the 96 px column (no change). | – | – |
| S22 | Search placeholders end in "(press / to focus)", truncated in Spanish and meaningless on touch. | members-390-es, roster-390-es, audit-390-es | The hint leaves the placeholder; the `/` shortcut is shown by the interaction owner's shortcut help (handoff). | S | 1 |

### P3

| # | Finding | Evidence | Proposed change | Effort | Wave |
| --- | --- | --- | --- | --- | --- |
| S23 | Settings: section titles (22 px) are larger than the page title; sections are a single long column of panels. | account-1440-en, account-768-en | Two-column settings layout on wide screens (section title and description on the left, controls on the right), titles at the panel size. | M | 3 |
| S24 | Album: one image repeated; 4/4/1 orphan rows at 768 and 1024. | event-album-1024-en | Later (mock photos only). | – | later |
| S25 | Import: steps look like buttons; "How it works" is 440 px of bullets on phones. | import-390-en | Later. | – | later |
| S26 | Overview Interests takes 40% of the phone page. | overview-390-es | Phones show the top 6 with "Show all". | S | 2 |
| S27 | Event form calendar help says "Click" and names Page Up/Down on touch. | event-edit-390-es | Handoff (interaction owner: keyboard hints). | – | handoff |

## Review of this audit

An independent Opus reviewer read the draft, the captures and the code before anything was built. Accepted:

- Members (and Roster) phone cards are P1, not P2 (S19): about 7,000 px for 25 people. The fix is a shared phone row
  pattern (name with role and status on one line, the rest on a second), which also makes S21 moot.
- Keep Price on Events; drop only Status (it repeats the tab) and fold Full and Canceled into the Going cell (S1).
- Audit sorting is by When only; Who would sort a truncated window of 100 and look complete (S12, S14).
- The identical "13 pending" mock is the P1 in S3; five primaries is P2.
- Rename the nav item "Review submissions" to "Challenges" instead of renaming the page (S9).
- Repeated status chips are noise: Members, Roster and Attendees mark exceptions only (Invited, Deactivated, Revoked,
  Checked in); a column that says "Active" 24 times says nothing. Text is kept, never color alone.
- The Overview band is "Last 7 days", compares days -7..-1 with -14..-8 (today is partial), shows absolute changes
  (no percentages on small numbers), and never builds a delta from a section the server marked unavailable. Spec in S7.
- One primary per view written out: Overview's theme card button becomes outline; Attendees keeps "Add attendee".
- New kit pieces go into `admin-components.md` in the same PR.
- `RelativeTime` uses `Intl.RelativeTimeFormat` inside `<time dateTime>` with the absolute time as its accessible
  name and tooltip.

Not accepted: "Bug reports detail does not stay in view at 1440" is a capture artifact. The pane is sticky inside the
scroller at 1001 px and up (`.bug-detail.review-detail`); the full-page capture grows the viewport to the page height,
so nothing can stick. Checked in a 900 px tall viewport.

Wave split: the reviewer asked to split wave 1. Kit, mock and list pages ship together (the kit cannot be judged
without pages using it), detail pages and forms move to wave 3, and Overview stays wave 2.

## Plan

Kit first, then pages. Each wave: before/after captures, fresh Opus reviewers until PASS (max 3 rounds), targeted
vitest/tsc/eslint and `npm run check:admin-i18n`, one PR.

1. **Wave 1, kit and lists.** `PageHeader` `back`/`meta`; `SortHeader` + `useTableSort`; `RelativeTime`; table
   region edge shadow and no-squeeze column rules; tab row scroll; list footer gap. Pages: Events (search, sort,
   fewer columns), Challenges (title, actions), Roster (actions), Audit (relative time, sort, columns), Attendees and
   Album and Member detail and Edit event and Review (headers). Mock: more events, varied pending, longer audit.
2. **Wave 2, Overview.** This week band with week-over-week deltas, Needs attention with bug reports, Recent activity,
   phone order, interests cap.
3. **Wave 3, detail and forms.** Bug reports rows and phone master/detail, sticky form footer, member detail,
   settings layout, phone member cards.

## Data and contracts

No backend contract changes in this round. Everything new is computed from data the portal already reads:
`activity` (30 daily points) for week-over-week, `listAudit` for the activity feed, `listBugReports` counts (already
fetched for the nav badge), `listEvents` for this week's events. Server-side sort and per-status member counts are
listed as later because they would change callables.

## Handoffs to the interaction and motion owner

- The `/` search shortcut hint leaves the search placeholders (S22); please surface it in the shortcut help.
- Review's keyboard legend and On/Off card take about 170 px on touch devices; hide on `(pointer: coarse)` or move
  into a help popover.
- Calendar help text in the event form names keys and "Click" on touch (S27).
- Sorting changes and filter changes should keep focus on the control that changed them (they do today; please keep
  it when adding transitions).

## Shipped: waves 1 and 2

One PR (kit, lists, detail headers, Overview, mock). Before and after:

| | Before | After |
| --- | --- | --- |
| Overview, 1440 | [overview-before.jpg](img/overview-before.jpg) | [overview-after.jpg](img/overview-after.jpg) |
| Events, 1024 | [events-1024-before.jpg](img/events-1024-before.jpg) | [events-1024-after.jpg](img/events-1024-after.jpg) |
| Members, 390, Spanish | [members-390-es-before.jpg](img/members-390-es-before.jpg) | [members-390-es-after.jpg](img/members-390-es-after.jpg) |
| Attendees, 1440 | | [attendees-after.jpg](img/attendees-after.jpg) |

Done: S1 (mid-width columns move into the row's sub line; actions pinned), S3, S4, S5, S6, S7, S8 (DOM order puts
Last 7 days and Needs attention first), S9 (nav label), S12, S13, S14, S15, S18, S19, S20, S21, S22. Design review: three
fresh Opus rounds; round 3's remaining P2s on mid-width tables were fixed and re-checked by the author; the rest is
listed under Open.

Open after this PR: S2, S10, S11, S17, S23 (wave 3); S16 and server-side sort (backend); S9 merges (decision);
S24 to S26; phone card patterns on Challenges, Themes and Attendees still use the label grid; Members and Review tabs
have no counts; the People card's "Total members" excludes invited people while the list above shows them.
