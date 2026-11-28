# Work session

User: sandervonk
Date: 2026-11-27
Workstream: admin-polish-sweep
Agent: Claude (Opus), Sonnet design reviewers
Status: completed

## Summary

Admin portal polish sweep. It covers the leftovers from #376 and phone density on every list page, using shared kit pieces. It also includes a fresh audit of Overview, Events and the editor, Your settings, the Dipbot surfaces, Import and the Audit log at 1440/768/390/320 px in English and Spanish. The top P1 and P2 findings are fixed. Findings are ranked in `docs/design/polish-2026-11/admin-structure.md`, "Sweep audit, November 27".

## Changes

- Kit: `FilterBar` (`components/kit/FilterBar.tsx`). On phones it shows the search plus one Filters toggle with a count of the filters set. The fields fold out two per row, with Clear filters as the last cell.
- Kit: `HeaderMore` (`components/kit/HeaderMore.tsx`) and the `PageHeader`/`Shell` props `dense` and `more`. With these, a phone header is one row (title and actions, no subtitle), and secondary actions sit behind "More actions".
- Members, Events, Bug reports, Audit log and Challenges use them.
  - Bug reports drops its own filter toggle, its CSS and its "Clear filters" row.
  - Events puts its phone sort select behind "Sort".
  - Audit no-match gets a Clear action.
- Invite phone cards show the status chip and its history on the sub line. Revoked and invited cards no longer get a separate Status row.
- Challenges Review uses the Schedule's labels and value text: Week/Semana and Participation/Participación.
- Skeletons now follow the loaded layout:
  - Overview follows the new section order.
  - Events gets a filter bar ghost and compact phone cards.
  - Audit gets the real column labels and order, and compact phone cards.
- Overview's 7-day spark scales down at 320 px.
- Your settings holds the credits row while it loads.
- Events mid-width sub line puts the price first.
- Tighter phone card rhythm (Events, Audit).
- Dipbot email deep-link copy: "Open Dipbot", and a subtitle that fits the failure states.
- Tests:
  - kit tests for `FilterBar` and the dense header disclosure;
  - Skeleton order test;
  - challenge row wording;
  - the shell mock renders `more`.
- Docs: `docs/design/admin-components.md` (FilterBar, dense/more, phone list rules); `docs/design/polish-2026-11/admin-structure.md` (ranked sweep audit).

## Validation

Run in `apps/admin` unless noted:

- `npx tsc --noEmit`: pass.
- `npx eslint` on every touched ts/tsx file: pass.
- `npx vitest run` on kit, kit.guard, Skeleton, ChallengeRows, challengesMerged, membersMerged, membersAuditChallenges.i18n, bugs.i18n, roster.i18n, ui.i18n, UserSettings and a11y: all pass.
- `npm run check:admin-i18n` (repo root): pass.
- Design review rounds are recorded in the PR description.

## Decisions

- On phones, list pages leave out the page subtitle; wider screens keep it. The list's first row matters more on a phone, and the descriptions are explanatory, not needed to act.
- Secondary header actions use a disclosure ("More actions"), not a menu. This is the same pattern as `Dialog` `more`, and it needs no roving focus.
- The Filters toggle label stays "Filters" when open (`aria-expanded` carries the state). The old "Hide filters" label changed the button width.
- Rejected audit items are listed in the audit table with reasons: form max width, back-link hit area, alert action indent.

## Handoff

Still open:

- Dipbot phone layout: the wizard sits below "Ideas for you" (A12).
- One kit stepper (A13).
- Dipbot option truncation (A17).
- The P3 list in A18.

Nothing deployed. No backend, contract or iOS changes.
