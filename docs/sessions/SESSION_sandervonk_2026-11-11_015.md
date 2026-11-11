# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Event title wrapping
Agent: Claude Code
Status: completed

## Summary

Event titles on My Events cards, My Events memory tiles and Home event cards no longer clip: they wrap onto up to three lines inside the card padding, anchored bottom-left above the scrim, with the date/location line below.

## Changes

- ui/DIP/Features/MyEvents/DIPMyEventsScreen.swift: active-event card title (40pt) and memory-tile title (20pt) use lineLimit(3), minimumScaleFactor (0.6 and 0.75) as a last resort, leading alignment and vertical fixedSize with full available width; the locality line wraps up to two lines instead of forcing its width.
- ui/Packages/DIPDesignSystem/.../DIPHomeComponents.swift: `DIPPhotoEventCard` (Home cards) had the same fixed-height single-line title and now wraps the same way.
- ui/ComponentPreview/App/LongTitlesPreview.swift (new) and PreviewApp: `--long-titles=active|memories|home` review states with long titles.
- Captures: ui/ComponentPreview/Review/Titles/titles-active.png, titles-memories.png, titles-home.png.

## Validation

- Preview scheme build succeeded. Captures with "Arianne's Carpentry Bash", "Lunch & Learn: Cooking Basics", "Game Night: Board Games & Pizza", "Boat Ride", "Ceramics": all titles show in full on 1 to 3 lines with no edge clipping, and location sits below without overlap. No test suites run.

## Decisions

- Left the event details page title (`DIPEventDetailsScreen`) and rewards/challenge titles alone; they were not reported and were not checked.

## Handoff

If longer titles than three lines are possible, raise lineLimit or truncate with an ellipsis; at three lines the 40pt active card title shrinks only when needed.
