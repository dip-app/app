# 03 — Events and participation

**Area:** Discovery and participation. **Owner:** assign one human in the issue. Covers V1-03, V1-04, V1-06 through V1-09 from [V1](../../V1.md).

## Pasteable agent brief

> Implement the V1 events/participation packet in `docs/milestones/v1/03-events-participation/README.md`. Read root/folder `AGENTS.md`, root `SESSION.md`, and both contract documents. Own only the listed UI/domain/data and participation-module paths in an isolated branch/worktree. Build feed/details, attendees, RSVP/cancel, My Events, default imagery integration, and standard sharing against shared fixtures and setRsvpV1. Use shared UI components and the accounts membership protocol. Coordinate rules, indexes, exports, schema changes, and app composition with the integrator. Record one session log per session, which may span multiple commits. Handoff test results and integration needs explicitly.

## Owned paths

- `ui/DIP/Features/Events/**`, `ui/DIP/Features/MyEvents/**`
- `ui/DIP/Domain/Events/**`, `ui/DIP/Domain/MyEvents/**`
- `ui/DIP/Data/Events/**`, `ui/DIP/Data/MyEvents/**`
- `ui/DIPTests/Events/**`, `ui/DIPTests/MyEvents/**`
- `gcp/functions/src/modules/participation/**`
- Feature-specific files `gcp/tests/unit/participation*.test.ts`, `gcp/tests/integration/participation*.test.ts`, `gcp/tests/rules/participation*.test.ts`.
- This packet's `README.md` and your own new session log(s).

Do not edit organizer/accounts/UI-foundation owned paths. Shared rules/indexes, function exports, app composition, configuration, lockfiles, contract sources/generated files, and token sources require the integration owner.

## Prerequisites and contracts

Use [callables](../../../contracts/callables.md) for `setRsvpV1`, capacity, cancellation cutoff, retry/errors, and trusted RSVP snapshots. Use [data ownership](../../../contracts/data-ownership.md) for tenant-scoped reads, paginated feed/attendees, collection-group My Events constraints, and Firestore-listener authority. The accounts owner provides membership context; the organizer owner supplies event seed/creation compatibility. Confirm the default-image catalog with design. Do not implement photo uploads or live deep links in V1.

## Acceptance tests

