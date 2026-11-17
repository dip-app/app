# Backend quality audit (November 17, 2026)

Scope: the backend modules merged quickly in parallel before November 17, 2026. They are push delivery (router, triggers, reminders), notification preferences, email (outbox, unsubscribe and open tokens, webhook, caps), tag interest counts, AI event drafts, the V2 admin API (roster, bug reports, insights), and the Firestore and Storage rules, indexes and TTL policies they rely on. The bar is a production backend that is secure, observable, cost-bounded and idempotent.

Method: four read-only reviews, one per module group, plus a lead pass that re-checked every High finding in the code. Fixes were made on separate branches with targeted unit and rules tests, and the lead reviewed each diff before merge. **Nothing was deployed.** No production data or real secrets were touched.

Severity: **Critical** means cross-tenant data exposure or abuse that can be exploited now. **High** means a correctness, authorization or cost failure that is likely in production. **Medium** means a real defect with a bounded impact or a narrow trigger. **Low** means hardening.

No Critical findings. Tenant isolation held everywhere it was checked. Every callable derives `companyId` from the server-owned `users/{uid}` membership, enforces App Check outside the emulator, and returns generic not-found errors for other tenants' resources.

## Pull requests

| PR | Scope |
| --- | --- |
| #250 | Admin portal tests no longer depend on the wall clock (the known-red `accounts-integration` and Admin portal jobs) |
| #251 | Email: retry before send, claim failure retry, outbox reaper, per-email cap accounting, unsubscribe lifetime, webhook batches, open-pixel write bound |
| #252 | AI and tags: best-effort context reads, per-admin attempt cap, spend metering, run deadline, settle retry, platform ceiling, reconcile safety |
| #253 | Push router: separate rate buckets, two-phase receipts, failure logging, trigger retries with an age cutoff, send-time membership check, function limits |
| #254 | Admin API, rules, indexes and TTL: missing index, TTL as code, limiter after authorization, import bounds, moderation cleanup, deactivation in rules |
| #256 | Deactivated members refused by RSVP, photo, organizer and challenge callables; receipts get `expireAt` |

## Findings

### Authorization and tenant isolation

