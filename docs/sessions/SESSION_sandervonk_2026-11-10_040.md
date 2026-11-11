# Work session

User: sandervonk
Date: 2026-11-10
Workstream: Onboarding P2 tour + scenes
Agent: Claude Code
Status: active

## Summary

Onboarding phase P2 (tour shell) and scenes B2–B5 on top of the merged P0/P1/P3/P4 work (spec v4, `docs/milestones/v2/ONBOARDING_SPEC.md`). In progress.

## Changes

- `ui/Packages/DIPCore/Sources/DIPCore/Onboarding/OnboardingTour.swift` (new): entrance choice (fresh / resume / replay), Crew stack (3 faces + "+n"), header overflow rule, home surfaces with bar treatment and focus target, handoff timing, Stage fills.
- `.../Onboarding/DemoGhost.swift` (new): pure ghost visits, `DemoProgress` helpers (clamped, monotone, callout life).
- `.../Onboarding/Scenes/PeopleInviteTimeline.swift`, `ChallengeTimeline.swift`, `MemoriesTimeline.swift` (new): B2–B4 beat tables transcribed one row per beat with `moves`/`targets`, feature-flag variants, stills and continuous parameters.
- Tests: `ui/Packages/DIPCore/Tests/DIPCoreTests/OnboardingTourTests.swift`, `OnboardingSceneTimelineTests.swift`.

## Validation

- `swift test` in `ui/Packages/DIPCore`: 128 XCTest, 0 failures.

## Decisions

- B2–B4 timelines live in DIPCore (pure, `swift test`-able); their canvases stay in the app.

## Handoff

In progress.
