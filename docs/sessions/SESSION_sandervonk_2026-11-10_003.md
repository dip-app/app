# Work session

User: sandervonk
Date: 2026-11-10
Workstream: Onboarding P0 core
Agent: Claude Code
Status: handoff

## Summary

Implemented phase P0 of the onboarding design spec (`docs/milestones/v2/ONBOARDING_SPEC.md` §2 and §5): the pure, SwiftUI-free DIPCore core for the post-membership tour. It covers the step list and feature flags, a value-type flow state machine, the per-uid UserDefaults record store, and the demo timeline engine with the spring-settle timing validator. All of it is unit tested. No UI, app target, contract, rules or backend change. Onboarding is still an uncommitted V2 proposal (item O) pending team approval; this branch makes no claim that any onboarding screen exists.

The P0 row in the spec also lists the `AccountsRoute` split, the Profile "How DIP works" row and skip/resume plumbing behind a flag. Those touch the app target and were out of this task's scope; they remain pending.

## Changes

- `ui/Packages/DIPCore/Sources/DIPCore/Onboarding/OnboardingStep.swift`: `OnboardingStep` (B0 `arrival` ... B5 `interests`, `specID`, `hasHostFace`, `pillTitle`), `OnboardingFeatures` OptionSet (`.invites`, `.challenges`, `.points`, `.albums`, `.interestFilter`, `.all`), `availableSteps(features:catalogEmpty:includeArrival:)`.
- `.../Onboarding/OnboardingFlow.swift`: `OnboardingFlow` with modes `.firstRun` / `.replay`, phases `.step` / `.handoff(outcome)`, transitions `next(at:)`, `back()`, `skip(at:)`, `beginHandoff(at:)` returning `(flow, effects)`, `resume(record:features:catalogEmpty:)`, and derived `progress`, `crewStackCount`, `canGoBack`, `showsSkip`, `announcement(for:)`.
- `.../Onboarding/OnboardingRecordStore.swift`: `OnboardingRecord` (version, lastStep, outcome, updatedAt; tolerant decoding of unknown step names), `OnboardingOutcome`, `OnboardingRecordStore` protocol with `isComplete(uid:)` and `apply(_:uid:)`, `UserDefaultsOnboardingRecordStore(defaults:)` with key `dip.onboarding.v1.<uid>` and `removeRecord(for:)`.
- `.../Onboarding/DemoTimeline.swift`: `AnimationSpec` (+ `settleTime`), `OnboardingAnimation` token specs, `DemoBeat<Action>` (with `moves` / `targets` / `label`), `DemoScript<State>` (`state(at:)`, `finalState`, `stillStates`, `beats(between:and:)`, `scrubbedTime(from:dragging:)`, `validate()`), `DemoScriptIssue`, `Duration.secondsValue`.
- Tests: `ui/Packages/DIPCore/Tests/DIPCoreTests/OnboardingFlowTests.swift` (22), `OnboardingRecordStoreTests.swift` (7), `DemoTimelineTests.swift` (12).
- `docs/milestones/v2/ONBOARDING_SPEC.md`: the v2 spec copied verbatim (it already passed the docs check).
- `docs/milestones/v2/FRONTEND_PLAN.md`: the orchestrator's uncommitted plan added to the branch, with the "O - Onboarding" section replaced by a pointer to the spec and the summary row updated.

## Validation

