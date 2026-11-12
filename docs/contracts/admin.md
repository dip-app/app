# Admin backend contract (V2)

Server-side contract for the admin portal: roles and permissions, the append-only audit log, event album moderation, attendee management, member management, bulk import and roster pre-provisioning. It extends [callables](callables.md) and [data ownership](data-ownership.md); schemas live in `contracts/v1/models.schema.json` (additions only, `contractVersion: 1`). Implementation: `gcp/functions/src/modules/admin` (thin callable adapters, application services, pure domain logic, Firestore/Storage/Auth adapters). Nothing here is deployed.

## Conventions shared by every admin callable

- Firebase v2 `onCall`, region `us-central1`, App Check enforced everywhere except the official Functions emulator.
- Caller = verified Google user (`google.com`, `email_verified`). Identity comes only from the Auth token. The caller's company, role and status come from the server-owned `users/{uid}` document **inside the command's transaction**. The `companyId` in the payload is only a sanity check that must equal the caller's company (else `permission-denied` `COMPANY_MISMATCH`); it never grants access.
- A member with `status == "deactivated"` is refused everywhere (`ACCOUNT_DEACTIVATED`).
- Permission is checked first, before any target resource is read, so a non-admin or another tenant learns nothing about existence.
- Requests are strict: unknown keys, wrong `contractVersion`, malformed ids, trimmed-string and length violations fail `invalid-argument` `VALIDATION_FAILED` with `fields`.
- **Idempotency.** Every mutating command takes `requestId` (8..128 chars `[A-Za-z0-9_-]`, a UUID is recommended, retained across retries). A private receipt `companies/{c}/commandReceipts/admin_{uid}_{requestId}` stores `{command, hash, response, expireAt}` and is written in the command's transaction. Same key + same command + same payload returns the stored response; same key with different content fails `failed-precondition` `REQUEST_REUSED`. Commands are also state-convergent where natural (removing a missing photo returns `removed: false`). `recordAttendanceV1`, `listMembersV1`, `listRosterV1`, `getMemberV1`, `getEmployeeImportV1` and `applyEmployeeImportV1` have no `requestId` (state-based, see below).
- **Audit.** Every mutating admin command appends one `companies/{c}/auditLog/{auditId}` document in the same transaction (see below). Replays do not append a second entry.
- **Rate limit.** Per-caller fixed window in `adminRateLimits/{uid}` (server-only): 120 calls/minute; exceeded -> `resource-exhausted` `RATE_LIMITED`.
- Errors use `HttpsError(code, message, { reason, fields? })`, no internals. Unknown reasons fall back to the code.

### Error reasons