| ID | Severity | Finding and evidence | Status |
| --- | --- | --- | --- |
| A-1 | High | Deactivated members kept callable access. `setRsvp.ts`, `finalizeEventPhoto.ts`, `organizerCommands.ts` and `challengeCommands.ts` checked role and company but not `status`. A deactivated organizer could still create and edit events, and a deactivated member could rejoin events, although CURRENT_STATE said the callables refuse them. | Fixed in #256 (`ACCOUNT_DEACTIVATED`, checked in the membership transaction) |
| A-2 | Medium | Rules let deactivated users update `users/{uid}`, get `companies/{id}`, list their RSVPs across events, mark notifications read and write notification settings (`own()` or `memberCompany()` without a status check). | Fixed in #254, with emulator rules tests (`audit-deactivation.test.ts`) |
| A-3 | Medium | The admin rate limiter ran before authorization, so any Google-verified non-member could create `adminRateLimits/{uid}` and drive 120 transactions a minute. | Fixed in #254 (`consumeAfterAuth` at all 24 call sites) |
| A-4 | Medium | The push router never re-checked membership at send time, and `registerDeviceV1` ignored deactivation, so former or deactivated members could keep receiving event pushes. | Fixed in #253 (batched `users` read that fails closed; `blocked.inactive`) |
| A-5 | Low | Storage photo-create cannot check deactivation: cross-service rules allow two Firestore reads and both are used. | Accepted. The object stays invisible until `finalizeEventPhotoV1` publishes it, and that callable now refuses (#256). Documented in `storage.rules`. |
| A-6 | Low | No `consumeAppCheckToken` (replay protection) on mutating callables. | Open. Rate limits and caps bound the impact. Consider it for the AI and admin mutations. |
| A-7 | Policy | Admins can adjust their own points, and organizers can record their own attendance. | Flagged with `selfTarget: true` in the audit entry (#254). Whether to refuse it is an **owner decision**. |

Checked with no finding: the HMAC unsubscribe and open tokens (domain separated, `timingSafeEqual`, 32-byte minimum key, no redirects), the webhook Basic auth (digest compare, method and size checks), template escaping and header safety (JSON API, control characters collapsed), the AI prompt handling (JSON-encoded note, moderation, zod and schema validation, no tool use, no PII in prompts), idempotency receipts scoped by company and caller, and the last-admin guards.

### Data integrity and idempotency

| ID | Severity | Finding and evidence | Status |
| --- | --- | --- | --- |
| D-1 | High | Email: any error before the provider call (reads, a cap transaction `ABORTED`) marked the outbox `unknown`, a terminal state, so the email was lost although nothing was sent (`sendOutboxEmail.ts`). | Fixed in #251 (requeued and retried up to `MAX_ATTEMPTS`; only errors after the provider call are `unknown`) |
| D-2 | High | Email: a failed `claim()` was logged and acknowledged, leaving the document `queued` forever. | Fixed in #251 (`RetryableEmailError("claim_failed")`) |
| D-3 | High | Push: the receipt was claimed before sending, so a crash or timeout after the claim lost the push permanently, and a retry saw `duplicate`. | Fixed in #253 (two-phase receipt with `processing` plus a 5-minute lease, then `done`; old receipts count as done) |
| D-4 | High | AI: the weekly-theme context query (`type ==`, `endDate >=`, `orderBy endDate`) had no composite index. In production it fails with `FAILED_PRECONDITION`, killing a run after the paid triage call. | Fixed: index added in #254, and context reads are best-effort in #252 |
| D-5 | Medium | Push: the event-change trigger returned early when the change-log append had already happened, so a redelivery never reached the router. The triggers also had no `retry`. | Fixed in #253 (the receipt dedupes; `retry: true` with an age cutoff of 10 minutes for chat and 1 hour for changes and RSVPs) |
| D-6 | Medium | Push: one failing event aborted the whole reminder run. | Fixed in #253 (per-event isolation; the run reports `failed` and the scheduler retry is idempotent) |
| D-7 | Medium | Email: nothing closed `sending` documents whose instance died, or `queued` documents that would never be redelivered. | Fixed in #251 (`emailOutboxReaper` every 15 minutes, bounded, alertable `email.reaper` log; index added in #254) |
| D-8 | Medium | AI: `settle()` had no retry, so a transient failure lost the drafts and the spend record. | Fixed in #252 (3 attempts with backoff, idempotent against a lost commit acknowledgement, `ai.settle_failed` error log) |
| D-9 | Medium | AI: the time budget (two 90 s calls with an SDK retry) could exceed the 300 s function timeout and the 5-minute reservation TTL. | Fixed in #252 (240 s run deadline via `AbortSignal`, 50 s SDK timeout, `maxRetries: 0`, 7-minute TTL) |
| D-10 | Medium | Tags: reconcile with an empty catalog would delete every stat document. | Fixed in #252 (empty catalog aborts the run; deleting more than half needs `--allow-mass-delete`) |
| D-11 | Medium | Tags: one failing company failed the whole nightly reconcile, and the retry restarted from the first company. | Fixed in #252 (per-company isolation, concurrency 4; rethrows only when every company failed) |
| D-12 | Medium | Admin: photo moderation deleted Storage objects and comments even when no photo document existed, without an audit entry, and swallowed Storage errors. | Fixed in #254 |
| D-13 | Low | Tags: corrected counts could go negative (two non-atomic count queries). | Fixed in #252 (clamped to 0) |
| D-14 | Low | Email webhook: more than 500 events were silently dropped with a 200, and one malformed item rejected the whole batch. | Fixed in #251 (413 so the provider retries; malformed items are skipped and counted) |
| D-15 | Low | Admin import: `scanAll` silently truncated past 50,000 documents, producing a wrong plan. | Fixed in #254 (`IMPORT_TOO_LARGE`) |
| D-16 | Low | Weekly theme pushes run only on Monday, and their receipts are keyed by page, so membership changes between a run and its retry can skip or repeat members. | Open: **owner decision** on whether themes can start on other days |

### Cost and abuse bounds

| ID | Severity | Finding and evidence | Status |
| --- | --- | --- | --- |
| C-1 | High | Push: chat shared the per-user 20/hour cap with every other kind, so an active chat silently suppressed cancellation, change and reminder pushes. | Fixed in #253. Chat gets its own bucket (30/hour, 200/day) and changes get one (60/hour, 300/day). Cancellations and reminders are exempt. |
| C-2 | High | AI: failed runs counted against no per-admin limit, so one admin could drain the company's daily budget with failing runs. | Fixed in #252 (every reservation counts; `AI_DAILY_ATTEMPTS_PER_ADMIN`, default 20) |
| C-3 | High | AI: spend was under-metered. SDK retries, timeouts, failed checks and unexpected errors settled with zero spend. | Fixed in #252 (hoisted meter; unknown-usage failures charged at the per-call worst case) |
| C-4 | Medium | AI: no platform-wide ceiling. Total spend scaled with the number of companies. | Fixed in #252 (`aiUsagePlatform/{yyyymm}`, `AI_PLATFORM_MONTHLY_BUDGET_CENTS`, default 20000, reserved in the same transaction) |
| C-5 | Medium | Email: the daily cap was consumed on every attempt, so a provider outage burned members' budgets without sending. | Fixed in #251 (per-outbox marker inside the cap transaction) |
| C-6 | Medium | Most functions had no `maxInstances`, timeout or memory, and the schedulers ran at the default timeout. | Fixed for push, email, AI, tags and admin (#251 to #254). `setGlobalOptions` was not added, so other modules keep their own settings. |
| C-7 | Medium | Admin: import rows with thousands of keys produced chunk documents over 1 MiB. `listMembers` and `listRoster` scanned up to 1,000 documents per call. | Fixed in #254 (16-key row cap, 60-character names, `MAX_SCAN` 500) |
| C-8 | Medium | Tags: a popular tag is one counter document (about 1 write per second sustained). | Mitigated (`maxInstances` 10, nightly reconcile as the drift backstop). Sharding is deferred. |
| C-9 | Medium | Bug reports are one global collection without `companyId`. Each tenant's inbox scans up to 1,000 platform-wide reports, and creation has no quota. | Open. The locked decision is no server rate limit for shake to report, but stamping `companyId` server-side (trigger) and indexing it is recommended before many tenants exist. Needs an iOS and contract look; **owner decision**. |
| C-10 | Low | Email open pixel: every replay of a valid token wrote to Firestore. | Fixed in #251 (writes stop at 20 opens) |
| C-11 | Low | Push: chat messages are not coalesced (one fan-out per message). | Open. Bounded by the chat bucket and `maxInstances`. Coalescing is a product change. |
| C-12 | Low | Insights: no single-flight on cache refresh. | Accepted. The refresh is role-gated and rate-limited, and costs about 1,200 reads. |

### Privacy

| ID | Severity | Finding and evidence | Status |
| --- | --- | --- | --- |
| P-1 | Medium | The audit log kept deleted photo captions and comment text indefinitely, which conflicts with erasure requests. | Fixed in #254 (stores lengths only; `docs/contracts/admin.md` updated) |
| P-2 | Medium | Import jobs, chunks and results stored employee emails and names with no retention. | Fixed in #254 (`expireAt` after 30 days, plus a TTL policy) |
| P-3 | Medium | Unsubscribe links expired after 60 days, which breaks one-click unsubscribe from older mail. | Fixed in #251 (365 days; backward compatible) |
| P-4 | Medium | The legacy push path (`PUSH_ROUTER_ENABLED=false`) ignores notification preferences. | Mitigated in #253 (cold-start warning and a runbook warning). Retire the legacy path after the router is verified on device. |

Checked with no finding: logs carry ids and counts only (no tokens, addresses, names, prompts or message text), and suppression and preferences are checked on the single email send path.

### Observability

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| O-1 | Medium | Push failures were swallowed: in-app writes, the email channel and FCM batch and per-token errors were dropped. A wrong APNs key looked like an info line. | Fixed in #253 (aggregated FCM error codes; error severity when every send fails or credentials are rejected) |
| O-2 | Low | Webhook logs had no correlation ids. | Fixed in #251 (`outboxId`, `providerMessageId`) |
| O-3 | Low | No log-based alerts exist. | Open. See the alert list in the deploy checklist below. |

### Runtime configuration

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| R-1 | Medium | TTL policies were manual `gcloud` steps, and several collections had no policy at all (admin rate limits, command receipts, import data, push receipts and rate limits). | Fixed in #254: 15 TTL `fieldOverrides` in `firestore.indexes.json` and a TTL table in the deploy runbook. Receipts written before #256 have no `expireAt` and will not expire. |
| R-2 | Low | `AI_PROVIDER=demo` in production would serve fake drafts. | Fixed in #252 (refused outside the emulator) |
| R-3 | Low | There is no key rotation for `EMAIL_UNSUBSCRIBE_KEY`. Rotating it invalidates every link. | Open. Add a key id and a `..._PREVIOUS` secret. This needs a new Secret Manager secret, so it is **owner and ops work**. |

Already safe: secrets use `defineSecret` and are bound only to the functions that need them, and every feature flag defaults off (`EMAIL_ENABLED`, AI, open tracking).

### Tests added

The fix PRs add targeted unit tests for the items below.

- **Email:** failure injection before send and on claim, the reaper, cap accounting under retries, token lifetime, webhook batch handling, and the open bound.
- **Push:** rate classes, receipt lease and crash-retry, isolation of a failing reminder event, inactive and other-company recipients, deactivated device registration, append redelivery, and stale-event cutoffs.
- **AI and tags:** context read failure, the attempt cap, metering on errors and timeouts, settle retry, the platform ceiling, demo refusal, and the reconcile guards.
- **Admin:** the limiter after authorization, import bounds, scan caps, and moderation cleanup.
- **Callables:** deactivation in four modules.
- **Rules:** emulator tests for deactivation.

**Not run:** the email, notifications, AI and tags emulator integration suites, because the local Firestore emulator port was busy. CI runs the suites it has jobs for. The receipt lease adapter test (`notifications-delivery-store.test.ts`) has not run locally.

## Deploy checklist for the coordinator

Run these in order, from a clean checkout of the deploy branch, against `team05-dip` only.

1. **Indexes and TTL first:** `firebase deploy --only firestore:indexes`. This adds `challenges (type, endDate)`, `emailOutbox (status, createdAt)` and the 15 TTL overrides. Wait until the indexes are built (console or `gcloud firestore indexes composite list`), then check `gcloud firestore fields ttls list`.
2. **Functions next.** New function: `emailOutboxReaper`, scheduled every 15 minutes. New optional params, each with a safe default:
   - `AI_DAILY_ATTEMPTS_PER_ADMIN` (default 20)
   - `AI_PLATFORM_MONTHLY_BUDGET_CENTS` (default 20000)

   The email functions still need their Secret Manager secrets to exist before any functions deploy (unchanged; see [email setup](../ops/email-setup.md)).
3. **Rules last:** `firebase deploy --only firestore:rules,storage`. Rules now refuse more for deactivated users, so the functions must be live first.
4. **Smoke tests:**
   - A deactivated test member gets `ACCOUNT_DEACTIVATED` from `setRsvpV1`.
   - `getEventIdeaContextV1` returns a theme when one is active.
   - The reminders scheduler logs `failed: 0`.
   - The email reaper logs nothing when idle.
5. **Log-based alerts to create (O-3):**
   - `push send failed: FCM/APNs credentials rejected`
   - `push send failed: every token failed`
   - `email.reaper`
   - `email.claim_failed`
   - `ai.settle_failed`
   - `trigger.dropped_stale`
   - `reminder delivery failed`
   - The tag reconcile failure summary.
6. **Provider-side cap:** set a hard monthly spend limit on the OpenAI project as a backstop for C-4.

## Owner decisions still open

1. Whether self-targeted points and attendance should be refused (A-7). They are audited today.
2. Bug-report tenancy (C-9): stamp `companyId` server-side and add an index before more tenants arrive.
3. Weekly theme schedule (D-16): can themes start on days other than Monday?
4. Unsubscribe key rotation (R-3): needs a second secret.
5. When to retire the legacy push path (P-4).
