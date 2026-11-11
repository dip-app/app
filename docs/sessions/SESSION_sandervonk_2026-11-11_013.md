# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Avatar travel animation
Agent: Claude Code
Status: completed

## Summary

The user's avatar now travels between the fixed header's corner capsule (Home, Rewards, My Events) and the assigned-avatar badge on the Profile photo when switching to or from Profile.

## Changes

- ui/DIP/Features/Prototype/DIPPrototypeApp.swift: one avatar view in the shell overlay (`avatarFlyer`) animates its frame and ring with DIPMotion.marker between the capsule anchor (computed from the header layout) and the Profile badge frame (reported by the page, with a computed fallback). While it flies, the real header avatar and the real badge are hidden, so there is never a duplicate or a gap. A tab change mid-flight retargets from the current position (a generation counter ignores stale completions). The first layout and Reduce Motion skip the flight (header and badge crossfade). After a flight that ends on Profile, the endpoint is corrected to the page's own reported badge frame.
- ui/DIP/Features/Profile/ProfileBadgeLink.swift (new): environment link carrying `isHidden` and a frame report callback, plus the fallback geometry.
- ui/DIP/Features/Profile/ProfileHeaderCard.swift: badge uses `DIPMedia(profile.avatar)` (the same media as the header avatar), reports its global frame and hides during a flight.
- Captures: ui/ComponentPreview/Review/Header/avatar-flight-10.png, -12.png, -14.png (frames from a screen recording of Home to Profile).

## Validation

- Preview scheme build succeeded (twice; the last change, hiding the header avatar without a fade, is compile-checked only). Recorded the simulator while tapping Profile: the avatar is visible mid-way between the capsule and the badge while the page slides. The reverse flight was in the recording only at its very end and was not inspected. No test suites run (owner: one compile and captures).

## Decisions

- Flight timing is the tab-bar tap: pages change only from the bottom bar, so there is no interactive swipe to scrub.
- Capsule endpoint is computed from fixed layout constants (20pt inset, 5pt capsule padding, 40pt avatar, 60pt from the top); if the header layout changes, update `headerAvatarFrame`.

## Handoff

Not verified: scroll-offset Profile (the badge endpoint after scrolling and returning), the reverse flight frames, and a device. If the badge endpoint drifts after a scroll, check `reportBadgeFrame` and `settledBadgeFrame`.