| code | reasons |
|---|---|
| unauthenticated | `UNAUTHENTICATED` |
| invalid-argument | `VALIDATION_FAILED` (with `fields`), `TEAM_NOT_FOUND` (unknown or archived team in an edit), `EMAIL_DOMAIN_MISMATCH`, `IMPORT_TOO_LARGE` |
| permission-denied | `EMAIL_NOT_VERIFIED`, `PROVIDER_NOT_ALLOWED`, `INSUFFICIENT_ROLE`, `COMPANY_MISMATCH`, `ACCOUNT_DEACTIVATED`, `MEMBERSHIP_CONFLICT` (caller has no membership) |
| not-found | `BUG_REPORT_NOT_FOUND` (also for another company's report), `ASSIGNEE_NOT_FOUND`, `EVENT_NOT_FOUND`, `MEMBER_NOT_FOUND` (also for a user of another company), `ROSTER_ENTRY_NOT_FOUND`, `IMPORT_JOB_NOT_FOUND`, `TEAM_NOT_FOUND` (upsert of an unknown teamId) |
| failed-precondition | `ROSTER_ENTRY_CLAIMED` (resend for someone who already signed in), `ROSTER_ENTRY_NOT_INVITED` (resend for a revoked entry), `REQUEST_REUSED`, `EVENT_CLOSED` (cancelled or ended), `EVENT_NOT_STARTED`, `NOT_GOING`, `LAST_ADMIN`, `CANNOT_DEACTIVATE_SELF`, `ATTENDANCE_LOCKED`, `INSUFFICIENT_POINTS`, `EMAIL_ALREADY_MEMBER`, `IMPORT_PLAN_MISMATCH`, `IMPORT_NOT_PLANNED` |
| resource-exhausted | `EVENT_FULL` (no `capacityOverrideReason`, or capacity already 10000), `RATE_LIMITED`, `RESEND_LIMIT` (an invite was already resent 10 times) |
| aborted | `REVISION_CONFLICT`, `IMPORT_JOB_BUSY` |
| internal | `INVALID_STORED_DATA` (generic message) |

## Roles and permission matrix

`users/{uid}.role` is `member` | `organizer` | `admin` (`organizer` is an additive value; existing `admin` accounts keep working). Matrix, enforced server-side by `can(role, permission)` in the callables and mirrored in Firestore rules for direct reads:

| Permission | Callables / data | member | organizer | admin |
|---|---|---|---|---|
| `event.manage` | `createEventV1`, `updateEventV1`, cancelled-event reads | no | yes | yes |
| `attendee.manage` | `addEventAttendeeV1`, `removeEventAttendeeV1` | no | yes | yes |
| `attendance.record` | `recordAttendanceV1` | no | yes | yes |
| `album.moderate` | `removeEventPhotoV1`, `removeEventPhotoCommentV1` | no | yes | yes |
| `member.read` | `listMembersV1`, `getMemberV1` (points only for admin) | no | yes | yes |
| `member.manage` | `updateMemberV1`, `resetMemberProfileV1`, `setMemberStatusV1`, `adjustMemberPointsV1` | no | no | yes |
| `team.manage` | `upsertTeamV1` | no | no | yes |
| `roster.manage` | `upsertRosterEntryV1`, `revokeRosterEntryV1`, `resendRosterInviteV1`, `listRosterV1`, `backfillRosterV1`, roster reads | no | no | yes |
| `import.run` | `importEmployeesV1`, `applyEmployeeImportV1`, `getEmployeeImportV1`, import job reads | no | no | yes |
| `audit.read` | `companies/{c}/auditLog` reads | no | no | yes |
| `bugreport.manage` | `listBugReportsV1`, `getBugReportV1`, `updateBugReportV1` | no | no | yes |
| `challenge.manage` | `createChallengeV1`, `updateChallengeV1` | no | admin only today (challenges module not yet migrated to `can`) | yes |

Only an admin can create another admin or organizer (through `updateMemberV1`, a roster entry or an import). The last admin of a company can never be demoted or deactivated. Clients cannot write `role`, `status`, `teamIds`, `workLocation`, counts, balances or ledger entries (rules allow-list, unchanged).

## Data model additions (all additive)

- `users/{uid}`: `workLocation` (string), `teamIds` (string[] <= 20), `status` (`invited` | `active` | `deactivated`, missing = active; `invited` is used by roster entries, members are `active`/`deactivated`), optional `managerEmail`, `startDate` (YYYY-MM-DD), `revision` (>= 1, incremented by admin edits), `statusUpdatedAt`. All server-owned: the own-profile rule allow-list is unchanged, so clients cannot write them.
- `companies/{c}/teams/{teamId}` (`Team`): `name`, `archived`, `revision`, timestamps. Same-company members read (get/list <= 100); written only by `upsertTeamV1`.
- `companies/{c}/bugReportTriage/{reportId}`: server-owned triage state of a shake-to-report document (`status` `new` | `triaged` | `resolved`, `note` <= 2000, optional `assigneeId`/`assigneeName`, `revision`, `updatedAt`, `updatedBy`, `updatedByName`); created by the first `updateBugReportV1`, a missing document means `new`. Clients have no access at all (rules deny read and write, admins included); the client-created `bugReports/{reportId}` documents stay immutable.
- `companies/{c}/auditLog/{auditId}` (`AuditEntry`): append-only, server-written, admin-readable (get/list limit <= 100, order by `createdAt`).
- `companies/{c}/roster/{emailHash}` (`RosterEntry`): admin-readable only; id is the lower-case hex SHA-256 of the lower-case email.
- `companies/{c}/importJobs/{jobId}` (`ImportJob`): admin-readable; `importJobs/{jobId}/chunks/{n}` (plan rows) server-only.
- `companies/{c}/pointTransactions/{id}`: ledger (`PointTransaction`), server-only writes; admin adjustments use id `adjust_{uid}_{requestId}`.
- RSVP additive optional `source` (`self` | `admin`) and `managedBy`; `RecordAttendanceRequest.checkedIn?`; `ResolveMembershipResponse.role` also `organizer`.

### Audit entry shape

```
AuditEntry {
  companyId, actorId, actorName, actorRole,          // from the caller's membership, never the payload
  action,        // "photo.remove" | "photo.comment.remove" | "attendee.add" | "attendee.remove" | "attendance.record"
                 // | "member.update" | "member.reset" | "member.status" | "points.adjust" | "team.upsert"
                 // | "roster.upsert" | "roster.revoke" | "roster.claim" | "import.plan" | "import.apply"
  targetType,    // member | event | photo | comment | attendee | roster | import | team | company | points
  targetId,      // uid, "{eventId}/{photoId}", emailHash, jobId ...
  summary,       // <= 280 chars, human readable, no secrets
  changes: [{ field, before, after }],   // <= 30 short string summaries, nullable
  reason?, requestId?, createdAt (server time)
}
```

Id is `{actorId}_{requestId}` (deterministic, so a replay never duplicates); multi-entry commands add a suffix. `roster.claim` is written by `resolveMembershipV1` with actor = the claiming member.

## Callables

All carry `contractVersion: 1`, `companyId` and (mutations) `requestId`. Shapes are the schema definitions of the same name.

### Album moderation (album.moderate)

- `removeEventPhotoV1` `{eventId, photoId, reason?}` -> `{photoId, removed, commentsRemoved, objectRemoved}`. Transaction: authorize, read the photo (missing -> idempotent `removed:false`), delete the photo document, up to 400 comments, write audit + receipt. After commit it deletes remaining comments in batches and the Storage object (`companies/{c}/events/{e}/photos/{uploader}/{slot}`; `ignoreNotFound`), which frees the member's create-only slot. A replay re-runs the idempotent cleanup. Decision: hard delete (no undo window); the audit entry keeps uploader, path and caption snapshot. Rules still deny client deletes.
- `removeEventPhotoCommentV1` `{eventId, photoId, commentId, reason?}` -> `{commentId, removed, commentCount}`. Deletes the comment and recounts `commentCount` in the same transaction.
- Album viewing needs no callable: same-company reads of `photos`, `photos/{id}/comments` and the Storage objects are already allowed.

### Attendee management (attendee.manage, attendance.record)

- `addEventAttendeeV1` `{eventId, userId, notify?, capacityOverrideReason?}`. Target must be an active member of the caller's company (else `MEMBER_NOT_FOUND`), event `scheduled` and not ended (`EVENT_CLOSED`). Already going -> `added:false`. Full -> `EVENT_FULL` unless `capacityOverrideReason` (3..200): capacity becomes `attendeeCount + 1` (event `revision` + 1, audited, `attendeeCount <= capacity` stays invariant; refused above 10000). Creates/updates the RSVP like `setRsvpV1` (snapshots, `eventStartTime`, `source: "admin"`, `managedBy`), increments `attendeeCount`; the existing `onRsvpChanged` trigger creates the default notification subscription. `notify` writes `users/{uid}/notifications/admin_{requestId}` (`type: "attendee_added"`).
- `removeEventAttendeeV1` `{eventId, userId, reason?, notify?}`. Going RSVP -> `cancelled`, count decremented (never below 0), attendance fields kept. Not going -> `removed:false`.
- `recordAttendanceV1` `{eventId, userId, checkedIn? = true}` -> `{eventId, userId, pointsAwarded, checkedIn, changed}`. Requires a `going` RSVP and `startTime <= now` (`EVENT_NOT_STARTED`). Sets `checkedIn`, `checkedInAt` (server time) once and, if `pointsValue > 0`, appends the ledger entry `attendance_{eventId}_{uid}` and increases `pointsBalance` in the same transaction (repeat awards 0). `checkedIn:false` (no-show) is refused with `ATTENDANCE_LOCKED` after points were awarded (no reversal flow yet). No `requestId`: the command converges on state.

### Event completion (`updateEventV1`, event.manage)

`UpdateEventRequest.status` is now `scheduled` | `cancelled` | `completed`, plus optional `statusReason` (3..200). Organizers and admins may mark a **scheduled** event **completed** once it has ended (`EVENT_NOT_ENDED` otherwise; a cancelled event cannot be completed: `STATUS_TRANSITION_BLOCKED`). Leaving `completed` (back to `scheduled` or to `cancelled`) is free while the album has no photos; once any album photo exists only an `admin` with a `statusReason` may do it, otherwise `failed-precondition` `STATUS_TRANSITION_BLOCKED` with `fields: ["status","statusReason"]`. Attendance (`recordAttendanceV1`) and album moderation work on completed events; adding or removing attendees follows the usual not-ended rule. `updateEventV1` also accepts the `organizer` role.

### Member management (member.read / member.manage)

- `listMembersV1` `{query?, role?, status?, teamId?, workLocation?, pageSize? (<= 100, default 50), pageToken?}` -> `{members: AdminMemberSummary[], nextPageToken?}`. Server scans `users` of the caller's company in document-id order (up to 1000 documents per call), filters in memory, and returns the id cursor, so no composite index is needed. A page can be short (even empty) while `nextPageToken` is present: clients keep following it, so any company size pages without a cap. The first page (no `pageToken`) also returns `total`, the exact member count, for "N of M"; `pointsBalance` is returned to admins only. `getMemberV1 {userId}` returns one summary. These replace company-wide private-profile reads (rules stay self-only).
- `updateMemberV1` `{userId, expectedRevision?, role?, teamIds?, workLocation?, department?, jobTitle?, managerEmail?, startDate?}` -> `{userId, revision, changedFields}`. Teams must exist and not be archived. Role changes: cannot demote the last admin. `displayName`, `email`, `companyId`, points and auth ids are never editable. Updates `department`/`jobTitle` also refresh RSVP snapshots through the existing `onUserProfileUpdated` trigger.
- `resetMemberProfileV1` `{userId, reason?}` -> `{userId, resetFields, revision}`: `photoURL=""`, `avatarId=""`, `city=""`, `interestTagIds=[]`, `travelRadiusMiles=20`, `availability=[]`, `favoritePhotoIds=[]`. Identity, role, department, jobTitle, teams, location, status, friends and points stay.
- `setMemberStatusV1` `{userId, status, reason?}` -> `{userId, status, changed, rsvpsCancelled, revision}`. Deactivation: cannot target self (`CANNOT_DEACTIVATE_SELF`) or the last active admin (`LAST_ADMIN`); sets `status`/`statusUpdatedAt`, revokes the member's Firebase refresh tokens, cancels up to 200 upcoming `going` RSVPs (frees seats, decrements counts), and from then on `resolveMembershipV1` (`ACCOUNT_DEACTIVATED`), Firestore rules (`sameCompany`) and callables refuse the member. Reactivation sets `status: "active"`.
- `adjustMemberPointsV1` `{userId, delta, reason}` -> `{userId, pointsBalance, applied}`: ledger entry `adjust_{uid}_{requestId}` + balance in one transaction; the balance may not go negative (`INSUFFICIENT_POINTS`).
- `upsertTeamV1` `{teamId?, name, archived?}` -> `{teamId, created, revision}` (names unique case-insensitively within a company).

### Roster pre-provisioning (roster.manage)

- Model: `RosterEntry` at `companies/{c}/roster/{sha256(lower(email))}` with `status` `invited` (pre-imported, not signed in) -> `claimed` (signed in) | `revoked`; `memberStatus` (`active` | `deactivated`) mirrors the member once claimed. **The roster lists everyone**: pre-imported people and every person who ever joined (`source` `manual` | `import` | `signup`). Only emails within the company's `emailDomain` (registrable root, subdomains allowed as in `resolveMembershipV1`) are accepted (`EMAIL_DOMAIN_MISMATCH`).
- `upsertRosterEntryV1 {entry: EmployeeRecordInput}` -> `{entryId, created, status}`. An email that already belongs to a member -> `EMAIL_ALREADY_MEMBER` (use `updateMemberV1`). A revoked entry is re-invited. A claimed entry always has a member with that email, so it is refused the same way.
- `revokeRosterEntryV1 {entryId}` -> `{entryId, status, changed}`. Claimed entries are unaffected (revoke the member instead).
- **Listing**: `listRosterV1 {state?, query?, pageSize? (<= 100, default 50), pageToken?}` -> `{entries: RosterEntry[], nextPageToken?, counts?}` pages the roster in document-id order (bounded scan of 1000 per call, in-memory filter by `state` invited/active/deactivated/revoked and a case-insensitive substring of name, email, department, job title or location, same short-page rule as `listMembersV1`); the first page returns exact `counts` per state via aggregate queries. The portal uses it; direct Firestore reads (below) stay allowed by rules. Original description: one direct Firestore read of `companies/{c}/roster` (admin-only rules, `limit <= 100`, order by `email` or document id) shows everyone: `invited` entries have not signed in, `claimed` entries have a member (`claimedBy` = uid; `memberStatus` active/deactivated). Search and filters run client-side over the pages; use `listMembersV1` / `getMemberV1` for points and fresh member detail.
- `resendRosterInviteV1 {entryId}` -> `{entryId, status: "invited", resendCount, lastResentAt, signInUrl, message}`. DIP sends no email, so "resend" **records the event** (`resendCount`, `lastResentAt`, `lastResentBy` on the entry, audit `roster.resend`) and returns the sign-in link (`https://letsdip.work` for members, `https://letsdip.work/admin/` for organizers and admins) with a ready message the admin copies and sends through their own channel. Only `invited` entries (`ROSTER_ENTRY_CLAIMED` / `ROSTER_ENTRY_NOT_INVITED` otherwise), at most 10 per entry (`RESEND_LIMIT`), idempotent per `requestId` (a replay returns the stored response and does not count twice), admin only, rate limited with the other admin commands.
- `backfillRosterV1 {dryRun, pageToken?}` -> `{dryRun, scanned, created, existing, skipped, nextPageToken?, done}`. Production-safe backfill of claimed roster entries for existing members that have none. One call handles 100 members after the cursor in a single transaction; `dryRun: true` only counts (`created` = would create, writes nothing, no audit); a real call creates the missing entries (`status: claimed`, `source: signup`, member attributes copied), never touches an existing entry (invited, claimed or revoked), writes one `roster.backfill` audit entry per call and is idempotent (replayed `requestId` returns the stored response; a re-run creates 0). The portal runs the dry run over all chunks, shows the summary and asks for confirmation before the real run. Written for the owner to run after authorization; nothing runs it automatically.
- **There is no roster-only mode.** Anyone whose verified Google email matches the company's `emailDomain` joins, as today. The roster only pre-fills attributes.
- **Joining** in `resolveMembershipV1` (first verified Google sign-in, no `users/{uid}` yet): in the same transaction the server reads `roster/{sha256(email)}` (stored `email` must equal the verified token email) and records the join: an `invited` entry **claims** (member gets the entry's `role`, `teamIds`, `workLocation`, `department`, `jobTitle`, `managerEmail`, `startDate`; display name: Google's name, else the roster hint; entry -> `claimed`, `claimedBy`, `claimedAt`; `roster.claim` audit entry); no entry **creates** a `claimed` entry (`source: "signup"`, default member attributes) so the roster always lists everyone; a `revoked` (or otherwise unusable) entry never grants its role: the person joins as a default member and the entry is **overwritten** with the real member. Returning members change nothing. Spoofed or unverified emails are rejected by the existing provider/verification checks before any read.
- **Kept in sync**: `updateMemberV1` and the import mirror role, teams and org attributes onto the member's claimed entry; `setMemberStatusV1` mirrors `memberStatus`. Display-name refreshes are not mirrored.
- **Backfill**: production uses `backfillRosterV1` above. The emulator script: `gcp/functions/src/modules/admin/application/backfillRoster.ts` creates a claimed entry for every existing member without one (idempotent, never touches existing entries); `gcp/scripts/backfill-roster.ts` wraps it and refuses to run unless `FIRESTORE_EMULATOR_HOST` is a local emulator. Until `backfillRosterV1` is run, a signed-in member without an entry does not appear on the roster list; the portal compares the member total with the roster counts and offers "Add existing members to the roster".

### Bulk import (import.run)

- Client parses CSV/XLSX and submits at most 2000 `EmployeeRecordInput` rows (template columns: `email, displayName, role, teams, department, jobTitle, workLocation, managerEmail, startDate`; `teams` split on `;`).
- `importEmployeesV1 {fileName?, rows}` -> `{jobId, status: "planned", totals, rows: ImportRowPlan[], planHash, chunkCount}`. Validation: email format, lower-cased, inside the company domain, duplicates within the file (second occurrence invalid `DUPLICATE_EMAIL`), role enum, team names/ids resolved against the active catalog (unknown -> `TEAM_NOT_FOUND`), lengths, `startDate` format, manager email format. An existing member's `role` of `admin` cannot be changed by import (`ADMIN_ROLE_PROTECTED`). Plan actions: `update` (existing member, field-level `changes`), `unchanged`, `create` (new roster entry, or update of an existing `invited` entry), `invalid` (`errors`). Never touched: points, auth ids, `displayName` of existing members (Google-owned). Same `requestId` + same rows returns the same job. Stores the job and plan chunks (100 rows each).
- `applyEmployeeImportV1 {jobId, planHash}` -> `{jobId, status, done, progress, results}`. Processes the **next** unprocessed chunk (<= 100 rows), re-evaluating each row against current data in its own transaction (so stale plans converge safely), then advances the job cursor transactionally; the portal calls repeatedly until `done`. Outcome counters are exact: each applied row records its outcome (`importJobs/{job}/results/{row}`, server-only, written in the row transaction), a retried chunk reuses the recorded outcomes instead of reporting "unchanged", and `progress` is derived from per-chunk tallies on the job (a retried chunk replaces its own tally, never adds). A short lease on the job makes a concurrent apply fail `IMPORT_JOB_BUSY`; a wrong `planHash` fails `IMPORT_PLAN_MISMATCH`; re-running a completed job returns its final state without writes. Each created/updated row appends an audit entry (`import.apply`, targetId = emailHash).
- `getEmployeeImportV1 {jobId}` -> `{job: ImportJob}`: totals, progress and up to 1000 failed rows (`errors`, `errorsTruncated`) for the downloadable error CSV.

### Bug reports inbox (bugreport.manage, admin only)

Reports from the app's shake-to-report land in `bugReports/{reportId}` (client create-only, `uid` only, no company on the document) with an optional screenshot at `bugReports/{uid}/{reportId}.jpg`. The inbox never trusts a supplied company: a report belongs to the company of its reporter's server-owned `users/{uid}` membership, resolved at read time, so another tenant's (or a membership-less reporter's) report is invisible and `getBugReportV1` / `updateBugReportV1` answer `BUG_REPORT_NOT_FOUND` for it.

