# 05 — Integration and V1 verification

**Area:** Integration/release coordination. **Owner:** assign one human in the issue. Integrates the four feature workstreams and V1-10/V1-11 from [V1](../../V1.md).

## Pasteable agent brief

> Coordinate V1 integration using `docs/milestones/v1/05-integration/README.md`. Read root `AGENTS.md`, `SESSION.md`, milestone scope, both contract documents, and each feature handoff. Own shared wiring only; do not rewrite feature owners' modules. Integrate reviewed exports, dependency/project changes, Firebase rule/index patches, test discovery, and app composition in dependency order. Preserve deny-all behavior until each opened permission has tests. Record one valid log per work session under `docs/sessions/`, allowing multiple commits; CI requires at least one new valid session log per PR, not one per commit. Report exact checks, coverage scope, manual evidence, and remaining release blockers. Do not deploy merely to test setup.

## Owned paths and coordination

The integration owner coordinates `gcp/functions/src/index.ts`, root/Firebase configuration, `package.json`/`package-lock.json`, function manifests/test-runner wiring, `ui/project.yml`, shared package manifests, `ui/DIP/App/**`, shared CI/scripts, and Firebase rules/indexes. Accept feature-specific patches for these files only after the corresponding owner reviews them. Contract/schema/generator and token changes still require backend+iOS or design+consumer review respectively.

Feature modules, UI/domain/data feature folders, and feature tests remain owned by packets 01–04. Request changes from their owners rather than editing those paths concurrently. Own this packet's README and your own new session logs. Coordinate shared documentation with its author.

## Prerequisites and contracts

Get a human owner and reviewable handoff for all four workstreams. Read [callables](../../../contracts/callables.md), [data ownership](../../../contracts/data-ownership.md), and [component specifications](../../../design/components.md). Confirm actual Firebase project/location, app identifier/signing, default image assets, membership code lookup, revision seed needs, and reviewer ownership before dependent integration. None of those values should be invented.

## Acceptance tests and evidence

- [ ] Register every intended callable with its exact versioned name and configured region; ensure Swift adapters match the wire schemas and Firebase error handling.
- [ ] Verify all new feature test files are discovered and executed. A green command that ignores new files is insufficient.
- [ ] Run `npm ci` with the documented Node version, `npm run check`, `npm run test:rules`, `npm run test:swift`, `npm run ios:generate`, and the appropriate Xcode build/tests. Record unavailable checks instead of claiming success.
- [ ] Verify generated contracts/tokens match their canonical sources; review compatibility, migration, and asset provenance for every shared change.
- [ ] Run one emulator-backed complete V1 flow: register/verify/join company, edit profile, admin creates event, member browses/joins, sees My Events/attendees, cancels/rejoins, organizer edits with conflict handling, and shares via the device share sheet.
- [ ] Test a second company and a second account: no private cross-company data, privileged commands, join-code reads, role/balance/count writes, or stale signed-out data leaks.
- [ ] Exercise concurrent last-seat joins, repeated create requests, stale organizer revisions, and event-time/RSVP consistency in the integrated system.
- [ ] Measure key implemented V1 logic against the at-least-70% unit coverage target. Document denominator/exclusions; do not use generated code, empty modules, or TODO/skipped tests as product coverage.
- [ ] Record another-laptop clean setup/build and physical-device core-flow verification with environment and results.
- [ ] Retest the known usability issues: one Join action, joined confirmation, recognizable My Events, active destination, explicit attendees, prominent dates/locations, and loading/empty/error states.
- [ ] Verify each PR has at least one new valid session log and every work session is represented as root `SESSION.md` requires. Multiple commits in a session are expected.

## Handoff and done status

Publish a concise release-readiness report in the relevant session log/PR: completed feature IDs, checks and coverage evidence, migration/configuration steps, known limitations, and remaining owners/blockers. Repository wiring alone does not satisfy V1. Leave deployment and GitHub administration to the explicitly authorized release/maintainer workflow.
