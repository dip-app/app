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
