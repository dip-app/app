# Functions dispatcher (`dipApiV1`) experiment

Status: experiment on a draft PR. Nothing is deployed. The owner decides whether to merge after review.

## Problem

The `dip` codebase exports 74 functions (measured from `gcp/functions/src/index.ts` before this change): 53 callables, 5 HTTP functions, 9 Firestore triggers and 7 schedules. The 58 HTTP-triggered ones are each a separate gen2 Cloud Run service (49 at 256 MiB, 9 at 512 MiB, all at the gen2 default of 1 vCPU). Two problems follow:

- **Cold starts.** Admin portal traffic is low, so most callables are scaled to zero and every one an admin touches cold-starts separately. `minInstances: 1` fixes that per function, but costs per function.
- **Deploys.** A codebase deploy updates every function, and 74 services hit the Cloud Functions/Cloud Build API rate limits ("Quota Exceeded").

## What was built

One additional callable, `dipApiV1` (us-central1, 512 MiB, 1 vCPU, 60 s, `minInstances: 1`, `maxInstances: 10`, concurrency 80, App Check enforced outside the emulator). It takes `{ command, payload }` and calls the registered handler with the caller's own request whose `data` is `payload`. The response and errors are the handler's, unchanged: there is still no success/error envelope ([callables](../contracts/callables.md)).

| Piece | Path |
| --- | --- |
| Registry (one row per command) | `gcp/functions/src/modules/dispatcher/transport/registry.ts` |
| Dispatcher core (checks, routing, logging) | `gcp/functions/src/modules/dispatcher/transport/dispatch.ts` |
| Production wiring and `onCall` options | `gcp/functions/src/modules/dispatcher/transport/dipApiV1.ts` |
| Shared handlers | `adminCommands`, `organizerCommands`, `challengeCommands`, `submissionReviewCommands`, `placeCommands` in each module's transport file |
| Portal client (flag, fallback) | `apps/admin/src/lib/dispatcher.ts`, used by `adminLive.ts` and `firebaseAdapter.ts` |
| Tests | `gcp/tests/unit/functions-dispatcher.test.ts`, `apps/admin/src/lib/__tests__/dispatcher.test.ts` |

### No duplicated logic

Each migrated standalone callable was changed from `onCall(opts, (request) => ...)` to `const handler = ...; export const x = onCall(opts, handler)`. The registry references that same handler object (a test asserts identity for every row). So auth, the server-owned membership check (the handler compares the payload `companyId` with `users/{uid}.companyId` and refuses `COMPANY_MISMATCH`), validation, rate limiting, idempotency receipts, audit entries and error mapping are the standalone callable's code, not a copy. The registry's other fields (`minRole`, `rateLimit`, `request`, `mutating`) document what the handler enforces; tests check `minRole` against the real admin handlers and `request` against `contracts/v1/models.schema.json`.

### Checks the dispatcher adds, in order

1. Signed in, else `unauthenticated` / `UNAUTHENTICATED` (no handler runs, the command list is not revealed).
2. Envelope: an object with a command name matching `^[A-Za-z][A-Za-z0-9]{0,63}$` and an object payload, else `invalid-argument` / `DISPATCH_INVALID_ENVELOPE` with `fields`.
3. Payload at most 256 KiB (raw body length when the framework provides it), else `invalid-argument` / `DISPATCH_PAYLOAD_TOO_LARGE`. The largest migrated request (an event draft) is a few KiB.
4. Known command (a `Map`, so `toString`/`constructor` never match), else `not-found` / `UNKNOWN_COMMAND`.
5. Response at most 8 MiB serialized, else `internal` / `DISPATCH_RESPONSE_TOO_LARGE` (every migrated list is paged at 100 rows; a mutation would already have committed).
6. One log line per call, `dipApi.dispatch` with `command`, `outcome` (`ok` or the error code), `reason`, `ms`, `requestBytes`, `responseBytes`. Never the uid, payload or response. The handlers' own error logs are unchanged.

## Migrated commands (29)

All are called by the admin portal. **None is called by the iOS app** (checked by searching `ui/` for every name), so shipped iOS builds are unaffected either way; the standalone callables are kept only as the rollback path.

