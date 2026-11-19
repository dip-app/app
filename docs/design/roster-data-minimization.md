# Roster data minimization and team import

Owner decisions (November 19): "Don't store anything not used." and "I would prefer new teams not break things." This page records
the field audit behind the first decision and how imports create teams for the second. Contracts: [admin.md](../contracts/admin.md#bulk-import-importrun),
[data-ownership.md](../contracts/data-ownership.md).

## Field audit

Every field on the import template (CSV/XLSX), the roster entry (`companies/{c}/roster/{sha256(email)}`), the admin fields of
`users/{uid}` and the update, import and summary contracts. "Reads" means a feature uses the value: iOS UI, admin UI display or
filter, emails, push, Dipbot/AI tools, rules, reporting/CSV exports or the roster claim. Evidence is from `grep -rn` over `ui/`,
`apps/admin/src`, `gcp/functions/src` (generated models excluded) and `gcp/firestore.rules` on this branch.

| Field | Who reads it (evidence) | Decision |
| --- | --- | --- |
| `email` | Roster id (`emailHash`), import matching (`findMemberByEmail`), roster claim (`resolveMembershipV1`), invite emails (`sendRosterInviteEmailV1`), admin member and roster lists, members CSV export (`apps/admin/src/lib/exports.ts`) | Keep |
| `displayName` | iOS profile, participants and invites; admin lists; roster hint used at claim when Google has no name (`accounts/domain/membership.ts`) | Keep |
| `role` | Permissions (`admin/domain/permissions.ts`), Firestore rules (`organizer()`, `adminOf()`), iOS `AppUser.role`, admin lists and filters | Keep |
| `teams` / `teamIds` | Admin members list filter (`members/page.tsx` `teamId`), member detail editor, members CSV export (`teams` column), roster rows; copied at claim | Keep |
| `department` | iOS profile header and edit (`ProfileHeaderCard.swift`, `DIPProfileScreen.swift`), participants subtitle (`DIPParticipantsScreen.swift`), RSVP snapshot (`participation/domain/profileSnapshot.ts`), coworker search (`invites/application/listCoworkers.ts`), suggestions catalog, admin attendees table and CSV export, member detail | Keep |
| `jobTitle` | iOS profile About row and edit (`ProfileHeaderCard.swift`), RSVP snapshot `userJobTitle` (`FirebaseParticipationSource.swift`), admin attendees table and CSV export, member detail | Keep |
| `workLocation` | Admin members list column and location filter (`members/page.tsx`), member detail editor, members CSV export (`work location`) | Keep (admin-only use, but used) |
| `managerEmail` | Nothing. No iOS, admin display, email, push, Dipbot, permission, rule condition or export reads it. It was written by import, `updateMemberV1`, the roster claim and the roster backfill, and only echoed back by summaries. It is also a third party's email. | **Removed** |
| `startDate` | Nothing (the many `startDate` hits are challenge, theme and calendar dates, not the employee field). Written by the same paths as `managerEmail`, never read. | **Removed** |
| Roster bookkeeping (`status`, `source`, `importJobId`, `invitedBy`, `claimedBy`, `claimedAt`, `memberStatus`, `resendCount`, `lastResentAt`, `inviteEmailCount`, `lastInviteEmailAt`, `revision`, timestamps) | Roster list states and counts, resend and invite-email limits, optimistic concurrency, audit | Keep (operational, not personal data beyond the email) |
| `users/{uid}` `status`, `revision`, `statusUpdatedAt` | Deactivation in rules and callables, member detail concurrency | Keep |

### What removing a field means

For `managerEmail` and `startDate`:

- **Template and portal:** gone from `IMPORT_FIELDS`, the template, the column matcher, browser validation and its error strings
  (`import.err.manager`, `import.err.startDate`), `import.field.*` labels (en, es), Add person, roster rows and the mock adapter.
  A file that still has those columns (or their aliases "Manager", "Reports to", "Supervisor", "Start date", "Hire date", "Join
  date") imports normally: the columns are recognized, never sent, offered as "Skip (DIP doesn't use this column)" and listed in
  the preview as "Ignored columns: managerEmail (not used)". A saved column mapping that still names them falls back to skip.
- **Server:** `EmployeeRecord`, `memberPatch`, `newEntryFields`, `updateMemberV1`, member summaries, roster view, roster claim
  (domain and Firestore store) and `backfillRoster` no longer read or write them. Old payloads still work: the keys stay allowed
  in `EmployeeRecordInput` and `UpdateMemberRequest` (marked deprecated) and are ignored without validation; an import row notes
  them (`notices`, `FIELD_IGNORED`). A guard test (`gcp/tests/unit/admin-team-import.test.ts`) fails if any import, roster,
  member or backfill write sets either field on a profile or roster document, even over legacy documents that still hold one.
- **Contracts:** removed from `AppUser`, `RosterEntry` and `AdminMemberSummary`; kept as deprecated, ignored inputs. The generated
  Swift `AppUser` loses two optional properties: decoding ignores unknown keys and no iOS code reads or sets them, so shipped and
  current iOS builds are unaffected (`swift test` in `ui/Packages/DIPContracts` passes).
- **Rules:** unchanged on purpose. `validProfile` still lists both keys so a legacy profile that holds one stays updatable by its
  owner. Clients could never write them (the update allow-list excludes them). Drop the keys from `validProfile` once the cleanup
  below has been applied in every project.
- **Existing data:** `gcp/scripts/remove-unused-roster-fields.ts` (dry run by default, counts only, `--apply --yes-owner-approved`
  for a live project, deletes only these two fields with a last-update-time precondition, idempotent, not undoable: export
  Firestore first). Dry run on team05-dip, November 19: 6 profiles and 5 roster entries scanned, **0** documents hold either field.
  Not applied.

## Teams in imports and Add person

Unknown team names never fail a row (the old `TEAM_NOT_FOUND` "Unknown team" row error is gone; `updateMemberV1`, which picks
team ids from the catalog, still refuses a missing or archived id).

- **Matching:** each name is trimmed with inner whitespace collapsed, then matched by team id, then case- and accent-insensitively
  by name (NFKD, marks removed, lower case): "platform", " PLATFORM " and "Plätform" all match "Platform". An active team wins
  over an archived one with the same name.
- **New teams:** an unknown name gets the id `team_` + the first 32 hex characters of SHA-256 of the normalized name, under the
  company's own `teams` collection. The same name always maps to the same document, so a rerun, two concurrent imports and Add
  person converge on one team; a team renamed after an import is still found by that id and is never duplicated or overwritten.
  The first spelling seen becomes the team's name.
- **When:** the dry run writes nothing and lists `newTeams`. Applying a row creates its missing teams in the row's own transaction
  (reads first, then writes; same fields as `upsertTeamV1`; audit `team.upsert` with `summaryKey: "team.create"` and a
  deterministic id), so only rows that actually apply create teams. `upsertRosterEntryV1` (Add person, re-invite) creates them in
  its transaction too. The roster entry stores team ids, so a person who signs in later gets the created teams through the claim.
- **Limits:** names over 80 characters, more than 50 new teams in one import, or a company total of 500 teams (checked when
  planning and again with a count when applying) leave that team out; an archived team is left out too. The row still imports
  without the team, and the plan lists the name in `skippedTeams` and the row's `notices`. Invalid rows never take a slot.
- **Portal:** the preview shows "N new teams to create: “Platform”, “Mentors”." as a calm notice, one warning notice per skip
  reason (names quoted, at most six spelled out), and "Ignored columns: … (not used)". The result shows "Created N new teams: …"
  from `progress.teamsCreated`. The rules panel says team names replace a person's current teams and unknown names become teams.
- **Additive wire fields:** `ImportEmployeesResponse.newTeams`, `.skippedTeams`, `ImportRowPlan.notices`,
  `ImportProgress.teamsCreated`, `ImportJob.newTeams` (all optional). Totals are unchanged.

## Row numbers

The preview column and the error CSV say "Row" ("Fila"; CSV header `row`), not "Line". The number is the spreadsheet row the admin
sees (blank lines and rows above the header count), and the preview says which row is the header ("The header is row 1.").
Duplicate messages read "Duplicate of row 2."

## Design review

Three reviewer rounds on mock-mode screenshots at 1440 and 390 px, English and Spanish (new teams with ignored columns, the
over-limit file, confirm, result, column matching). Changes made because of the review: a clipped over-long name now ends in an
ellipsis; skip notices carry counts, quote names and say the rows still import; the new-teams notice states the number of teams so
it is not confused with the "To create" people tile; fewer names are spelled out (six, then "and N more"); the "not used" hint moved
into the skip option so mapping rows keep one height; the teams hint now reads "Separate several teams with semicolons"; the rules
note that teams replace current teams. Round 3 still returned FAIL on items owned by shared components (36 to 38 px toolbar and
dialog buttons on phones, the stepper showing only the active label on phones, the select width growing with the longer skip
label); these are recorded for the shared kit and not changed here.
