# Work session

User: sandervonk
Date: 2026-11-27
Workstream: ia-members-challenges
Agent: Claude (Opus), with Sonnet subagents for the copy sweeps and Opus design reviewers
Status: completed

## Summary

Two owner-approved information-architecture changes in the admin portal, plus the copy rename they imply across every surface.

1. **Roster merged into Members.** One Members page for everyone: All (people who joined, then a section "N invited people haven't joined yet"), Active, Invited, Deactivated, and Revoked (shown when there are revoked invites). The roster actions live there: Add person (primary), Import people (header link; Import is no longer a nav item and links back to Members), Send invite email, Get invite message, revoke, invite again, and the backfill banner. Invited people have no member record, so their name opens a details dialog (email, status and invite history, role, teams, location, department, title, added date) with the same actions. Organizers keep the read-only view (All, Active, Deactivated; no roster calls).
2. **Weekly themes and Challenges merged into Challenges.** One nav item and page with a Schedule tab (the former Weekly themes list; This week, Upcoming and Past are filter chips with counts) and a Review tab (`?tab=review`, the former Challenges list with pending counts; reviewers only). New challenge is the page's primary action; the editor moved to `/challenges/new/` and `/challenges/edit/`; the Dipbot button on the New challenge form is now "Suggest challenge".
3. **Copy.** User-visible "theme"/"weekly theme" became "challenge"/"weekly challenge" (es "reto"/"reto semanal") in the admin catalogs, email templates and subjects, push and in-app notices, typed errors, audit summaries, Dipbot copy and the iOS String Catalogs. Identifiers, routes params, collections, category keys (`weekly_themes`, `challenges`), callables and stored fields are unchanged.

## Changes

- Admin pages: `apps/admin/src/app/members/page.tsx` (rewritten), `app/challenges/page.tsx` (rewritten), `app/challenges/new/page.tsx` and `app/challenges/edit/page.tsx` (moved from `app/themes/`), redirect pages `app/roster/page.tsx`, `app/themes/page.tsx`, `app/themes/new/page.tsx`, `app/themes/edit/page.tsx`; `app/import/page.tsx` (back link, done button to Members); `app/challenges/review/page.tsx` (back to the Review tab).
- New components: `components/PeopleTables.tsx` (MemberTable, InviteTable), `components/InviteDialogs.tsx` (InvitedPersonDialog, ResendDialog moved from the roster page), `components/Redirect.tsx` (client redirect and the roster filter mapping).
- Shell navigation (Program: Events, Challenges, Dipbot; People: Members, which also lights up on Import), `lib/shortcuts.ts` (g t, g r, g p removed), `lib/insights.ts`, `ThemeCard`, `ThemeForm`, `Overview`, `OverviewWeek` links, `PageSkeletons` (schedule chips), styles (`structure.scss`, `pro.scss`).
- Catalogs en/es: members, roster (unused keys removed, details dialog, "company list" wording for the backfill banner), challenges, shell, importer, overview, plus the Sonnet sweep of ai, audit, errors, review, ui, drafts, account, memberDetail, themeForm. The form's picker field is "Illustration" (it picks cover art, not a challenge).
- Backend (Sonnet sweep): email and notification catalogs en/es, unsubscribe page, `errorMessages.ts` and matching literals, audit summaries, Dipbot reasons; email goldens regenerated (`weekly_theme`, `weekly_theme_plain`, `welcome_admin`, en and es).
- iOS (Sonnet sweep): two String Catalogs, Swift default values, test string assertions.
- Docs: admin-i18n, ios-i18n, email-catalog, push-catalog, backend-i18n, email-coverage, email-runbook, admin-structure (S9 done), ai-events, dipbot-suggest-theme, deploy-runbook, apps/admin/README, CURRENT_STATE.
- Tests: new `membersMerged`, `challengesMerged`, `redirects`; updated roster.i18n, insights, themes, ThemeSuggest, AddPersonDialog, OtherEmails, formDrafts, themeForm.i18n; `shellMock` renders the header actions.

## Validation

