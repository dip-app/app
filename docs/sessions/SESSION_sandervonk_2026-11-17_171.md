# Work session

User: sandervonk
Date: 2026-11-17
Workstream: calendar-pill-grey
Agent: Claude (Sonnet 5.5)
Status: completed

## Summary

Event page date pill: an overlap with the member's own non-DIP device calendar entry now shows a neutral gray "busy" state instead of the amber conflict. Another joined DIP event still shows amber. Both together: amber wins and the alert lists both. Home cards and the Duo list follow the same rule.

## Changes

- `ui/DesignSystem/tokens.json` (+ generated `Tokens.generated.swift`): `calendarBusy` (alias completeGray) and `textOnCalendarBusy` (ink).
- `ui/Packages/DIPCore/Sources/DIPCore/DIPCalendarConflicts.swift`: `DIPCalendarConflict.isDIP`, `DIPCalendarPillState.busy`, resolve order DIP > personal > free, `DIPCalendarOverlapText.alertTitle/alertMessage/busyTitle`, `DIPCalendarOverlaps`, three-tier `DIPCalendarFit`.
- `ui/DIP/Features/Shared/DIPDetailComponents.swift`: grey pill (calendar-clock icon, ink text). `DIPEventDetailsScreen.swift`: alert uses the new title/message.
- `ui/DIP/Features/Shared/DIPCalendarModel.swift`: `homeOverlaps` (replaces `conflictedEventIDs`), Debug fixtures `--calendar-fake=busy|busy-untitled|conflict|both` (`conflict`/`both` align one fixture event to overlap a joined one; `MockLaunch.snapshot`).
- Home / Duo / prototype shell: `DIPPhotoEventCard.calendarBadge(.none/.conflict/.busy)`, `DIPCalendarOverlaps` plumbing, Duo default selection.
- Tests: `CalendarBusyStateTests` (new), `CalendarModelTests.testHomeOverlapsSplitPersonalFromDIPAndDIPWins`, existing pill tests updated to DIP-sourced conflicts.
- Docs: `docs/design/stretch/calendar.md` Decisions.

## Validation

- `swift test --filter Calendar` in ui/Packages/DIPCore: 86 tests, 0 failures (includes new CalendarBusyStateTests).
- `xcodebuild build-for-testing` (DIP scheme, Claude-Base) then `test-without-building` for DIPTests/CalendarModelTests and DuoLayoutTests: 33 tests, 0 failures.
- `swift build` in ui/Packages/DIPDesignSystem after the badge ring tweak.
- Simulator captures (Claude-Base iPhone 17 Pro, Claude-Duo, via the simulator control tool): free, busy (grey), DIP conflict (amber), both, added; Home badges. Saved under /tmp/dip-calendar-pill-shots (not committed).
- Design audit (fresh auditor subagent): PASS. Applied: white ring on the grey Home badge. Not applied: outline on the grey pill (would blur solid=pressable / outline=informational), alert copy kept per owner decision (title is the busy entry).
- Full app test suite and UI tests not run (targeted tests only).

## Decisions

- Grey token is `completeGray` #CCCCCC with ink text (about 10:1); outline stays reserved for informational states, so the busy pill is solid because it stays pressable.
- EventKit full access always exposes titles; there is no free/busy-only read, so untitled entries read "Busy" and nothing else is invented. VoiceOver for the grey pill never speaks the title.
- Home: gray circle badge for personal-only overlaps, amber for DIP; order free, personal, DIP.

## Handoff

Pending until the PR is merged: nothing known. No deploy, no backend change.
