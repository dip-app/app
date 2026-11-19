# Work session

User: sandervonk
Date: 2026-11-19
Workstream: duo-rail-orientation
Agent: Claude (Opus)
Status: completed

## Summary

Owner report on the iPhone Duo: (1) the Duo navigation rail lacked the phone tab bar's drag behavior, (2) the folded outer display showed the app in landscape although that screen is portrait. Follow-up owner instruction: on the folded outer display the navigation belongs in the sensor column on the right, below the wifi / Control Center pill, not at the bottom.

Root cause of (2), reproduced on the Claude-Duo simulator: the generated Info.plist has no `UISupportedInterfaceOrientations` key (checked in the installed DIP.app), so UIKit allows all orientations but upside down, and the app follows the device orientation. When the device orientation is landscape (on the simulator it stays landscape after a rotate or after using the inner display upright, while the folded bezel is still drawn portrait), the outer display rendered at 678x466 with the 430 pt phone column laid along the long edge. Debug probe line before the fix: `hinge=true closed=true interface=3 device=3 screen=678x466 safe=l84 r0 mask=2`. On the inner display the same device orientation maps to a tall 669x951 window, so the inner display itself was behaving as designed. On a physical Duo the outer display would only turn when the phone is really held sideways; we cannot confirm without hardware, so the app now enforces portrait there itself.

## Changes

- `ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Components/DIPTabMarkerTrack.swift` (new): the marker/drag math shared by the phone floating bar (horizontal) and the Duo rail (vertical): resting origin, finger-to-origin clamp, nearest slot.
- `DIPHomeComponents.swift`: `DIPFloatingNavigation` uses the shared track; geometry identical (unit test compares with the old formula; pixel-identical bar crops on iPhone 18 Pro before/after).
- `ui/DIP/Features/Duo/DIPDuoShell.swift`: `DIPDuoRail` has one white disc that follows the finger along the rail (DragGesture minimumDistance 6, simultaneous with the buttons), selects each tab it crosses, settles with `DIPMotion.marker`; Reduce Motion cross-fades and disables the drag like the bar. No haptics (the bar has none for navigation). The bell is outside the drag and optional (`showsNotifications`).
- `ui/DIP/Support/DuoLayout.swift`: `DIPDuoOrientation` (portrait only on the outer display: hinge closed or screen long side under 760 pt; Info.plist default everywhere else), applied through `DIPAppDelegate.application(_:supportedInterfaceOrientationsFor:)` (an extension, so the push file is untouched) plus `setNeedsUpdateOfSupportedInterfaceOrientations` / `requestGeometryUpdate` on hinge updates and again on the next layout when the window has moved display. Debug-only `DIPDuoProbe` log (subsystem work.letsdip.app, category duo). The sensor column (and rail) now exists on the folded outer display too, with `DIPDuoSensor.outerPillClearance` 173 pt (pill measured to y 151 pt). The hosted root keeps one modifier chain in every posture (AnyView would otherwise drop all state on fold). VoiceOver order: page first, then rail.
- `ui/DIP/Features/Prototype/DIPPrototypeApp.swift`: rail publishing moved to the shell root so it works in both postures; folded outer display shows the rail (tabs only, header keeps bell and profile) and the bottom bar only for actions (Join, Activity Chat).
- Home, Rewards, Profile, My Events screens: bottom clearance uses the rail value when the tabs are in the rail (`dipDuoTabsInRail`).
- Tests: `DIPTabMarkerTrackTests` (4), `DuoLayoutTests` (+6: outer portrait, inner default, regular iPhones and iPads unchanged, Info.plist parsing, delegate answers, outer pill clearance and rail fit).

## Validation

- `swift test --filter DIPTabMarkerTrackTests` in ui/Packages/DIPDesignSystem: 4 passed.
- `xcodebuild test-without-building -only-testing:DIPTests/DuoLayoutTests` (Claude-Base, then Claude-Duo after the outer rail change): 24 and 25 passed.
- `npm run check:ios-i18n`: OK (no new strings).
- Claude-Duo simulator: closed posture with device landscape stays portrait (466x678); rail drag mid-gesture and settled on the outer and inner displays; fold and unfold keep the selected tab (Rewards survived open to closed); half_open upright (rail) and sideways (phone layout); event page action bar on the outer display.
- iPhone 18 Pro simulator: floating bar before (DIPHomeComponents.swift from HEAD) vs after: Home and settled crops byte-identical; mid-drag differs only by a 1 pt finger jitter.
- Design review round 1 (fresh reviewer): PASS, 2 P2, 3 P3.

## Decisions

- Scene-level orientation, not a global lock: only a hinge device on its outer display is portrait only; inner display and every other device keep the Info.plist set.
- Review P2 "event content shows under the action bar": rejected, it is the page scrolling under the floating bar exactly as on the phone (Invite Coworker / Share Event buttons).
- Review P2 "outer rail 6 pt right of the pill": rejected after measuring: the rail is centred in the 84 pt column on both displays (outer ink 1170-1373 px, inner 2625-2828 px); the system pill sits about 6 pt left of the column centre on both, so the two displays are consistent.
- Review P3 pill gap: accepted, outer clearance 170 to 173 pt to match the inner gap.
- Review P3 carousel clip and home indicator: unchanged phone behavior, not in scope.

## Follow-up: top space on Duo displays

Owner question: why the Duo screens leave space at the top. Cause: every page reserved the phone's 60 pt status-bar allowance (`DIPDuoPaneLayout.topInset(open:)` returned 60 whenever the posture was not open, and the fixed tab header, the accounts stage, the header avatar flight frame and the Profile badge fallback hardcoded 60). On both Duo displays the real top safe area is 0 (debug probe: `safe=... t0`), because clock and status pill live in the side sensor column. Fix: `DIPDuoSensor.safeTop` carries the real top inset; `topInset(open:sensor:)` returns safeTop + 20 pt on any Duo display with a sensor column and 60 pt otherwise, exposed as `\.dipTopInset`. Used by the tab header, fixed header, Profile, event details, detail header, album, attendees, photo comments, accounts stage, avatar flight and badge fallback. Profile's status-bar fade is off on Duo displays. Not changed: the onboarding tour (fixed scene geometry, headerTop 70) and system sheets (own safe areas). Checks: `DuoLayoutTests` 26 passed (new `testDuoDisplaysDropThePhoneStatusBarAllowance`); Claude-Duo closed Home, Profile and event page before/after; design review PASS (P3 only: pre-existing control sizes and spacing). Regular iPhones get 60 pt by construction (no sensor); not re-captured on a phone simulator for this follow-up.

## Handoff

Not verified: a physical iPhone Duo (whether the outer display ever reports landscape when held upright, real hinge timing), VoiceOver and Switch Control on a device (the drag is an additional gesture; buttons keep labels and traits), Spanish screens on the Duo (no new strings). The rail is not dimmed under alerts (pre-existing for the inner display; touches are blocked while a sheet is up). Disabling landscape on regular iPhones (broken prototype layouts there) is a separate decision.
