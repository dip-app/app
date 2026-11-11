# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Onboarding fixup (user avatar, phone-frame bands, B4 bar overlap)
Agent: Claude Code
Status: completed

## Summary

All outstanding owner fixes since #77, in one PR: the tour shows the member's photo or app-assigned avatar instead of initials; the phone frame shows no white band on taller phones; demo bars never rest with tabs and an action on top of each other.

## Changes

- New `OnboardingYou` (`Fixtures/OnboardingDemoFixtures.swift`): the member's uid and photo. `DIPMemberHome` passes the portrait Profile uses (stored photo, then the OAuth photo); otherwise it is the app-assigned avatar (`MediaReference.generatedAvatar(userID:)`). Removed `CrewAvatarImages.you(name:)` (`DIPAvatar` initials) and `youPlaceholderName` ("S").
- Every "you" in the tour uses it: the B0 arrival centre, the header Crew stack, the handoff flight, the accessibility-size B0 avatar (`TourYouAvatar` now draws `DIPMedia`), B1's joined avatar, B2's attendee row and people row, and B4's My Events header and album current user (`MemoriesDemoFixtures.snapshot(for:)`). Coworkers were already Crew faces; no initials remain in the tour.
- Phone frame: the canvas now clips only its sides and rounded bottom (`DemoStage` mask) and the scene canvases no longer clip at 540 pt. On phones whose Stage is taller than the reference, the rest of the real screen (and the cropped hero) runs up to the Stage's top edge instead of leaving a white band. The bottom is unchanged: the canvas ends on the bezel's inner edge and the mini bar sits 21 pt above it (bar centre at screen height − 61), as on a home-indicator iPhone.
- Demo bars: `DemoMiniBar` and B1's bar show tabs only when there is no action (`showsTabs: action == nil`), so "View Album", "Add Photos", "Join the Activity" and the other actions never rest over ghosted tab icons. The swap between them stays the bar's own crossfade.
- Test: `DiscoverJoinSceneTests.testYouIsAPhotoOrTheAssignedAvatar`.

## Validation

- `xcodebuild build-for-testing` (DIP scheme, generic iOS Simulator): TEST BUILD SUCCEEDED.
- Not run, per owner instruction (merge immediately): test suites and simulator captures.

## Decisions

- I could not find a bottom band in the code: the canvas bottom sits on the bezel's inner edge and keeps a real device's 21 pt under the floating bar. If the owner still sees one on the phone, a capture of that device size is needed.

## Handoff

None.
