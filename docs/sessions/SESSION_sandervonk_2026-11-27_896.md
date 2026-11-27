# Work session

User: sandervonk
Date: 2026-11-27
Workstream: members-phone-layout
Agent: Claude (Opus)
Status: completed

## Summary

Phone-width layout fixes for the admin portal Members page, the open P3s from session 894 (PR #372): the company-list banner, "Clear filters" on its own row, the invited-person dialog's two action rows and the clipped tab strip. Swept Challenges (Schedule, Review) and Import at 390 and 320 px in English and Spanish for the same class of issue. Admin portal only; no backend, contract or iOS change.

## Changes

- Members banner (`app/members/page.tsx`, `pro.scss`): the explanation sentence is a `.banner-detail` span hidden at 700 px and below; phones show the headline and "Add them to the list" (44 px). Height at 390: 159 -> 94 px; at 320: 179 -> 115 px. The backfill confirm dialog already says what adding changes (Active, same role and teams, nobody emailed).
- Clear filters (`app/members/page.tsx`, `pro.scss`): now the filter grid's last cell (`.filters-clear`, md button bottom-aligned with the selects). Phones: beside Work location, full width of its cell, so no extra row.
- Dialog secondary actions (`components/Dialog.tsx`, `components/InviteDialogs.tsx`, `pro.scss`): new `more` prop. Wide: confirm, Cancel, then the secondary buttons (all 36 px, wrapping left-aligned in Spanish). Phones: confirm full width, Cancel and a "More actions" toggle (aria-expanded/controls, chevron) on one row, the toggle reveals Get invite message and Revoke invite full width (44 px). Invited-person dialog uses it instead of a body action row. `.pill-btn.gray.quiet-danger` gives the red label at any size.
- Dialog overflow at 320 (pre-existing): `.dialog` gets `grid-template-columns: minmax(0, 1fr)` and the `.facts` value column `minmax(0, 1fr)` with `overflow-wrap: anywhere`, so a long email no longer pushes the dialog past the screen.
- Tabs (`components/Tabs.tsx`, `structure.scss`): the background scroll-shadow (drawn under the text, so tabs looked hard-cut) is replaced by a CSS mask that fades the row out over 40 px on each side that has more tabs (`data-more-start` / `data-more-end`, measured on scroll, resize and label changes). The selected tab is scrolled clear of the fade. Bug reports dropped its own `.tabs-fade` wrapper (now redundant; CSS removed from `_admin.scss`).
- Challenges Schedule chips: at 480 px and below chips use 8 px padding, so This week / Upcoming / Past stay on one row at 320 in Spanish (before: "Pasados" wrapped alone).
- Spanish filter defaults: "Todos los roles/equipos/lugares" -> "Todos" (the label above names the field), so the selects are not truncated at 320.
- Strings: `common.dialog.moreActions` ("More actions" / "Más acciones").
- Tests: `Tabs.test.tsx` (overflow markers), `Dialog.test.tsx` (`more` toggle, no toggle without it), `membersMerged.test.tsx` (dialog secondary actions in the action row, Clear filters inside the filter row).
- Docs: `docs/design/admin-components.md` (tab fade, Dialog `more`, `.filters-clear`).

## Validation

- `npx tsc --noEmit` (apps/admin): pass.
- `npx eslint` on the touched TS/TSX files: pass.
- `npx vitest run` Tabs, Dialog, membersMerged, roster.i18n, bugs.i18n, kit.guard, a11y, membersAuditChallenges.i18n, challengesMerged: 9 files, 55 tests pass.
- `npm run check:admin-i18n`: pass.
- Headless Chrome (CDP), mock mode, viewport captures at 1440, 390 and 320, en and es, before and after: Members All, filtered, Invited, Revoked, invited dialog (closed and with More actions open), Challenges Schedule / Past / Review, Import. DOM measurements: no horizontal page scroll anywhere; every phone button and chip 44 px; desktop dialog buttons 36 px.
- Not run (targeted-tests rule): full admin suite, `npm run check`, rules and Swift tests. No Xcode build (no app code).

## Decisions

- Tab strip: kept the scrolling tab row with an edge fade rather than a select at narrow widths. Tabs keep every status and its count one tap away and behave like every other tabbed page (Challenges, Bug reports); a select would hide the counts. The fade is a mask over the text, so a cut-off tab dissolves into the edge instead of looking clipped.
- Banner: shortened on phones instead of collapsible; the follow-up confirm dialog carries the reassurance, so nothing is lost before anything changes.
- Dialog secondary actions: a "More actions" disclosure in the action row rather than a popup menu (no menu component exists; a disclosure needs no focus management inside the modal).
- Design review (fresh Sonnet reviewer per round, protocol in docs/design/design-review.md):
  - Round 1 FAIL (no P1). Fixed P2: Spanish select defaults truncated at 320 ("Todos"). Rejected: phone buttons "about 42 px" (measured 44 px in the DOM); tab clipping (the fade is the intended affordance); revoked card's Status row, import step circles, English mock goal units (pre-existing or mock data); dialog moves up when More actions opens (it is centered; acceptable).
  - Round 2 FAIL (no P1). Fixed P2: desktop dialog mixed button heights (secondary buttons now md, 36 px) and, found while fixing, the red Revoke label lost at md size (`quiet-danger` rule now size-independent). Rejected: banner on every tab (#372 decision: tabs must not jump); email wrapping mid-address in a 320 dialog (better than overflowing; acceptable); Week/Dates label mismatch between Schedule and Review, active-tab colour guess (pre-existing / not reproduced).
  - Round 3 PASS (P3s only: desktop vs phone button order, email wrap, Revoked tab off-screen until scrolled, first card below ~620 px on phones, import step circles, mock data in English).

## Handoff

- PR open to main, not merged or deployed.
- Open P3s for a later pass: Members phones show the first person around y=640 (header buttons, banner, tabs, search and three filters); the revoked phone card's "Status" row; Schedule vs Review field labels (Week/Dates, Participation/Participants); bug reports still has its own "Clear filters" row (`.clear-filters`) and could adopt `.filters-clear`.
- Dev server and headless Chrome were stopped; node_modules symlinks removed.