| Group | Commands | Min role | Limiter |
| --- | --- | --- | --- |
| Album and attendees | `removeEventPhotoV1`, `removeEventPhotoCommentV1`, `addEventAttendeeV1`, `removeEventAttendeeV1`, `recordAttendanceV1` | organizer | `adminRateLimits/{uid}` |
| Members | `listMembersV1`, `getMemberV1` (organizer); `updateMemberV1`, `resetMemberProfileV1`, `adjustMemberPointsV1` (admin) | as listed | `adminRateLimits/{uid}` |
| Roster and import read | `upsertRosterEntryV1`, `revokeRosterEntryV1`, `resendRosterInviteV1`, `listRosterV1`, `getEmployeeImportV1` | admin | `adminRateLimits/{uid}` |
| Bug reports, insights | `listBugReportsV1`, `getBugReportV1`, `updateBugReportV1` (admin); `getCompanyInsightsV1` (organizer) | as listed | `adminRateLimits/{uid}` |
| Events, weekly themes | `createEventV1`, `updateEventV1` (organizer); `createChallengeV1`, `updateChallengeV1` (admin) | as listed | none (requestId receipts, expectedRevision) |
| Submission review | `listChallengeSubmissionsV1`, `approveChallengeV1`, `rejectChallengeV1` | admin | none (receipts) |
| Place lookups | `autocompletePlacesV1`, `resolvePlaceV1` (organizer); `setCompanyOfficeV1` (admin) | as listed | `placesRateLimits/{uid}` + company daily cap |

Limits are keyed by uid/company in Firestore, not by transport, so switching transport neither resets nor doubles a budget (tested).

**Kept standalone:** every AI/Dipbot callable (`generateEventDraftsV1`, `getEventIdeaContextV1`, `getEventIdeaSuggestionsV1`, `getDipbotIdeasV1`, `findVenuesV1`: secrets, model calls, up to 300 s), covers (`pickEventCoverV1`, `searchCoverPhotosV1`, `importCoverPhotoV1`: secrets, `sharp`), suggestions (`manageSuggestionsEmailV1`, `resolveSuggestedIdeaV1`: secrets), the 300 s admin jobs (`setMemberStatusV1`, `backfillRosterV1`, `importEmployeesV1`, `applyEmployeeImportV1`), sign-in (`resolveMembershipV1`), every iOS callable (`setRsvpV1`, `registerDeviceV1`, `unregisterDeviceV1`, `sendInviteV1`, `respondToInviteV1`, `listCoworkersV1`, `finalizeEventPhotoV1`, `submitChallengeV1`), `upsertTeamV1` (no client calls it), all HTTP functions (share page, cover image, email webhook/unsubscribe/open), triggers and schedules.

## Known differences from the standalone callables

- A signed-out caller always gets `unauthenticated` / `UNAUTHENTICATED` with "Sign in to continue.". With a valid payload the admin standalone callables answer the same; with a malformed payload some standalone handlers validate first (`invalid-argument`), and the submission callables word the message "Sign in again.". Code and reason match for valid requests.
- Per-command instance caps (10, or 5 for `setCompanyOfficeV1`) become one shared cap (10 instances × 80 concurrent requests). One abusive admin account can now use capacity the other commands share; the per-uid Firestore limits are unchanged.
- Place lookups get the dispatcher's 60 s timeout instead of 30 s. All requests share 512 MiB per instance instead of 256 MiB per function.
- New limits: 256 KiB request, 8 MiB response.
- Platform metrics (Cloud Run request count, latency, errors) no longer separate commands; per-command numbers come from a log-based metric on `jsonPayload.command` of `dipApi.dispatch`. One extra info log line per call.

## Portal client and rollback

`createCallableInvoker` sends the 29 commands to `dipApiV1` and everything else to its own callable. `NEXT_PUBLIC_ADMIN_DISPATCHER` (build time) turns it off with `off`, `false` or `0`; it is on by default. On a dispatcher-level failure the same payload (same `requestId`) is sent to the standalone callable:

