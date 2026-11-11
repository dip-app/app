# Work session

User: sandervonk
Date: 2026-11-11
Workstream: event-info-rows-actions
Agent: Claude Code
Status: completed

## Summary

Event details When row adds to calendar (same action and gate as the header pill) and Where row opens the same Directions link; Price/Points and past-event rows stay informational.

## Changes

- ui/DIP/Features/EventDetails/DIPEventDetailsScreen.swift (whenRow, whereRow, shared addToCalendar)
- ui/Packages/DIPDesignSystem/.../DIPConversationComponents.swift (DIPPressFeedbackStyle optional cornerRadius)
- ui/ComponentPreview/App/PreviewApp.swift (--fake-directions), UITests/AddToCalendarTests.swift (4 new tests)
- docs/milestones/v2/FRONTEND_PLAN.md (row)

## Validation

- xcodebuild test Preview scheme, AddToCalendarTests: 8 of 8 passed on iPhone 17 Pro simulator
- xcodebuild build DIP scheme: succeeded (before review fixes); tests re-run after review fixes (double-tap guard, Button for Where, glyphs, test hardening): 8 of 8 pass
- Not applied: uniform row rhythm, Added label, wider press highlight, two-tap test (fake adder returns instantly); owner to confirm keeping both rows and header pills
- Figma 46:1397, 76:1742, 46:1755 show no info rows (header and bottom bar only), so no row-level reference exists

## Decisions

- Tappable rows only when the event is not past and can be added or has a maps URL; chevron glyph, 44pt minimum height

## Handoff

Design audit and code review requested from shared reviewers; apply any later findings.

