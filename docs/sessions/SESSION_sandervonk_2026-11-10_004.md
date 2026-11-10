# Work session

User: sandervonk
Date: 2026-11-10
Workstream: Onboarding B5 embedded interests
Agent: Claude Code
Status: blocked

## Summary

Data/logic half of onboarding step B5 "Interests" (onboarding is a proposal pending team approval): an embedded mode for `DIPInterestPicker` and an `OnboardingInterestsModel` host model that saves interests through the existing `MemberProfileBridge`/`ProfileEditor` path. Code is written; verification was blocked because the machine's disk filled up (ENOSPC) during the first Xcode build, so no check has completed yet.

## Changes

- `ui/DIP/Features/Profile/DIPInterestPicker.swift`: two initializers. The sheet init (Profile) keeps its NavigationStack, toolbar, inline retry and dismiss. The new `init(options:selection:embedded:)` with `EmbeddedState(isSaving:errorMessage:catalog:)` has no NavigationStack, toolbar, inline retry or dismiss; it shows a non-interactive error label, search capsule, count, the same rows, loading shimmer (6 rows) and a failed-catalog message. Search field, count, rows, empty state and error label are shared private subviews.
- `ui/DIP/Features/Profile/InterestSelectionRules.swift` (new): UI-free 10-item rule, filtering, de-duplication and catalog ordering used by both picker modes and the model.
- `ui/DIP/Features/Onboarding/Interests/OnboardingInterestsModel.swift` (+`+Picker.swift`) (new): pre-selection, isDirty, bar state, save/retry, skip, catalog states, outcome.
- `ui/DIPTests/Onboarding/OnboardingInterestsModelTests.swift` (new).
- `ui/ComponentPreview/App/OnboardingInterestsPreview.swift` (new), `PreviewApp.swift` (`--onboarding-interests` and failure/loading/catalog flags), `ui/ComponentPreview/UITests/OnboardingInterestsTests.swift` (new).

## Validation

Not run to completion. `npm run ios:generate` and the Preview `xcodegen generate` succeeded. The first DIP `xcodebuild build-for-testing` failed when the disk filled (ENOSPC); afterwards no command could start. Pending: `npm run test:swift`, DIP and Preview simulator builds, DIPTests, the new and existing profile interest UI tests, screenshots under `ui/ComponentPreview/Review/`.

## Decisions

- Bar "Start exploring" with no change finishes without writing; if the member cleared pre-selected interests it saves the empty list (the explicit deselection is not discarded).
- Toggling after a failed save clears the error, so the bar returns to "Save and start" for the changed choice; "Try again" retries an unchanged choice.
- Stored ids missing from the catalog stay visible as "Unavailable interest" and are kept on save, matching Profile and docs/contracts/profile-interests.md.
- Embedded rows reuse the `profile.interests.*` accessibility identifiers; the bar uses `onboarding.interests.save`.

## Handoff

Free disk space, then run the pending checks listed under Validation and fix any compile errors. No commit or PR has been made yet. A dedicated simulator "iPhone 17 Pro (B5 interests)" (167ABE2C-51EA-4677-B105-9F0B43190B5A) was created for this session; derived data was in the session scratchpad.