- `not-found` with reason `UNKNOWN_COMMAND`: that command goes direct for the rest of the page session.
- `not-found` without details (missing function, emulator), `unavailable` without a reason (503), or the SDK's status-0 `internal [0]` (a missing function in the browser fails CORS): every command goes direct for the rest of the page session.
- Anything else (a command's own `not-found` such as `MEMBER_NOT_FOUND`, `internal` with a server message, `permission-denied`) is the answer and is never retried.

A fallback can repeat a mutation only when the first attempt reached the handler and the response was lost. Mutating admin commands carry a `requestId` (receipt replay) or `expectedRevision` (a repeat fails `aborted` instead of writing twice); `recordAttendanceV1` and `setCompanyOfficeV1` are idempotent by value. This is the same exposure as an ordinary client retry today.

**Rollback**, cheapest first: (1) delete `dipApiV1` (`firebase functions:delete dipApiV1 --region us-central1`) or let it fail; open portals fall back to the standalone callables on the next call, with no rebuild. (2) Rebuild the portal with `NEXT_PUBLIC_ADMIN_DISPATCHER=off`. (3) Revert the PR. The standalone callables are untouched, so no step needs a backend change. Rollback stops working once phase 2 (below) deletes the standalone functions.

## Adding a command

1. In the module's transport file, export the handler (`(request: CallableRequest) => Promise<T>`) in its handler set and use it in the standalone `onCall`.
2. Add one row to `commandTable` in `registry.ts` (handler, `minRole`, `rateLimit`, request schema name, `mutating`), and its name to `HandlerSets` if the set is new.
3. Add the name to `DISPATCHED_COMMANDS` in `apps/admin/src/lib/dispatcher.ts` (a test fails if the lists differ) and to `MIGRATED` in the test.
4. Only commands without secrets, at most 60 s and 512 MiB qualify; the registry test checks this against the standalone export.

## Measurements

All numbers are local measurements or list-price arithmetic; nothing was deployed.

| Item | Before | After this PR | After phase 2 (delete the 29 standalone) |
| --- | --- | --- | --- |
| Functions in the codebase | 74 | 75 | 46 |
| HTTP-triggered services (callable + HTTP) | 58 | 59 | 30 |
| Services with a warm instance | 0 | 1 | 1 |

- **Deploy size.** All functions deploy from one source upload; the dispatcher adds about 14 KB of compiled JS (`lib/modules/dispatcher`), negligible. What matters is the service count: this PR adds one service per full deploy. Deploy-quota relief only comes with phase 2.
- **Cold start.** Every function, including the dispatcher, loads the whole `index.js` (all modules); locally that import took 0.66 to 1.0 s on an Apple-silicon laptop, and a 1 vCPU Cloud Run instance is slower. The dispatcher does not make a cold start cheaper; it makes one warm instance serve 29 commands, so the portal's light calls skip the cold start unless a burst needs a second instance. The warm instance still opens its Firestore channel lazily after long idle periods.
- **Cost of `minInstances: 1`** (Cloud Run tier-1 idle prices as I know them: $0.0000025 per vCPU-second and per GiB-second; 730 h; verify in the pricing calculator, and the free tier may absorb part of it): the dispatcher at 1 vCPU / 0.5 GiB is about **$10 per month** ($6.57 CPU + $3.29 memory). For comparison, a warm instance on all 58 HTTP services is about $491 per month, and on just the 29 standalone versions of these commands about $238 per month. Request time is billed at the active rate either way.
- **Traffic covered.** 29 of the 44 callables the portal uses (66% by name); 0% of iOS traffic. Production request counts were not available to me, so the share of real admin calls is unmeasured. By call pattern the busiest portal callables (members paging, place typeahead, insights, roster and bug report lists) are all migrated, while the excluded ones are user-triggered AI, cover and import actions, so the call share is probably well above 66%. Check `run.googleapis.com/request_count` by service for 30 days before relying on that.

## Tradeoffs

- **Blast radius.** A bad `dipApiV1` deploy or an out-of-memory crash affects all 29 commands at once. While the standalone callables exist the portal falls back by itself; after phase 2 it would not.
- **Shared capacity.** One instance serves up to 80 concurrent requests in 512 MiB; a heavy insights or member page shares memory with everything else.
- **Observability.** Per-command dashboards need a log-based metric (above). Handler error logs still carry the command name.
- **Security surface.** One more public callable, but it adds no new authority: it requires sign-in and App Check and then runs the existing handlers.

## Recommendation

Merge it as an additive, flag-guarded experiment only if warm admin pages are worth about $10 per month; it does not by itself reduce the function count or deploy quota pressure (it adds one service). The real deploy benefit is phase 2: after two or more weeks of clean `dipApi.dispatch` logs, delete the 29 standalone admin-only functions (58 to 30 HTTP services). That removes the automatic fallback, so treat it as its own decision. A cheaper alternative for cold starts alone is `minInstances: 1` on the two or three busiest standalone callables (about $8 per month each), with no code change.

Unverified: the dispatcher has not run in the Functions emulator through the portal adapter (`npm run test:admin:live` needs ports 8080/9099/5001, and 8080 was in use during this session) and has not been deployed. The idle price and the traffic share above are estimates.
