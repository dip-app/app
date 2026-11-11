# Work session

User: sandervonk
Date: 2026-11-11
Workstream: iOS: Home filter polish and My Events pages
Agent: claude
Status: active

## Summary

Owner feedback on the Home interest toggle (not in our style, snaps the list) and on My Events (Active Events and Memories touch and clip at the page padding). One combined PR into `feature/v2-remaining`: the Home toggle is now the shared My Events `DIPSegmentedToggle`, the filter switch is animated, the related Home/Rewards filter polish from the board is done, and My Events is two real horizontal pages.

## Changes

- `ui/Packages/DIPDesignSystem/.../DIPSegmentedToggle.swift`: removed the `.soft` style (nothing else used it); the thumb now slides on any selection change (tap, restored state or paged swipe), spring `DIPMotion.marker`, Reduce Motion linear 0.12 s.
- `DIPMotion.filter(reduceMotion:)` (0.25 s ease; plain cross-fade with Reduce Motion) and new shared `DIPSkeleton`.
- `ui/Packages/DIPCore/.../DIPHomeEventsPresentation.swift` (+ tests): `DIPHomeEventsPhase`/`DIPHomeEventsContent` (skeleton, failure, list, empty states, offline), `DIPHomeCardLayout.equalColumnWidth` (exactly two cards share the row), `DIPHomeFilterAnnouncement`, `DIPPointsDisplay` (loading, unavailable, balance, stale) with zero-points nudge rule.
- `DIPHomeScreen`: toggle is the default style, label "Your interests" (the longer label clipped at 18 pt in half the track); events area swaps in a top-aligned ZStack keyed by scope (old cards drift 28 pt and fade out, new ones in, container height animates, toggle never moves; Reduce Motion = cross-fade); skeleton, inline failure with retry, offline label; two cards fill equal columns.
- `DIPPrototypeApp`: maps the existing load state to the phases (load error with events = offline, without = failure, loading with no events = skeleton), posts `AccessibilityNotification.Announcement` when the scope changes, preview-only flags `--home-events-state=loading|failed|offline`, `--points-state=loading|unavailable|stale`.
- `DIPRewardsScreen`: points pill variants (skeleton, dash, stale with wifi.slash) and the zero-points nudge (text plus solid "Find an event" button).
- `DIPMyEventsScreen`: pinned toggle above a horizontal paging `ScrollView`; each page is its own vertical scroll view with its own 20 pt padding and keeps its own scroll position; two-way sync (`pageID` for the scroll position, `section` for the toggle); announcement on page change.
- Preview app: `--animation-speed=<n>` (design review only). UI tests: `HomeFilterTests` (new methods), `MyEventsPagingTests`, `TransitionFramesCapture` (skips unless `TEST_RUNNER_DIP_SHOT_DIR` is set).

## Validation

- `swift test --filter "HomeEventsPresentationTests|InterestFilterTests"` in `ui/Packages/DIPCore`: 15 tests pass.
- Preview scheme `build-for-testing` and DIP scheme `build` (generic iOS Simulator): pass. DIPTests (the DIP unit-test target) were not run: nothing in it changed.
- Final run (after review fixes), Preview UI tests on the shared simulator under `/tmp/dip-sim-lock`, only these: `MyEventsPagingTests` (5), `HomeFilterTests` (12), `ScreenFlowTests/testMyEventsMemoriesAlbumAndBackNavigation`, `MotionInteractionTests/testPersistentNavigationAndActionStates`, `EmptyStateFlowTests` (6): 25 tests, 0 failures.
- R3 design audit round 1: REVISE (about 7.7); applied: failed state moved to the shared empty state, zero-nudge height animation, re-shot frames with the short label. Left for the owner: Home toggle colour (Home accent vs the events pink) and DIPButton label contrast (shared component). R4 code review: APPROVE WITH FIXES; applied: off-screen page hidden from accessibility, announcement only for swipes, transition direction, preview flags gated to DEBUG, rapid-toggle test; not applied: initial `pageID` in `init` (the `onAppear` set works; a first-frame flash was not observed).
- Screenshots (including mid-slide and mid-swipe frames) under the session scratchpad `hf-shots/`.

## Decisions

- No other two-page toggle exists in the app: only Home and My Events use `DIPSegmentedToggle`; Home's carousel already has 20 pt content padding with a bleed to the edge.
- Home loading/failed/offline reuse the existing load signals; the points pill loading and unavailable states have no live source yet (profile arrives with sign-in) and are reachable through preview flags only.
- A filter switch keeps the toggle's existing haptic (`DIPHaptics.select`); a swipe between My Events pages is silent (navigation).

## Handoff

Quality rounds R3 (design audit) and R4 (code review) are recorded in the PR.