- `listBugReportsV1`: newest first. Filters `status`, `category`, `query` (substring of description, reporter name, screen, app version, report id), `from` / `to` (`YYYY-MM-DD`, inclusive, UTC); `pageSize` 1..100 (default 25) and an opaque `pageToken` (createdAt + id position). Scanning is bounded (first page 1000 reports, later pages 500) so a page can be short while `nextPageToken` is present; filters run in memory, so no composite index is needed. The first page returns `counts` per status over its scan window (`capped: true` when older reports were not counted), ignoring the status filter. Rows carry the reporter's display name, never the email.
- `getBugReportV1`: the report, `reporterEmail`, the diagnostics the app included (`appVersion`, `appBuild`, `osVersion`, `deviceModel`, `locale`, `screen`, `installId`), triage state and, when a screenshot exists, `screenshotUrl` with `screenshotExpiresAt` (15 minutes). The URL is a v4 signed URL minted with the Admin SDK for exactly `bugReports/{uid}/{reportId}.jpg`; if signing is unavailable the bytes (<= 512 KB) are inlined as a `data:` URL, and if that fails too the screenshot is left out without failing the call.
- `updateBugReportV1`: set `status`, `note` (trimmed, <= 2000, empty clears) and/or `assigneeId` (an active admin of the company; `null` clears) in the triage document. Requires `requestId`, accepts `expectedRevision` (`REVISION_CONFLICT`), appends one `bugreport.update` audit entry (note text is not copied, only "(edited)") and does nothing (`changed: false`, no audit) when nothing differs.

