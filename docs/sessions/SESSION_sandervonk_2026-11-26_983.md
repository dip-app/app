# Work session

User: sandervonk
Date: 2026-11-26
Workstream: ios-polish-3
Agent: Claude (Opus), with fresh Opus design reviewers
Status: handoff

## Summary

iOS polish program, wave 3, on main after #363 and #366. The coordinator's two review items first (the bar fade washed out resting controls; implausible mock times), then the remaining audit items: large-text card chips, Duo profile balance, failed upload tiles, onboarding interests art, pull to refresh on My Events and a launch screen from existing brand assets. Pill shades are left for the owner; the PR carries measured contrast.

## Changes

- `DIPEdgeFade.barFadeLength` 24 to 0: the phone bar fade starts at the bar's top edge, so controls resting above the bar are never washed out. Duo panes (short, content rests behind their action bar) use `DIPEdgeFade.paneBar`: opaque from the bar's top edge with a 20 pt fade above it.
- `DIPMockFixtures.v1Events`: events start at 6:30 PM local on their day (not at the current clock time).
- `DIPPhotoEventCard`: at accessibility sizes the face stack gives way and the "going" and points chips stay on one line.
- Duo open Profile: memories under the profile card, actions on the right, so the columns end at similar heights.
- Album failed upload tile: light wash, error-red mark and outline, ink Retry (was a dark scrim that read as maroon).
- Onboarding interests preview: Crew faces until a few interests are picked (was an empty gray card).
- My Events: pull to refresh with Home's reload (`MemberEventRefresh` now shared).
- Launch screen: the DIP mark from the app icon, in brand purple on white (`LaunchLogo`, `LaunchBackground` assets; `UILaunchScreen` in `ui/project.yml` replaces the generated blank one).

## Validation

- `xcodebuild build` (DIP scheme, Debug, Claude-Base) of `main` for before captures and of this branch after each change; `xcodebuild build` of the `Preview` scheme (`ui/ComponentPreview`): succeeded.
- `npm run ios:i18n-sync` then `npm run check:ios-i18n`: OK (no new strings).
- Captures: launch screen, onboarding interests, Home and My Events at AX3 and XXXL, album uploads, event (rest and joined), memories, rewards on Claude-Base; Profile, Home and event on Claude-Duo open; before (main) and after.
- Design review (fresh Opus reviewer each round): round 1 FAIL on one P2 (on the open Duo the action bar sliced the Who's Attending row once the fade no longer reached above the bar); fixed with a pane fade; round 2 FAIL on one P2 (the short fade still left a half-visible row behind the bar); round 3 FAIL on one P2 (the taller 56 pt fade greyed the Who's Attending heading and the Read more link). Final: opaque from the bar's top edge with a 20 pt fade above it, so only the row actually behind the bar dissolves; verified on recaptured Duo screens by the author (three-round limit reached, no fourth reviewer).
- Not run: full suites, `npm run check`, UI tests (owner rule: targeted tests only; no logic with unit tests changed).

## Decisions

- The photo viewer's name pill straddling the photo edge is the human-defined annotation design (components doc), so it stays.
- The folded Duo carousel already bleeds to its page edge; the gap is the rail's own column, so no change.
- White text on the light purple and pink pills and their shades are a locked owner decision; not changed and not flagged.

## Handoff

- Still open: PERF-1 Release launch timing on a device; reviewer P3s (uploading tile style next to the new failed tiles, onboarding faces placement, facts line width with long venues) listed in the audit wave log. CON-1 and VIS-2 closed as owner decisions.