- Admin: `tsc --noEmit` clean, `eslint src` clean, `npm run check:admin-i18n` OK (2192 keys), `npm run test:admin-i18n` 12/12, targeted vitest (88 files touching members, roster, challenges, themes, overview, shell, skeletons, import) 785 tests passed, 2 skipped.
- Backend: `check:backend-i18n` OK, `test:backend-i18n` 4/4, `check:email` no errors, targeted gcp unit tests (email, push, notices, errors, audit, challenges, submissions, suggestions, AI) passed, `test:email:e2e` 23/23 (one earlier run failed once on the unrelated Spanish 24 h reminder test and passed on rerun).
- iOS: app (DIP scheme) and ComponentPreview built once each for the simulator under `/tmp/dip-sim-lock`; `ios:i18n-sync` then `check:ios-i18n` OK (1131 keys); DerivedData deleted.
- `npm run test:docs` OK.
- Design review: mock-mode captures of Members (all tabs and the invited details dialog), Challenges (Schedule, Upcoming, Review) and Import at 1440 and 390 px in en and es; review rounds are recorded under Decisions.

## Decisions

- All on Members means everyone: joined people (members callable) plus, for admins, the invited people below them (roster callable, search applies to both; the section steps aside while a role, team or location filter is set because the roster callable has none). Tab counts: All = member total + invited, Invited and Revoked from roster counts; Active and Deactivated show counts only while every member is on the roster (otherwise the roster counts would not match the list). Exact per-status member counts need a server change (listMembersV1 returns only the company total).
- Revoked stays as a fifth tab (only when there are revoked invites) so Invite again has a home.
- Phases inside Schedule are filter chips, not a second tablist.
- Suggest challenge stays on the New challenge form, where it fills the fields; it was renamed, not moved.
- The roster digest email ("Open the roster", `/admin/roster/`) is unchanged; its link now redirects to Members > Invited.
- Model prompts that still say "theme" were left alone (behavior change); listed in the PR.
- No "before" captures were taken (the old pages are gone in this branch); the review judged the after state.

Design review (fresh Opus reviewer per round, 40 captures per round: Members all tabs plus the invited details dialog, Challenges Schedule, Upcoming and Review, Import; 1440 and 390 px; en and es):
- Round 1 FAIL. Fixed: P1 Spanish phone header clipped "Agregar persona" (header actions now wrap on phones); P2 selected tab scrolled out of view on phones (Tabs keeps the selected tab in view, also after counts arrive); P2 result-count wording (one pattern: "Showing X of Y" when the total is known, "Showing the first N" otherwise, "(of N)" removed); P2 phone schedule cards misaligned (now laid out like the review cards); P2 invited dialog (Close instead of Cancel, email no longer repeated). Spanish "Nuevo reto". Rejected: Invited sharing the warn chip with Deactivated and Revoked (documented kit rule: exceptions keep the warn chip); "Get invite message" label (used in rows and toasts, unchanged); English goal units in Spanish (admin-entered content); back-link hit area (already 44 px on phones by CSS).
- Round 2 FAIL (no P1). Fixed: Deactivated and Active counts once the list is read to the end; selected filter chip restyled as a tint with outline (no longer looks like a second primary); goal values no longer wrap ("2 gatherings"); Spanish import "filas marcadas". Tried a Review tab total from the Overview insights.
- Round 3 FAIL (no P1, max rounds reached). Fixed after it: removed the Review tab total (insights' open total and the per-row first-page counts disagree in mock data; a matching total needs a server count). Still open, reported in the PR: status chips on the challenge rows mark the norm ("This week", "Past", "Upcoming"), pre-existing ChallengeRow and ThemeCard markup; Export CSV only on the joined tabs, so the Spanish header is one line taller there (tab row moves about 20 px between tab groups); a Deactivated count that appears after its list was read shifts the tabs to its right; P3s (dialog spacing, revoke date on revoked rows, Spanish "0 se unieron", "Errores" nav name, Import card gaps).

## Handoff

- Not deployed. Redirects are client-side (static export); a hosting-level 301 would need `firebase.json` rewrites (shared choke point, not changed).
- Server follow-ups (not made, no contract change): per-status counts on `listMembersV1`; role/team/location filters on `listRosterV1` so the All tab can keep invited people under those filters.