Reads are not audited; all three calls consume the per-caller rate limit. Operational note: signed URLs need the Functions service account to hold `roles/iam.serviceAccountTokenCreator` on itself; without it the inline fallback is used.

## Firestore rules summary

`organizer(c)` now means role `admin` or `organizer` (event reads, challenge lists, as before for admins). New `adminOf(c)` (role `admin`): reads `auditLog`, `roster`, `importJobs` (get; list limit <= 100). Same-company members read `teams`. `sameCompany()` additionally requires `status != 'deactivated'`. All new paths deny client writes; `bugReportTriage` (explicit deny, admins included), `commandReceipts`, `adminRateLimits`, `importJobs/*/chunks`, `pointTransactions` stay server-only/denied. The own-profile allow-list gains the new server-owned keys only as permitted *existing* document keys (never writable).

## Not in this contract

Reports/flag queue, welcome emails and push for roster invites, notifying the uploader of a removal, bulk removal per member, undo of removals, points reversal for un-checked attendance, XLSX parsing (client side) and server-side CSV download.

## Implementation status and tests (feature/admin-backend, November 11)

Implemented in `gcp/functions/src/modules/admin` (domain/application/infrastructure/transport) and exported from `gcp/functions/src/index.ts`; `resolveMembershipV1` (accounts module) claims roster entries and refuses deactivated accounts; `updateEventV1` (organizer module) accepts `completed`, `statusReason` and the `organizer` role. **Nothing is deployed.**

