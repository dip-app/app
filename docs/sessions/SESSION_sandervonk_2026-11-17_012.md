# Work session

User: sandervonk
Date: 2026-11-17
Workstream: duo-rail-sensor-side
Agent: Claude Code
Status: completed

## Summary
iPhone Duo inner screen: the navigation rail moved from the left into the 84 pt sensor column, below the status pill, so list and detail panes fill from the left edge (detail pane 380 -> 473 pt). Regular iPhones and iPads are untouched.


## Changes
- ui/DIP/Support/DuoLayout.swift: `DIPDuoSensor` (side and width from the safe-area insets, so it follows the pill to either edge), `\.dipDuoSensor`, `DIPDuoRailSlot`; a second hosting controller in the sensor column draws the rail (touches blocked while a sheet is presented).
- ui/DIP/Features/Duo/DIPDuoShell.swift: rail takes column width and pill clearance; pane geometry no longer subtracts the rail.
- ui/DIP/Features/Prototype/DIPPrototypeApp.swift: shell publishes the rail to the slot; rail stays at the leading edge only if no sensor inset exists.
- ui/DIPTests/DuoLayoutTests.swift: sensor side, pane widths, rail fits under the pill.


## Validation
- xcodebuild test -only-testing:DIPTests/DuoLayoutTests: 19 tests, 0 failures.
- Simulator (Claude-Duo, --mock-member): Home, My Events, Rewards, Profile before/after; rail taps switch tabs, bell opens the sheet, rail taps are ignored while the sheet is up. Design auditor: PASS on all four.
- Claude-Base (iPhone 17 Pro) Home, Rewards, My Events, Profile before/after: pixel diff shows only the clock and mock event time text (Rewards/Profile: clock box only).
- Not run: full suites, 180 degree pill on the leading edge (the simulator kept the pill on the right after rotating).


## Decisions
- A single full-width host was tried first; SwiftUI safe-area handling double-inset the content or changed the bottom inset that Home relies on, so the rail is a separate hosting controller and the content host is unchanged.
- Pill clearance is a measured constant (120 pt): UIKit exposes only the side inset, not the pill.
- The rail is not dimmed behind a sheet (it sits beside the presenting content).


## Handoff
None. Screenshots are in the session scratchpad only (27 MB, not committed).
