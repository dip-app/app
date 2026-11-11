# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Onboarding CTA copy consistency
Agent: Claude Code
Status: completed

## Summary

Owner note: the onboarding step buttons didn't share one voice ("And after the event?" next to "Show me around"). Every step CTA is now a short first-person imperative (verb + object), with no questions or "And…" fragments.

## Changes

- `ui/DIP/Features/Onboarding/Tour/OnboardingCopy.swift`:
  - B2 "What are challenges?" → "Show me challenges"; without B3 it reads "Show me memories".
  - B3 "And after the event?" → "Show me memories".
  - B4 "Make it yours" → "Pick my interests".
  - String Catalog keys are unchanged.
- Updated the same strings in `docs/milestones/v2/ONBOARDING_SPEC.md` (step copy and §7 frames), `ui/DIPTests/Onboarding/OnboardingTourTests.swift`, `ui/ComponentPreview/App/OnboardingDemoPreview.swift` and the Review README.

Final labels:
- B0 "Show me around"
- B1 "See who's going"
- B2 "Show me challenges" / "Show me memories"
- B3 "Show me memories"
- B4 "Pick my interests"
- B5 "Save and start" (with a selection) / "Start exploring" (none) / "Try again" (after a failed save), with "Saving…" as the progress state
- Handoff wait: "Getting your events…" (progress, not an action)
- Header: "Skip" ("Done" in replay), Back, Sign out (icon, first first-run step). B5 secondary: "Skip for now".

## Validation

- `xcodebuild build-for-testing` (DIP scheme, generic iOS Simulator): TEST BUILD SUCCEEDED.
- Test suites were not run, by owner instruction.

## Decisions

- Skip, Done, Back, Sign out, "Skip for now" and B5's labels already fit and are kept. The handoff wait text is a status, not a CTA, so it stays.

## Handoff

None.
