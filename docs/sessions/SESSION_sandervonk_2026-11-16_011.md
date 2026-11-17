# Work session

User: sandervonk
Date: 2026-11-16
Workstream: duo-inner-screen
Agent: Claude
Status: completed

## Summary

Replaced the centred phone column on the iPhone Duo's unfolded inner display (951x669 pt landscape, 84 pt sensor strip on the right) with a bespoke wide layout. Everything new is gated on `\.dipDuoOpen`, which is true only when the window reports `UIHinge` updates and the free column width is at least 760 pt. Regular iPhones and iPads never see it. The outer folded display (466x678 pt) keeps the phone column from #226.

## Changes

- ui/DIP/Support/DuoLayout.swift: `DIPDuoLayout.isOpen`, `openMinWidth` (760), open posture spans the whole free width instead of a centred 430 pt column; `\.dipDuoOpen` environment value set by the column controller (root re-rendered when posture changes).
- ui/DIP/Features/Duo/DIPDuoShell.swift (new): `DIPDuoPaneLayout` (rail 88, list 393, divider 1, detail takes the rest), `DIPDuoRail` (ink capsule, white disc for the selected tab, bell with pink count badge), `DIPTabHeader` (phone: the unchanged `DIPHomeHeader`; open: outlined title only), `DIPDuoDetailPlaceholder`, `dipDuoSheetSizing`, `dipCover` (full-screen viewers become centred form sheets), selection ring.
- ui/DIP/Features/Prototype/DIPPrototypeApp.swift: `tabBuilder` split out of `tabPages` (phone behaviour identical); open shell = rail + list pane + detail pane. Home and My Events: list pane left, the event (or challenge, album, attendees) in a detail `NavigationStack` right, with the Join / Activity Chat / Add Photos bar contained in the pane. The first listed event is opened when nothing is selected (`syncDuoSelection`, `duoAutoRoute`); folding the Duo clears only a shell-made selection. Rewards and Profile use the full width with a normal stack. Avatar flight is skipped when open.
- Screens (all gated on `dipDuoOpen`): Home events as a two-column grid, Rewards two columns, Profile two columns without the status-bar fade, My Events selection ring, 20 pt top inset instead of 60, bottom clearance 28 instead of 120, Back hidden on the detail pane's root page, sheets sized as form sheets, onboarding welcome side by side, onboarding tour shown at phone width centred.
- ui/DIPTests/DuoLayoutTests.swift: open-posture rule (never true without a hinge or below 760 pt), pane geometry, phone insets unchanged, default selection.

## Validation

- `xcodebuild test -only-testing:DIPTests/DuoLayoutTests` on Claude-Base: 11 tests, 0 failures. Build of the DIP scheme for Claude-Duo succeeded.
- Phones unchanged: Claude-Base (iPhone 17 Pro) captured with the DuoLayoutUITests capture test on origin/main and on this branch (home, event, my events, memories, rewards, profile, notifications, album, onboarding) and compared pixel by pixel. Rewards, profile, album and onboarding differ only in the status-bar clock digits. Home, event, my events, memories and notifications additionally differ only in mock event time text (26-39 px tall digit bands) derived from the launch clock. No other pixel differs. A final capture after the last code change is in the PR description.
- Duo inner display captured with the iOS simulator control tool (the XCUITest screenshot returns the folded display, which is off, so no Duo UI test was added). Frames: home list+detail, my events, rewards, profile, album, photo viewer, notifications, chat, onboarding welcome, tour.
- Design crit: fresh auditor subagent (the earlier auditor could not be resumed). Blocker (bell looked selected) fixed; polish items listed under Handoff. Independent code review subagent: sheet sizing gaps, sync key and auto-selection reset fixed.
- Not run by design: full suites, SwiftLint-style checks beyond the build.

## Decisions

- One shell, existing screens reused with environment-gated variants instead of forks.
- List pane is 393 pt wide so the phone cards keep their designed 353 pt content width (the challenge card has a fixed 350 pt illustration).
- Full-screen covers are sheets on the open Duo, because a cover spans the window including the sensor strip.
- The tour stays phone-width (its demo scenes depict a phone).

## Handoff

Open items: the tour is a centred phone column (a wide tour needs its own scenes); event detail could use the spare width for an info block and attendee names; Profile has no outline title pill and its column tops do not align exactly; the Add Photos bar covers the last album row (same as on phones); iOS 17 ignores `presentationSizing`, so sheets there still span the window; the posture is only verified on the simulator, not a physical Duo; the folded outer display is unchanged.
