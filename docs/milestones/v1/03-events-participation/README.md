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

- [ ] Unit-test Upcoming/Past classification using Event.endTime, empty/error/loading states, date formatting boundaries, and My Events exclusion of cancelled RSVPs.
- [ ] Test same-company feed/details/attendee reads, cursor pagination, and signed-out/cross-company denial. Attendees use the permitted RSVP snapshots, not private profile queries.
- [ ] Test first join, repeated going request, cancel, repeated cancel, and rejoin: one RSVP identity and correct attendeeCount without underflow.
- [ ] Test concurrent last-seat requests: at most one new attendee succeeds. Past/closed/full event cases return the specified errors and actionable UI states.
- [ ] Verify no direct client RSVP/count/attendance write succeeds; no client-supplied role, UID, count, or user snapshot is trusted by the server.
- [ ] Verify joined/cancelled state persists across navigation, listener refresh, and app reload. Dispose listeners when membership or account changes.
- [ ] Verify My Events queries constrain companyId, userId, and going status; test corresponding collection-group rules/indexes after integrator wiring.
- [ ] Verify standard iOS sharing supplies useful event information without creating an invite or promising in-app link opening. Use one Join action and explicit joined feedback.
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