- [x] Unit-test Upcoming/Past classification using Event.endTime, empty/error/loading states, date formatting boundaries, and My Events exclusion of cancelled RSVPs. — `DIPCoreTests/EventListsTests.swift`; My Events reads only `going` RSVPs (`participation-read` rules tests, `MemberParticipationTests`).
- [x] Test same-company feed/details/attendee reads, cursor pagination, and signed-out/cross-company denial. Attendees use the permitted RSVP snapshots, not private profile queries. — `gcp/tests/rules/events-read.test.ts`, `participation-read.test.ts`, `MemberEventReadTests` (#42, #45).
- [x] Test first join, repeated going request, cancel, repeated cancel, and rejoin: one RSVP identity and correct attendeeCount without underflow. — `gcp/tests/unit/participation.test.ts` (#43).
- [x] Test concurrent last-seat requests: at most one new attendee succeeds. Past/closed/full event cases return the specified errors and actionable UI states. — `gcp/tests/integration/participation-callable.test.ts`; UI shows readable full/closed messages (#45).
- [x] Verify no direct client RSVP/count/attendance write succeeds; no client-supplied role, UID, count, or user snapshot is trusted by the server. — rules tests in `participation-read.test.ts` and `events-read.test.ts`; `setRsvp` derives identity and snapshots server-side (#43, #45).
- [x] Verify joined/cancelled state persists across navigation, listener refresh, and app reload. Dispose listeners when membership or account changes. — RSVP listener drives state; listeners stop on sign-out (`MemberParticipationTests`); iPhone relaunch check Nov 8 ([verification](../VERIFICATION.md)).
- [x] Verify My Events queries constrain companyId, userId, and going status; test corresponding collection-group rules/indexes after integrator wiring. — collection-group rule and `participation-read` tests; uses the deployed `rsvps` index (#45).
- [x] Verify standard iOS sharing supplies useful event information without creating an invite or promising in-app link opening. Use one Join action and explicit joined feedback. — iPhone check Nov 8 ([verification](../VERIFICATION.md)).
- [ ] Run relevant domain/UI, backend, concurrency/emulator, and contract tests. Record manual physical-device share-sheet checks separately.

## Handoff

Give the integrator the participation export, required queries/indexes/rule changes, routes, and membership/component dependencies. Coordinate RSVP.eventStartTime consistency with organizer editing; do not independently change that strategy. Give organizer tests a reusable synthetic event/RSVP fixture and clear attendance-count expectations. Surface pending UI assets or permission dependencies before declaring the flow complete.

## Member event-read subtask — drek2991, issue #30

Owned separately on feature/drek2991-event-reads in app-participation-drek2991: ui/DIP/Domain/Events/**, ui/DIP/Data/Events/** and ui/DIPTests/Events/**. This does not transfer the whole packet. Sander retains frontend/admin-web work; OmerGursoy04 already implemented the RSVP backend on feature/omergursoy04-rsvp. No competing RSVP command or admin implementation is added here.

MemberEventsRepository provides an account/company-scoped, read-only upcoming feed, single detail fetch and detail observation, with stable startTime/document-ID ordering and query-bound cursors. FirebaseEventReadSource consumes injected, already-configured Auth/Firestore instances. It validates membership changes and removes listeners on invalidation/source release. EventDocumentMapper converts Timestamps and numeric fields explicitly and injects the snapshot ID; existing DIPCore.DIPEventMetadata handles presentation. These are data adapters, not a new screen or a live feed integration claim.

### Consumer and integration handoff

- Construct FirebaseEventReadSource.repository(context:auth:firestore:) from observed MembershipContext. Scope all rendered/cache state to UID and companyID. Clear rendered event data and invalidate the repository on sign-out or membership changes; install a new repository for the next membership. In-flight results from an invalidated identity are rejected. The SDK source also monitors Auth and the own-profile company field. Never reuse a repository/cursor from another account.
- For feed pagination, create EventFeedQuery once with a fixed startsAtOrAfter and pageSize (default 20, maximum 100). Keep that same query for following pages. The source constrains companies/{companyID}/events by status == scheduled and startTime >= lower bound, orders startTime then document ID, and uses the matching ordered cursor values. A full last page can return a cursor whose next page is empty. Refreshing starts a new query/cursor chain.
- The integration follow-up below supersedes the initial data-only scope: same-company event get/list permissions now have local denial/query tests. Deployed permissions remain unchanged until a separately authorized release. Before production use, review the rule changes and deploy them through that release workflow. Review the existing status/startTime feed index and document-ID tie-break ordering against the actual Firestore query; do not infer index readiness merely from successful SDK compilation. No private coworker-profile query is used.
- detail(eventID) returns nil for a missing document, while malformed or foreign-tenant data throws. observeDetail yields observed changes/deletion and finishes on error or invalidation. Caller cancellation removes that detail listener. Keep the last good UI snapshot only while the same membership is active; clear it when that membership ends.
- Map the returned Event through MemberEventsRepository.metadata to reuse existing structured dates, location, cost, state and share text. Sander's existing UI/projection should consume this; no duplicate formatting or screen layout is introduced. Feed is upcoming/scheduled only; past scheduled details remain readable; cancelled details remain organizer-only under the merged access policy.
- The initial data-only subtask did not implement attendee reads, My Events collection-group queries, RSVP commands, app composition or deployment. The follow-up below adds app composition and local rules/index changes. Coordinate those with their owners. UI may continue using fixtures until the shared rule/index and consumer integration gates pass.

## Member read integration follow-up — issue #30

The owner authorized connecting the read layer to the existing configured-member app. DIPApp/FirebaseBootstrap now inject the account SDKs into the read factory; DIPMemberHome creates a membership-scoped MemberEventAppRepository and keys the host by UID/company. This bridges real event pages and selected-detail observation into the existing DIPPrototypeApp navigation without fixture event/social state. Home supports pagination/retry and pull-to-refresh; previews keep their existing fixtures. Core UI components and Figma geometry are preserved. Configured My Events/RSVP/attendees remain explicitly unavailable pending their owners' integrations. No RSVP command, admin endpoint or admin portal was changed.

The event query now includes companyId == scope.companyID. Same-company verified users can get scheduled events (including observe deletion/missing); cancelled details remain organizer-only. Member list queries require scheduled status, the tenant constraint and an explicit limit <=100. Existing organizer list access is preserved. Direct writes, RSVP rows, receipts and cross-company reads stay denied. The event index source adds companyId before status/startTime; its normal document-ID suffix matches the explicit ordered cursor. Review/deploy rules and indexes through the authorized release workflow; no deployment occurred here.

Validation includes a local Auth/Firestore-to-real-iOS-adapter test: synthetic verified member sign-in, paginated feed, the actual app snapshot projection, a Firestore detail update through observation, and rejection after sign-out. The test is guarded by an emulator-only synthetic seed; normal unit runs skip it when that seed is absent. To run it deliberately, use Node24/JDK21 and:

```sh
firebase emulators:exec --project demo-dip --only auth,firestore 'node gcp/tests/integration/events-read-seed.mjs && xcodebuild -project ui/DIP.xcodeproj -scheme DIP -destination "platform=iOS Simulator,id=<AVAILABLE-SIMULATOR-UUID>" -only-testing:DIPTests/LiveMemberEventReadTests CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- test'
```

Local ad-hoc Simulator signing is needed for Firebase Auth's existing keychain entitlement; it does not select a developer team or change credentials. Do not point this seed at real services: it requires the exact local demo-dip Auth/Firestore environment. The SDK-free preview host also supports `--member-events` for company-feed/detail UI navigation tests; that preview is not live-service evidence.

November 5 reconciliation: member lists require companyId, scheduled status and a limit <=100. Cancelled details remain organizer-only. Same-company missing details are observable. Existing organizer list queries and the status/startTime index are preserved alongside the new member index. These branch changes still require reviewed deployment.

## Active bounded claim — November 3, 2026

Human owner: OmerGursoy04, assisted by Codex. Branch: `feature/omergursoy04-rsvp`; isolated checkout: `app-omer-rsvp`, based on `origin/main` at `5e69d33`. Scope: participation backend service, Firestore transaction adapter, module-local callable adapter and feature-specific unit/emulator tests. No frontend ownership transfer is implied. No linked issue yet; the local tracker records the claim until reviewed publication.

The integrator remains unassigned. Root exports, rules/indexes, manifests, contracts and app composition stay unchanged. Provide an integration handoff instead. Organizer owner drek2991 (issue #14) and the future integrator must agree on eventStartTime propagation before event-time editing is released.

### RSVP backend slice: implementation and integration handoff

The slice supplies `setRsvpV1` in `gcp/functions/src/modules/participation/index.ts`, a strict v1 request parser, authenticated membership checks and an Admin Firestore transaction adapter. The deployment root does **not** export it yet. Transactions read the current membership, event and own RSVP before writing. The server snapshots the first RSVP's profile fields, assigns server createdAt, preserves attendance/audit data on later transitions and updates attendeeCount atomically. Exact same-state retries are acknowledgements with no writes, including after the event closes; a different-state cancellation at/after start fails. A first cancellation before start retains a cancelled row with zero count delta. These interpretations need backend/iOS review.

The existing app continues to use mocks. This slice does not open event/attendee reads, wire Swift listeners or establish V1 release readiness. Existing scaffold TODOs remain pending; the new participation tests execute separately and through the unit-test glob.

Integrator requests:

- Review then export `setRsvpV1` from `gcp/functions/src/index.ts` with the exact versioned name. Confirm region and production App Check client configuration. No deployment is authorized by this slice.
- Coordinate event/RSVP read rules, indexes and Swift wiring as a separate tested change. Client RSVP, attendance and count writes must remain denied.
- With organizer owner drek2991 ([issue #14](https://github.com/dip-app/app/issues/14)), agree on atomic/reconciled propagation of eventStartTime to all RSVP rows. This service uses the event's transaction-read start time on a state change; same-state acknowledgements do not repair snapshots. Concurrent organizer edits conflict on the read event document, but this does not solve propagation to untouched RSVPs.
- Publish a bounded claim issue/PR when authorized. The local tracker claim does not notify other contributors.

### Repeatable local RSVP verification before root-export integration

Requires Node 24.12+, JDK21+, `npm ci`, and free local emulator ports. Use only `demo-dip` and synthetic data. The following creates an ignored, disposable module-only export harness; it does not change the deployment export list. Run from repository root:

```sh
npm run build
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const harness = path.join(root, '.firebase/participation-harness');
const functions = path.join(harness, 'functions');
fs.mkdirSync(functions, { recursive: true });
fs.writeFileSync(path.join(functions, 'index.js'),
  'exports.setRsvpV1 = require(' + JSON.stringify(path.join(root, 'gcp/functions/lib/modules/participation')) + ').setRsvpV1;\n');
fs.writeFileSync(path.join(functions, 'package.json'), JSON.stringify({
  name: 'dip-participation-emulator-harness', private: true, main: 'index.js', engines: { node: '22' }
}));
const modules = path.join(functions, 'node_modules');
if (!fs.existsSync(modules)) fs.symlinkSync(path.join(root, 'gcp/functions/node_modules'), modules, 'dir');
const config = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
config.functions = [{ source: 'functions', codebase: 'rsvp-test', runtime: 'nodejs22' }];
config.firestore.rules = path.join(root, 'gcp/firestore.rules');
config.firestore.indexes = path.join(root, 'gcp/firestore.indexes.json');
config.storage.rules = path.join(root, 'gcp/storage.rules');
fs.writeFileSync(path.join(harness, 'firebase.json'), JSON.stringify(config));
NODE
node --import tsx --test gcp/tests/unit/participation*.test.ts
npx firebase emulators:exec --config .firebase/participation-harness/firebase.json \
  --project demo-dip --only auth,functions,firestore,storage \
  'node --import tsx --test --test-concurrency=1 gcp/tests/integration/participation*.test.ts gcp/tests/rules/*.test.ts'
```

In restricted environments, point `XDG_CONFIG_HOME` and `FIREBASE_EMULATORS_PATH` to writable temporary folders. The CLI may use the host Node 24 runtime locally when Node 22 is unavailable; production stays pinned to Node 22. Integration tests guard local hosts/project, exercise the Firebase client SDK and clean up their own synthetic records/users. Current rules tests prove denial; permitted tenant reads remain future integration work.

## V1 completion — November 8

Original owners drek2991 (member reads, #42) and OmerGursoy04 (RSVP backend, #37) handed off; ariaf7 integrated `setRsvpV1` (#43, deployed) and connected Join/Leave, attendees and My Events in the app with RSVP read rules (#45, deployed); sandervonk added default category images (V1-08). Remaining manual checks (share sheet, usability walkthrough, second-laptop build) are tracked in the [V1 verification record](../VERIFICATION.md).

