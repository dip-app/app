# Work session

User: sandervonk
Date: 2026-11-19
Workstream: roster-minimization
Agent: Claude (Opus)
Status: completed

## Summary

Roster data minimization and team import. Audited every roster/import/profile field (table in docs/design/roster-data-minimization.md): `managerEmail` and `startDate` were stored but never read, so they were removed end to end; old files and old portals that still send them are accepted and ignored. Unknown team names in imports and Add person now create teams (case- and accent-insensitive matching, deterministic ids, 50 new per import, 500 per company, over-limit names left out with a notice) instead of failing rows. The import preview table column is now "Row"/"Fila" (CSV header `row`) with a hint naming the header row. Added gcp/scripts/remove-unused-roster-fields.ts and ran its dry run on team05-dip (0 documents with the fields). Nothing deployed or applied.

## Changes

- Backend: new `admin/domain/teamNames.ts` (normalization, deterministic ids, `TeamResolver` with caps) and `admin/application/teams.ts` (live re-check and creation inside the row transaction); `employee.ts` (removed fields, ignored legacy keys with `FIELD_IGNORED` notices, team resolution without errors), `importPlan.ts` (shared resolver, `newTeams`/`skippedTeams`/`notices`, team names in preview changes, `teamsCreated` tallies), `importEmployees.ts`, `roster.ts` (Add person creates teams), `members.ts`/`requests.ts` (updateMember ignores the legacy keys), `member.ts`, `rosterView.ts`, `backfillRoster.ts`, accounts claim (domain and Firestore store).
- Contract: removed the two fields from `AppUser`, `RosterEntry`, `AdminMemberSummary`; deprecated (ignored) in `EmployeeRecordInput` and `UpdateMemberRequest`; additive `ImportNewTeam`, `ImportSkippedTeam`, `ImportEmployeesResponse.newTeams/skippedTeams`, `ImportRowPlan.notices`, `ImportProgress.teamsCreated`, `ImportJob.newTeams`; regenerated TS and Swift.
- Portal: `IMPORT_FIELDS`, template, column matcher (retired headers recognized, shown as not used), validation, Add person, live and mock adapters, Import page notices (new teams, skipped teams, ignored columns), result "Created N new teams", confirm text, Row column and hint, error CSV header, en/es catalogs.
- Tests: new gcp/tests/unit/admin-team-import.test.ts (create once, idempotent rerun, concurrency, case/accent, per-import and company caps at plan and apply, renamed team, tenant isolation, roster claim gets team ids, legacy columns, old payloads, removed-field write guard); updated roster/import, roster claim, contract and portal tests.
- Script: gcp/scripts/remove-unused-roster-fields.ts. Docs: roster-data-minimization.md (new), admin.md, data-ownership.md, seed-data.md, CURRENT_STATE.md.

## Validation

- `npx tsc --noEmit` in gcp/functions and apps/admin: pass.
- `node --import tsx --test` admin-team-import, admin-roster-import, accounts-roster-claim, accounts-resolve-membership, admin-members, i18n-audit-errors: 135 pass.
- `npx vitest run` importMapping, importer.i18n, adminTools (+ memberDetail.i18n earlier): pass. `npx eslint` on touched portal files: clean (gcp/functions has no ESLint config).
- `npm run check:generated`, `check:admin-i18n`, `check:backend-i18n`, `test:docs`: pass.
- `swift test` in ui/Packages/DIPContracts: pass.
- contracts/tests/admin.test.mjs: pass (run from a scratch copy with a local ajv-formats shim because the shared node_modules lacks `ajv-formats`; other contract files were not judged there).
- Rules unchanged, so the rules emulator suite was not run.
- Dry run `node --import tsx gcp/scripts/remove-unused-roster-fields.ts --project team05-dip` (ADC, read-only): users scanned 6, roster entries scanned 5, documents with removed fields 0.

## Decisions

- Removed `managerEmail` and `startDate` (no reader anywhere); kept `workLocation` (admin list column, filter, member editor, CSV export), `department`, `jobTitle`, `teams`, `role`, `displayName`, `email`.
- Rules keep both keys in `validProfile` until the cleanup is applied in every project, so a legacy profile stays updatable; clients still cannot write them.
- Request schemas keep the keys as deprecated/ignored for cached portals; stored-document schemas drop them. Swift decoding is unaffected.
- Team id `team_<32 hex of sha256(normalized name)>`; teams are created at apply time in the row transaction (only rows that apply create teams); company cap rechecked with a count at apply; archived teams are left out rather than failing the row; `updateMemberV1` keeps `TEAM_NOT_FOUND` because it picks ids from the catalog.
- Design review (3 rounds, fresh Sonnet reviewers): accepted ellipsis for clipped names, counts and quoted names in notices, team count in the new-teams notice, six names then "and N more", skip-option label instead of an extra hint line, clearer teams hint, "teams replace current teams" rule. Round 3 still FAIL on shared-kit items (phone button height 36 to 38 px, stepper labels on phones, select width); left for the shared kit.

## Handoff

- Not applied: run the cleanup with `--apply --yes-owner-approved` only after owner approval (the dry run found nothing in team05-dip), then drop the two keys from `validProfile` with a rules emulator run.
- DEFERRED EMAILS agent: import result shape is additive (`newTeams`, `skippedTeams`, `progress.teamsCreated`, `ImportJob.newTeams`).
- iOS agent: generated Swift `AppUser` lost optional `managerEmail`/`startDate`; nothing in ui/ used them and DIPContracts tests pass.
- apps/admin/.next (about 150 MB) was produced by the screenshot dev server and can be deleted.
