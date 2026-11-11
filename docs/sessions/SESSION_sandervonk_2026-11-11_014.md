# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Avatar landing fix
Agent: Claude Code
Status: completed

## Summary

The avatar flight to the Profile badge landed below and left of the real badge and then snapped. Cause: the landing endpoint was corrected, after the flight, from the badge's reported frame, but the reported frame was measured in screen coordinates and gated by position heuristics, and the fallback/estimate path was used when the report was rejected. The flight now aims at the page-reported frame and re-aims when it arrives.

## Changes

- ui/DIP/Features/Profile/DIPProfileScreen.swift, ProfileBadgeLink.swift, ProfileHeaderCard.swift: the Profile page defines a named coordinate space on its root (stationary in the page, moves with the page while it slides); the badge reports its frame in that space, so the value is the settled screen frame even mid-slide and needs no slide-offset correction. The report is measured on the badge itself (inside the nudge offset), so it includes the (8, -6) nudge.
- ui/DIP/Features/Prototype/DIPPrototypeApp.swift: `badgeFrame` replaces the settled/raw pair and is trusted whenever reported; a report during a flight toward Profile re-aims the animation to the real frame; the landing frame is read again from the same source at completion, so there is no snap; the overlay measures its own screen origin and converts page-space frames into overlay space.

## Validation

- Preview scheme builds. A temporary log (removed) showed the badge's reported frame in the page space (a first attempt wrongly added the nudge a second time: it reported 106,68 and the flyer landed up-right; the measurement taken before the nudge already includes it, 98,74 on this screen) and the landing frame equal to it, with the shell origin at 0,0. A screen recording analysed frame by frame (green avatar centroid): the first frame after the flight and every later frame are at the identical position. The Profile to Home flight lands on the capsule frame computed from header layout (337, 65, 40, 40). No test suites run.

## Decisions

- Pages are still switched by the bottom bar only.

## Handoff

Not verified on a physical phone: the owner's offset may also depend on device screen size or safe areas; the page-space and overlay-origin conversion is meant to cover those, but confirm on the phone.
