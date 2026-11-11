# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Onboarding Debug replay after sign-out; "Finding your company" minimum time
Agent: Claude Code
Status: completed

## Summary

Two owner requests. Debug builds replay the full tour after sign-out, and `--reset-onboarding` clears all tour records at launch. The sign-in Stage keeps "Finding your company" up for a short minimum so its animation is seen.

## Changes

- `ui/DIP/Features/Accounts/DIPMemberHome.swift`: Profile's Sign out and the tour's first-step Sign out go through `signOut()`, which in `#if DEBUG` removes the uid's `dip.onboarding.v1.<uid>` record first. Release is unchanged.
- `ui/DIP/Features/Onboarding/Tour/OnboardingTourSettings.swift`: Debug `--reset-onboarding` clears every `dip.onboarding.v1.*` key once per launch, in both the real app and the Preview app, since both use `.standard()`.
- `ui/DIP/Features/Accounts/AccountsRootView.swift`:
  - New `AccountsStage.minimumResolvingDuration` (2.0 s, rounded up to whole 0.55 s wheel turns, so 2.2 s) and `reducedMotionMinimumResolvingDuration` (0.8 s).
  - When the session leaves `.resolving` early, the root view keeps showing the Stage with `heldRoute: .resolving` for the remainder, then shows the member, notice or problem as usual.
  - It only pads; a slower resolution adds nothing.
  - `--no-resolving-delay` sets both minimums to 0.
- `AccountsStageView.heldRoute` (new, optional).
- `ui/README.md`: both features are documented next to the mock-launch notes.
- Tests: `ResolvingHoldTests` (in `AccountsStageTests.swift`).

## Validation

- `xcodegen generate` + `xcodebuild build-for-testing` (DIP scheme, generic iOS Simulator): TEST BUILD SUCCEEDED.
- No suites or captures were run, per owner instruction.

## Decisions

- The hold rounds up to whole wheel turns so the wheel stops on a clean beat. Reduce Motion has a static indicator, so its minimum is not rounded.
- Existing UI tests already allow 5–10 s for sign-in, so they keep working with the 2.2 s hold. New tests can pass `--no-resolving-delay`.

## Handoff

None.
