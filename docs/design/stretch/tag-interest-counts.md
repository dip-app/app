# Tag interest counts (stretch S3)

Status: built (TAG-1 to TAG-6, PRs #230, #234 and the portal PR); emulator- and portal-tested, nothing deployed and no backfill run. See [Decisions](#decisions). Part of the [V2 stretch goals](../../milestones/v2/STRETCH_GOALS.md). Feeds [AI event creation](ai-event-creation.md) and the organizer tag picker.

## Goal and user stories

Keep a live count of how many members of a company hold each interest tag, so organizers pick better events and the AI idea flow (S2) has a grounded signal.

- As an organizer, when I tag a new event I see "23 interested" next to each tag.
- As an admin, the portal Overview shows which interests are common and which are thin.
- As the AI idea flow, I read aggregated counts (never per-member data) to suggest topics.
- As a member, my interest edits are reflected within seconds, and removing an interest decrements the count.

## Owner request and one deviation

Request: "keep track of how many users claim each interests tag, on the tag, incremented and decremented with changes."

Deviation to confirm: counts are stored **per company** (`companies/{companyId}/tagStats/{tagId}`), not on the global `tags/{tagId}` document. Reason: `tags/{tagId}` is a shared catalog that every verified user of every company can read (`gcp/firestore.rules`, `match /tags/{tagId}`), so a `memberCount` there would leak one tenant's aggregate to all others and would mix companies. Per-company stats keep tenant isolation and match what an HR admin needs. A platform-wide total (for us, not clients) can be a server-only rollup later (open question 1).

## Current state (findings)

- Tags are a global read-only catalog `tags/{tagId}` (`{name, icon, sortOrder}`, schema `Tag` in `contracts/v1/models.schema.json`), seeded by `gcp/scripts/seed.mjs`. Clients cannot write it ([data ownership](../../contracts/data-ownership.md)). The admin portal mirrors the list as a constant (`apps/admin/src/lib/catalog.ts`, `TAGS`). There is no admin tag editor, so "admin tag catalog" today means that constant plus the seed.
- A member's interests are `users/{uid}.interestTagIds` (string list). **Members write it directly from the app** under the profile rules (`gcp/firestore.rules`, `match /users/{uid}`; the allow-list includes `interestTagIds`). Onboarding and Profile use the same write (`ui/DIP/Data/Accounts/FirebaseAccountsRepository.swift`). There is no profile callable, so "increment in the update callable" is not possible without adding one. Other writers: `resolveMembershipV1` (creates the doc with `[]`, `gcp/functions/src/modules/accounts/domain/membership.ts`), admin `updateMemberV1` and `resetMemberProfileV1` (`gcp/functions/src/modules/admin`), the roster claim, and deletion.
- Events carry `tagIds` (`EventDraft`) and Home filters by them (`ui/Packages/DIPCore/Sources/DIPCore/DIPInterestFilter.swift`).
- `getCompanyInsightsV1` already serves cached aggregation counts to the portal Overview (see the admin contract), so tag stats can ride the same screen.
- Functions already use Firestore v2 triggers (`onDocumentWritten` in the `notifications` module), so a trigger is idiomatic.

## Options

| Option | How | Pros | Cons |
| --- | --- | --- | --- |
| A. Trigger-maintained counter | `onDocumentWritten users/{uid}` diffs `interestTagIds` (and `companyId`, `status`) and applies `FieldValue.increment(+1/-1)` | Writer-agnostic (app, admin, roster, reset), no client change | Triggers are at-least-once, so a retry double counts unless guarded |
| B. New profile callable | App calls `updateInterestsV1`, increments in the same transaction | Exactly-once with request ids | Changes the profile write path, rules and every writer; admin and roster paths still need handling |
| C. Query on read | `count()` aggregation per tag when needed | Always correct, no counters | One index read per 1,000 matches per tag per read; slow for every AI call |
| D. A plus nightly reconcile (recommended) | Trigger for freshness, scheduled job recomputes with `count()` and corrects drift | Cheap reads, self-healing | Two code paths to test |

**Recommendation: D.** Firestore triggers deliver at least once and the docs recommend event-id keyed idempotency ([events](https://firebase.google.com/docs/functions/firestore-events), [retries](https://firebase.google.com/docs/functions/retries)). `FieldValue.increment` is atomic but not idempotent ([add data](https://firebase.google.com/docs/firestore/manage-data/add-data)), so the trigger records an event-id receipt in the same write.

## Design

### Data model

`companies/{companyId}/tagStats/{tagId}`

```json
{ "tagId": "tag-cooking", "memberCount": 23, "updatedAt": "<server timestamp>", "reconciledAt": "<server timestamp>" }
```

Server-owned. Rules: read for `organizer(companyId)` (admin and organizer); no client writes; members denied (open question 2). Receipts: `companies/{companyId}/tagStatReceipts/{eventId}` with `{createdAt, expireAt}` and a Firestore TTL policy of 7 days; server-only.

### Counting rules

- A member counts when `companyId` is set and `status != "deactivated"` (matches `sameCompany` in the rules).
- Delta per trigger: `before` set B and `after` set A (each empty if the doc is missing or the member is not counting). `+1` for tags in `A - B`, `-1` for tags in `B - A`. A company change (not expected) is a remove from the old company plus an add to the new one.
- Ignore tag IDs not in the catalog (cached read of `tags`) so junk values never create stat docs.
- De-duplicate the list before diffing.

### Idempotent apply

One batch per invocation: `receipt.create()` (fails if the event id was already processed, which aborts the whole batch and is treated as success) plus one `set(..., {merge: true})` with `FieldValue.increment(delta)` per changed tag. A batch avoids a transaction retry loop on a hot stat doc. The portal clamps display at `max(0, memberCount)`.

### Reconcile and backfill

- `reconcileTagStats` (`onSchedule`, nightly, `us-central1`): for each company and catalog tag, run `where("companyId","==",c).where("status","!=","deactivated").where("interestTagIds","array-contains",tag).count()` and write `memberCount` when it differs (log the delta, never PII). Count aggregations bill one read per up to 1,000 index entries ([aggregation queries](https://firebase.google.com/docs/firestore/query-data/aggregation-queries), not fetched, UNVERIFIED). The same job is the one-time backfill. A composite index may be needed (UNVERIFIED which; the emulator reports it).
- Backfill script `gcp/scripts/backfill-tag-stats.ts` follows the dry-run-default pattern of `backfill-roster.ts`. The production run needs owner approval ([seed data rules](../../ops/seed-data.md)).

### Write contention

One stat doc per company and tag. Sustained writes to one document are limited to roughly one per second (the figure appears in the [distributed counters](https://firebase.google.com/docs/firestore/solutions/counters) sample; the best-practices page says to load test). Normal edits are far below this. A cold-start wave (a company onboarding hundreds of members at once) could queue, but batches retry and the nightly reconcile corrects loss, so sharding is not needed (open question 3 if a company exceeds about 5,000 members). Sharding is out of scope here. `onUserInterestsWritten` runs with `maxInstances: 10`, `timeoutSeconds: 60`, `memory: 256MiB` to bound a write storm, and the nightly reconcile is the drift backstop for any increment lost to contention or a retry limit.

### Read path

- Portal: direct Firestore read of `companies/{c}/tagStats` under the organizer rules for the tag picker and Overview card, or through `getCompanyInsightsV1` if caching is preferred.
- AI flow: the server reads the stats itself with the Admin SDK; the client never supplies counts.
- No exact count is exposed to members.

### Contract changes

Additive within v1: schema `TagStat`, and optionally a `tagStats` section in the insights response. No breaking change, so no new contract version. `contracts/v1/models.schema.json` is a choke point: one integrator edits it, then runs `npm run generate`.

## Security and privacy

- Tenant isolation by path (`companies/{c}`) and by rules (`organizer(companyId)`); the trigger derives the company from the user document, never from a payload.
- Counts are aggregates. Admins can already see each member's interests (`getMemberV1`), so no new exposure to them. AI prompts receive aggregates only, with small-cell suppression (hide or round counts under 5) so individuals are not singled out ([AI doc](ai-event-creation.md)).
- No interest values or UIDs in logs; log tag IDs and deltas only.

## Testing plan

- Unit: diff function (add, remove, replace, duplicate IDs, unknown tags, deactivation, delete, company change); a replayed event id is a no-op.
- Emulator: write the user doc through each writer (client under rules, `updateMemberV1`, `resetMemberProfileV1`, roster claim) and assert counts; replay the same event twice; concurrent edits from many users.
- Rules: organizer read allowed; member, other tenant denied; every client write denied.
- Reconcile: seeded drift is corrected, no write when equal.
- Targeted runs only, per the repo preference.

## Rollout and flags

Deploy the trigger, run the dry-run backfill, run the production backfill with owner approval, then enable the portal display. No client flag; the portal hides counts until a company has stat docs. Rollback: remove the trigger (stat docs are inert).

## Risks

Drift if the trigger is down (mitigated by reconcile); a writer that bypasses `users/{uid}` (none today); catalog removals leave orphan stat docs (reconcile deletes them); a hot document during a mass import (accepted, see above).

## Open questions for the owner

1. Per-company stats instead of counts on the global tag doc (recommended). Do you also want a platform-wide rollup for internal use?
2. Should members ever see popularity ("23 coworkers like this")? Default is no.
3. Largest company size planned for V2 (decides whether sharding is ever needed).
4. Should deactivated members stop counting (recommended)?

## Work breakdown

| ID | Title | Scope | Acceptance | Est | Area | Depends |
| --- | --- | --- | --- | --- | --- | --- |
| TAG-1 | Tag stats contract and rules | Add `TagStat` schema, `companies/{c}/tagStats` and receipts rules (organizer read, no client write), regenerate | Rules tests: organizer read passes; member, other tenant and every client write are denied; `npm run check:generated` is clean | S | backend | none |
| TAG-2 | Interest count trigger | `onDocumentWritten users/{uid}` applies diffs with a receipt-guarded batch | Unit and emulator tests cover add, remove, replace, deactivate, delete, unknown tag; a replayed event id is a no-op | M | backend | TAG-1 |
| TAG-3 | Nightly count reconcile | Scheduled count() recompute per company and tag; corrects drift and deletes orphan docs | Seeded drift is fixed in an emulator test; equal counts cause no write; no PII in logs | M | backend | TAG-2 |
| TAG-4 | Tag stats backfill script | Dry-run-default script that populates stats from users, with a report | Dry run prints per-company diffs; a real run needs an explicit flag; documented in the ops runbook | S | infra | TAG-2 |
| TAG-5 | Portal interest counts | Counts beside tags in the event form and an Interests card on Overview | Portal tests with mock data show counts and the empty state; counts hidden when no stats exist | M | admin | TAG-1 |
| TAG-6 | Interest summary helper for AI | Server helper returning top and thin tags with small-cell suppression, shared with the AI flow | Unit tests for suppression under 5, ordering and tenant scoping | S | backend | TAG-2 |

## Decisions

The owner has not answered the open questions yet; these defaults were taken from the recommendations above and can be revisited.

1. **Per-company counts** at `companies/{c}/tagStats/{tagId}`, not on the global `tags/{tagId}` document (open question 1). No platform-wide rollup is built.
2. **Members never see counts** (open question 2). Rules allow `get` and `list` (limit <= 200) for organizers and admins only.
3. **No sharding** (open question 3). One stat document per company and tag.
4. **Deactivated members do not count** (open question 4). A missing `status` counts as active, matching `sameCompany` in the rules.
5. **Trigger name and scope.** `onUserInterestsWritten` (`onDocumentWritten users/{uid}`, `retry: true`) skips writes that do not change `companyId`, `status` or the de-duplicated set of `interestTagIds` without reading anything, so ordinary profile edits cost nothing.
6. **Receipt location.** One receipt per trigger event at `companies/{c}/tagStatReceipts/{eventId}` under the company the member counts in after the write (before the write when they stop counting). Event IDs that are not safe document IDs are hashed. `expireAt` is 7 days out; the TTL policy is an owner step.
7. **Reconcile query.** `status != "deactivated"` excludes documents with no `status` field, so the reconcile counts `companyId == c AND interestTagIds array-contains t` and subtracts the same count with `status == "deactivated"`. Two composite indexes on `users` back these queries.
8. **AI summary (TAG-6).** `getInterestSummary(deps, companyId)` in `gcp/functions/src/modules/tags` returns `top` and `thin` tags; counts under 5 are returned as `memberCount: null, suppressed: true`, and suppressed tags are ordered by name only so their order leaks nothing.

9. **Reconcile versus trigger race.** `reconcileTagStats` (daily 03:30 UTC) skips stat documents written in the last 10 minutes (a trigger may be in flight), never creates zero documents, deletes stat documents for tags no longer in the catalog, and writes with a last-update-time precondition so an increment landing between the read and the write is reported as `skippedConcurrent` instead of being overwritten. A trigger delivered after its user write was already counted can still double count once; the next night's run corrects it. The backfill script uses the same code with `force` (no recent-window skip). Safety guards: an empty tag catalog aborts the company (a failed or wiped catalog read must not delete every stat doc), a plan that deletes more than half of a company's stat docs is refused with a warning unless `allowMassDelete` (`--allow-mass-delete` on the script; `force` does not lift it), and counts are clamped to zero because the two non-atomic count queries can briefly disagree. One failing company is logged with its id and skipped; the nightly job fails (and retries) only if every company failed. Companies run four at a time.

10. **Portal read path.** The portal reads `companies/{c}/tagStats` directly (organizer rules, `limit(200)`), not through `getCompanyInsightsV1`. The Overview Interests card shows count and share of active members; event form chips show counts only once the company has stat documents; a permission denial hides counts.

## Sources

- Firestore triggers and delivery: https://firebase.google.com/docs/functions/firestore-events
- Retries and idempotency: https://firebase.google.com/docs/functions/retries
- Increment semantics: https://firebase.google.com/docs/firestore/manage-data/add-data
- Distributed counters: https://firebase.google.com/docs/firestore/solutions/counters
- Best practices: https://firebase.google.com/docs/firestore/best-practices
- Aggregation queries: https://firebase.google.com/docs/firestore/query-data/aggregation-queries (not fetched, UNVERIFIED details)
