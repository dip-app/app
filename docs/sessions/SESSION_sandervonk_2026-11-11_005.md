# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Edge swipe back
Agent: Claude Code
Status: completed

## Summary

Restored the iOS interactive swipe-from-the-left-edge back gesture for every screen the shell pushes. The shell pushes all detail screens (event, challenge, participants, album with its photo viewer route) onto one SwiftUI NavigationStack whose navigation bar and back button are hidden, which had disabled the system pop gesture.

## Changes

- ui/DIP/Features/Prototype/DIPInteractivePop.swift (new): UINavigationController becomes the delegate of its interactivePopGestureRecognizer and allows it only while more than one controller is on the stack; it may run alongside inner scroll views.
- ui/ComponentPreview/UITests/HomeReferenceTests.swift: testEdgeSwipeBackReturnsFromEventToHome (opens an event from Home, edge-drags back, expects Home).

## Validation

- Preview scheme, `-only-testing:PreviewUITests/HomeReferenceTests/testEdgeSwipeBackReturnsFromEventToHome`: passed. I did not run the test before the fix, so I did not observe it failing first.
- No other suites run (owner: one compile and one spot test).

## Decisions

- No custom DragGesture was needed: there are no custom push containers. The main tabs use DIPSlidingPages, which is not a navigation stack, so the gesture does not begin there and the tab swipe is untouched. Sheets (chat, edit profile, interest picker) dismiss with the system sheet swipe.

## Handoff

Untested by hand: the swipe on challenge, participants and album screens (same stack, same gesture); the onboarding tour is a separate flow and was not changed.