- `swift test --package-path ui/Packages/DIPCore`: 81 XCTest tests (DIPCoreTests and DIPPresentationTests) and 5 Swift Testing tests passed, 0 failures, including the 41 new onboarding tests. A forced rebuild of the new files with `swift build --build-tests` printed no warnings.
- `swift test --package-path ui/Packages/DIPContracts` (1 test), `ui/Packages/DIPDesignSystem` (9), `ui/Packages/DIPAccounts` (24 Swift Testing): all passed (the `npm run test:swift` set).
- `python3 scripts/check-docs.py`: "Checked local Markdown file links in 142 documents".
- `npm ci` then `npm run check`: exit 0 (generated check, session tests, docs, contracts 13 pass, build, unit 87 pass / 6 todo). Ran on Node v26.7.0; `package.json` and AGENTS.md ask for Node 24.12+ (<25), so this is not the pinned toolchain.
- `python3 scripts/session-log.py check --base origin/main` after committing: passed (this log is the PR's new log). Named `_003` because `_001` already exists on `feature/rewards-gift-icon` and in other local checkouts for the same date.
- Follow-up (spec v4): `swift test --package-path ui/Packages/DIPCore`, `python3 scripts/check-docs.py` and `python3 scripts/session-log.py check --base origin/main` re-run after the v4 changes; results below under "Follow-up".
- Not run: `npm run test:rules` (no rules change), Xcode project generation/build (pure package change, no app code).

## Decisions

- **lastStep semantics.** `next()` writes `lastStep` = the step that just began, so "kill at B3 resumes B3" holds. `back()` writes nothing, per the spec's "written when a step settles"; a relaunch after Back resumes the furthest settled step.
- **Resume clamping.** A stored step removed by the current flags clamps forward to the next available step in tour order, or to the last available step when none follows (e.g. B5 removed by an empty catalog → B4). Restarting at B0 was rejected as a worse experience.
- **Version mismatch.** A record whose `version` is not 1 is treated as absent by both `resume` and `isComplete`, so the two never disagree. Unknown `lastStep` names decode to `nil` without discarding the outcome; any other unreadable data reads as no record.
- **Skip on B5.** `skip()` works from any step and writes `.skipped`; the header Skip is hidden on B5 (`showsSkip`), where "Skip for now" should call `next()` (finished, no interest save).
- **Handoff idempotency.** Once in `.handoff`, every transition returns the same flow and no effects; the first outcome wins.
- **Replay** excludes B0 and filters out every `.persist` effect; announcements still fire.
- **Announcements** are built in DIPCore with `String(localized:defaultValue:)` keys (`onboarding.pill.*`, "Step %lld of %lld, %@"), resolved against the app's main-bundle String Catalog once P2 adds those keys.
- **Settle time.** The spec says "within 1%", but its settle column (stage ≈ 0.9 s etc.) matches SwiftUI `Spring.settlingDuration`, which is about a 0.01% threshold. `AnimationSpec.settleTime` uses the decay envelope to 1e-4 (`ln(1e4) / (ζ·2π/response)`), at or below SwiftUI's values and within 10% of them (asserted in a test for stage, expand, hop, reveal, affordance, marker and section). With this rule the spec's B1 table is off: "tap Join" at 3.75 s targets the hero that `expand` started moving at 2.90 s and settles ≈ 3.77 s; the test shows 3.80 s passes.
- **Timing validator** needs beats to declare `moves` / `targets` element names; the rule only compares beats that share an element, so property-only overlaps stay legal.

## Handoff

- Pending for P0 (app target, needs an owner and a coordinated PR): split `AccountsRoute.progress` into `.pending` / `.resolving`, the Profile "How DIP works" row, and the skip/resume plumbing behind `OnboardingFeatureFlags`.
- Spec follow-ups raised here (B1 "tap Join" timing, settle-time definition) are resolved in spec v4 (ghostToBar at 3.82 s; settle = SwiftUI `settlingDuration`). Scene scripts come in P3+ and must pass both `validate()` and the app-level SwiftUI XCTest from spec §5.
- P2/P3 consumers should use `OnboardingFlow` + `OnboardingRecordStore.apply(_:uid:)`, `DemoScript.state(at:)` for every render path, and `OnboardingAnimation` specs mapped to SwiftUI in the app's `OnboardingMotion`.
- The PR is open for review and must not be merged until the team approves item O.

## Follow-up (same session, spec v4)

- Replaced `docs/milestones/v2/ONBOARDING_SPEC.md` with the audited spec v4 (verbatim; docs check passes).
- Merged `origin/main` (PR #50 added `docs/milestones/v2/FRONTEND_PLAN.md`); resolved the add/add conflict by taking main's version and only turning the onboarding section's plain-text spec path into a link to `ONBOARDING_SPEC.md`.
- `OnboardingStep.pillTitle` for `.interests` now returns "Interests" (v4 §3 B5); announcement reads "Step 5 of 5, Interests". Flow test updated to cover every pill title.
- Settle test now checks the v4 §5 SwiftUI values (stage 0.946, expand 0.868, hop 0.867, reveal 1.002, affordance 0.975, marker 0.707, section 1.000 as `.spring(0.625, 1.0)`): the engine estimate is ≤ SwiftUI and ≥ 90% of it. `OnboardingAnimation` keeps its eight constants; per v4 §5 the app adds `reveal` and `section` in `OnboardingMotion`.
- Checks after the follow-up: `swift test --package-path ui/Packages/DIPCore` passed (81 XCTest + 5 Swift Testing, 0 failures); `python3 scripts/check-docs.py` checked 144 documents; `python3 scripts/session-log.py check --base origin/main` validated 1 log. Local `.build` folders, `node_modules` and scratch binaries were deleted afterwards to save disk space.
