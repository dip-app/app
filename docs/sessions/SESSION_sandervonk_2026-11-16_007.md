# Work session

User: sandervonk
Date: 2026-11-16
Workstream: iphone-duo
Agent: Claude
Status: ready for review

## Summary

Made the app usable on the iPhone Duo (simulator model iPhone19,4, iOS 27.2 SDK) without changing any other iPhone. Duo behaviour is gated on the window providing `UIHinge` updates (iOS 27.1+), which regular iPhones do not (the hinge is nil there).

## Changes

- ui/DIP/Support/DuoLayout.swift: `DIPDuoLayout.resolve` (pure rule), `DIPHingeObserver` (adds a `UIHingeInteraction`), and `.dipDuoLayout()`, which hosts the app in a child `UIHostingController` column only when a hinge exists.
- ui/DIP/App/DIPApp.swift: one line applying `.dipDuoLayout()` to the root.
- ui/DIPTests/DuoLayoutTests.swift: tests for the pure rule. ui/DIPUITests/DuoLayoutUITests.swift: a Duo assertion (tab bar clear of the island) plus an opt-in screenshot capture (`TEST_RUNNER_DIP_CAPTURE_DIR`).

## Validation

Geometry (Claude-Duo, folded portrait): screen 466x678 pt at 3x. Window safe area: top 0, left 0, bottom 34, right 84. The island is a pill at about x 399-441, y 29-151 pt. Hinge status closed, angle 0. Rotating the outer display gives 678x466 with the 84 pt inset moving to the left or right edge. The app has no orientation restriction in project.yml, so it rotates, and the prototype layouts are broken in landscape on every phone, not only the Duo.

Unfolded posture: the device type lists a second display LCD-1 (2007x2853 px = 669x951 pt, one continuous rounded screen, no hinge gap in its mask). `simctl io screenConfig --display=3 power on` and `--display=1 power off` only blank the device (a reboot was needed). No iOS scene appears on it, so the open posture could not be exercised. The SDK exposes no hinge geometry: `UIHinge` has only `status` (closed, partially open, fully open) and `angle`. The open layout is therefore a rule only (centred column up to 430 pt) and is unverified.

Phones unchanged: Claude-Base (iPhone 17 Pro) was captured with a UI test on origin/main code twice (noise baseline) and again with this change. onboarding, rewards, profile and album are byte-identical. home, event, notifications, my events and memories differ only in mock event time text derived from the launch clock (19:46 vs 20:23 in the same pixels). Nothing else differs.

Checks run: `xcodebuild test -only-testing:DIPTests/DuoLayoutTests` (5 passed). `DIPUITests/DuoLayoutUITests` on Claude-Duo: the assertion passes after the change and failed before it. On Claude-Base the assertion is skipped. Not run by design: full suites.

Design crit: fresh auditor subagent (the earlier auditor could not be resumed), PASS. Optional polish: the Home carousel third card is a flat sliver at the column edge.

## Decisions

- Gate on hinge availability, not on size class or a model string, so iPad, regular phones and phone-landscape side insets are never touched.
- Host the app in a child hosting controller, because SwiftUI `ignoresSafeArea` (used by every prototype screen) expands back under the island whatever padding a parent applies.
- Keep the strip beside the column white. The whole 84 pt height is excluded because the OS reports a rectangular inset.

## Handoff

Open items: the unfolded (669x951) posture is unverified; a two-pane Home and Event layout is deferred; sheets (notifications etc.) still span full width but clear the island; landscape layouts are broken on all phones (pre-existing); the 60 pt header top padding is wasted on the Duo where the safe top is 0; the Home carousel peek at the column edge; no physical Duo test.