- Unit: `gcp/tests/unit/admin-permissions.test.ts` (every command: unauthenticated, unverified, wrong provider, member, no membership, deactivated, other tenant, organizer vs admin-only), `admin-events.test.ts` (moderation, attendees, attendance), `admin-members.test.ts`, `admin-roster-import.test.ts`, `accounts-roster-claim.test.ts`, plus completed-status cases in `organizer-events.test.ts`. They use an optimistic in-memory store (`gcp/tests/unit/helpers/adminFakes.ts`) that retries on conflicting reads, so races (last seat, last admin, balances, import lease) are exercised; it is not emulator evidence.
- Rules: `gcp/tests/rules/admin.test.ts` (`npm run test:rules`).
- Emulator: `gcp/tests/integration/admin-adapter.test.ts` (`npm run test:adminapi:integration`, in CI) drives the same services through `FirestoreAdminStore` on the Firestore emulator with real transaction contention, cursors, count(), collection-group queries, 250-row chunked import and the roster claim through `FirestoreMembershipStore`. It does not call the deployed callables, so Auth tokens and App Check are not covered; deploy checks must include one signed-in smoke call per callable.
- Contracts: `contracts/tests/admin.test.mjs`.

Index notes: member scans, last-admin checks and email lookups use equality filters ordered by document id (served by merged single-field indexes); deactivation uses the existing collection-group `rsvps` index (companyId, userId, status, eventStartTime). No new composite index is declared.

Known limits: `listMembersV1` and `listRosterV1` scan at most 1000 documents per call (clients follow the cursor; no overall cap) and order by id (the portal sorts each loaded page by name); stored member emails are matched case-sensitively against lower-cased import emails (Google tokens are lower-case); points reversal for attendance, undo of removals, report queue and welcome emails are not built.
