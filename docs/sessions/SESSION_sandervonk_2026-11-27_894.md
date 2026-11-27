# Work session

User: sandervonk
Date: 2026-11-27
Workstream: members-followups
Agent: Claude (Opus), with fresh Sonnet design reviewers
Status: completed

## Summary

Follow-ups from PR #370 (Members and Challenges merges): exact server counts for every Members tab, an exact open-review total on the Challenges Review tab, role/team/location filters on the roster listing, hosting 301 redirects for the moved portal pages, the roster digest email linking Members, and the design-review leftovers.

## Changes

- Contract (additive, optional, v1): `ListMembersResponse.statusCounts` (new `MemberStatusCounts {active, deactivated}`), `ListRosterRequest.role|teamId|workLocation`, `ListChallengeSubmissionsResponse.total`. `contracts/v1/models.schema.json` plus regenerated `gcp/functions/src/generated/models.ts` and `ui/Packages/DIPContracts/Sources/DIPContracts/Models.swift`.
- Backend: `admin/application/members.ts` (first page counts total, deactivated and invited users by aggregation; active = total - deactivated - invited, the `statusOf` rule), `admin/domain/requests.ts` and `admin/domain/rosterView.ts` (roster filters, same semantics as the member filters), `submissions/application/{ports,submissionCommands}.ts` and `submissions/infrastructure/firestoreSubmissionStore.ts` (`count()` aggregation; first page returns `total`). Email: `ROSTER_URL` replaced by `MEMBERS_URL` (`/admin/members/`), CTA "Open Members" / "Abrir Miembros"; `admin_digest*` goldens regenerated (en, es).
- Hosting: `firebase.json` redirects (301) `/admin/roster{,/}` -> `/admin/members/?status=invited`, `/admin/themes{,/}` -> `/admin/challenges/`, `/admin/themes/new{,/}` -> `/admin/challenges/new/`. `/admin/themes/edit/` keeps only the client redirect because it needs its `?id`, which a hosting redirect may not carry. Client redirect pages stay as fallback. Members reads a leftover `?filter=` (old Roster link) once and maps it to `status`.
- Admin portal:
  - Members: tab counts from `statusCounts` and roster counts, shown together once both first pages are in (no tab shifting, no more "count after reading the list"). Role/team/location filters on every tab and passed to the roster callable, so the invited section stays under All with filters. Export CSV on every tab (Invited/Revoked export `invited.csv` / `revoked.csv`), so the header never changes between tabs. Revoked rows and the details dialog show "Revoked {date}" (the entry's last change). The company-list banner shows on every tab. "Showing X of Y people who joined" on All when invited people are listed below.
  - Challenges: Review tab label carries the sum of the exact per-challenge pending totals (same numbers as the rows; falls back to "25+" and no total against an older server). No chip on normal phases: Status column removed from Schedule, phase chip removed from Review rows. "Current" filter chip is now "This week" / "Esta semana".
  - P3s: dialog action rows no longer get page-section bottom padding, 44 px dialog buttons on phones, Spanish "0 se unieron" -> ICU plural ("Nadie se unió"), Spanish nav "Errores" -> "Reportes" (page title "Reportes de errores"), Spanish Members subtitle shortened. `TableRegion` re-measures its edge shadow once web fonts load.
- Docs: `docs/contracts/admin.md`, `docs/contracts/challenge-submissions.md`, `docs/design/email-catalog.md`, `docs/ops/email-runbook.md`, `CURRENT_STATE.md`.
- Tests: `gcp/tests/unit/admin-portal-gaps.test.ts` (status counts incl. organizer, later pages, tenant isolation, cross-company and no-caller/deactivated denial; roster filters, validation, company-wide counts, cross-company denial), `challenge-submissions.test.ts` (totals, tenant isolation), `email-optin.test.ts`; admin `membersMerged`, `challengesMerged`, `ChallengeRows`, `membersAuditChallenges.i18n`, `bugs.i18n`, new `lib/__tests__/exports.test.ts`; `scripts/tests/test_hosting_share_links.py` (redirects).

## Validation

- gcp: `tsc --noEmit` clean; `node --import tsx --test` on admin-portal-gaps, challenge-submissions, admin-members, admin-audit-fixes, admin-avatars, admin-permissions (104 pass), email-templates (111 pass, goldens regenerated with `UPDATE_EMAIL_SNAPSHOTS=1`) and email-optin (131 pass with templates).
- `npm run check:generated`, `check:admin-i18n` (2194 keys), `test:admin-i18n`, `check:backend-i18n`, `test:backend-i18n` (4/4), `check:email` (no errors).
- Admin: `tsc --noEmit` and `eslint src` clean; targeted vitest 23 files, 186 tests pass.
- `python3 -m unittest scripts/tests/test_hosting_share_links.py scripts/tests/test_launch_config.py` (23 OK).
- Not run: `test:contracts` (the main checkout's node_modules, symlinked here, lacks `ajv-formats`; the schema change is optional fields only), `test:rules` (no rules change), full suites (owner rule).

## Decisions

- Counts: `statusCounts` lives on `listMembersV1` (member.read), so organizers get exact Active/Deactivated counts too; Invited/Revoked stay on the roster counts (roster.manage). Counts are company-wide, never narrowed by filters.
- Review total: exact per-challenge `total` on `listChallengeSubmissionsV1`'s first page, summed in the portal, rather than the cached insights total, so the tab and rows can never disagree.
- Revoke date: from `updatedAt` of a revoked entry (no new stored field).
- Design review (fresh Sonnet reviewer each round, 48 mock captures: Members all tabs, filtered All, invited and revoked dialogs, Challenges Schedule/Upcoming/Past/Review; 1440 and 390; en and es):
  - Round 1 FAIL (no P1). Fixed: "Current" chip -> "This week"; "Showing 25 of 30" next to "All (33)" -> "... who joined"; 44 px dialog buttons on phones. Rejected: three pending states in Review are three meanings (warn chip when entries wait, muted 0, "Not open yet" before the week); 0-pending rows keep Review (approved/rejected entries are there); row affordance, phone tab strip clipping, admin-entered English data (pre-existing or by design).
  - Round 2 FAIL (no P1). The card-edge gradient on phone cards was a capture artifact (full-page capture re-lays out the page; a viewport capture of the same state shows none); later rounds capture the viewport only. Fixed: company-list banner on every tab (tabs no longer jump), shorter Spanish subtitle. Rejected: "Active" contrast (`--muted` is 7.6:1), different joined/invited column sets (different data).
  - Round 3 FAIL (no P1; review limit reached). Rejected: "Active" contrast again (the token is `--muted` #4b4f66, 7.6:1 on white, measured from the token, not the image) and plain Active text next to chips (documented kit rule: the norm is plain text, exceptions get the chip). Open P3s, not fixed: the company-list banner takes about 160 px on phones on every tab; "Clear filters" on its own row; bold selected chips change width by a few px; the revoked phone card shows a "Status" label row; the dialog splits secondary and primary actions into two rows; tab strip clipping on phones.

## Handoff

- Not deployed. Deploying needs the functions (`listMembersV1`, `listRosterV1`, `listChallengeSubmissionsV1`), hosting and the email change together; the portal tolerates an older server (no counts, "25+").
- Not verified against a deployed site: whether Hosting carries the old query string (`?filter=`, `?q=`, `?phase=`) over to the redirect target. If it does, Members maps an old `filter` and Challenges keeps `phase`; if not, the 301 lands on the default view. Check with a preview channel before relying on it.
