# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Onboarding owner fixes (B2 width, My Events pointer, handoff snap)
Agent: Claude Code
Status: completed

## Summary

Three fixes from the owner's on-device testing of the merged onboarding tour (PR #63). No contract, rules or backend change.

## Changes

- B2 "Who's going": the event page renders at the phone's true width. The `b2.zoom` beat (1.35× on Who's Attending) cropped it at both sides ("ASTA NIGHT"); it no longer scales anything and stays in the table so the timing is unchanged (`ui/DIP/Features/Onboarding/Scenes/PeopleInviteScene.swift`, spec §3 B2 row).
- B4 "My Events" pointer: the callout and the ghost's start now aim at the real My Events tab (3rd of 4, canvas x 240), not the bar's centre. The x comes from the bar's own slot geometry through the new `DIPFloatingNavigation.tabCenterX(_:tabs:width:)` (additive) and `DemoMiniBar.tabCenter(_:)`. `MemoriesTimeline.Point.myEventsTab` is now (240, 479), asserted against the bar geometry in `DemoMiniBarTests`.
- Handoff snap: the tour's Bar was `.disabled` during the handoff, which draws its tab buttons dimmed (plain button style). When the tour layer was removed, the shell's enabled bar underneath showed brighter. It now uses `.allowsHitTesting(false)`, so the last animated frame matches the resting one (`OnboardingTourView.swift`, both layouts).

## Validation

- `xcodebuild build-for-testing` (DIP scheme, generic iOS Simulator): TEST BUILD SUCCEEDED, which compiles the new `DemoMiniBarTests`.
- Not run, per owner instruction: test suites, simulator captures. The handoff fix is reasoned from the code (the only state that changes when the tour layer is removed is the disabled bar), not observed on a device.

## Decisions

- The B2 zoom is removed rather than retuned: the owner asked for no extra scale.

## Handoff

- Later follow-ups (not started, by instruction): Preview comparison of the loading-indicator variants (`--progress-style`), haptic call sites for other areas.
