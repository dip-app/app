# Prototype fidelity review — October 29, 2026

[PR #3](https://github.com/dip-app/app/pull/3), branch feature/ui-foundations, [issue #2](https://github.com/dip-app/app/issues/2). DIPPrototypeApp connects the original Home, Event Details/Joined, My Events/Memory grid and Profile, with supporting Participants and Album. Default startup is Home. Interactions use local fixtures; no live account, authorization, RSVP, chat or cloud-upload workflow is implemented.

## References and direct launch

Figma file DCIagJo7uk5IOUGqlKzAjf. Every target frame is 402 × 874 points. The expanded-screen MCP session is 0cf05e71-dfb2-4c4a-92f3-db6358767921.

| Launch argument | Original frame | Current verification |
| --- | --- | --- |
| --screen=home | Home 35:147 | [Fresh capture and comparison](Screens/home/home-comparison.png) |
| --screen=event | Event Details 46:1397 | Captured, compared and tested |
| --screen=event-joined | Joined 76:1742 | Captured, compared and tested |
| --screen=events | My Events 76:6032 | Captured, compared and tested |
| --screen=memories | Memories 76:6204 | Captured, compared and tested |
| --screen=profile | Profile 76:4016 | Captured, compared and tested |
| --screen=attendees | Participants 76:4932 | Captured, compared and tested |
| --screen=album | Album 46:1995 | Captured, compared and tested |

The first Home session be39ee55-d9c7-4f0a-9060-c6a86dbffcc7 also inspected Header 46:276, Event Card 46:1162, Avatar 168:2951 and Navigation 46:668.

Expanded evidence belongs in Screens/<screen>/ with figma-<screen>.png, reference-standard.png, <screen>-comparison.png, <screen>-overlay.png, <screen>-difference.png and <screen>-comparison.json. Keep original and native captures separate. Fresh stable captures, geometry/action tests, font registration and full-app checks are complete. [Overview](Screens/overview.png) shows Event Details, My Events and Profile. [Numeric summary](Screens/summary.json) records all eight app-region comparisons. This is not a zero-pixel-difference claim.

## Current expanded verification

Passed all eight simulator tests, the full DIP Simulator build, ten Swift package tests (one contracts plus nine design-system), repository checks and eight baseline rules tests. All113 image/SVG and seven font-file hashes were verified; eight named font faces resolve without fallback.

Native NavigationStack/TabView manage state and accessibility while their bars are hidden; the original custom navigation is rendered by each screen. Regression tests cover joining, attendee/back navigation, local chat, active/memories switching, album photo viewer/back, profile validation/save/tab retention, hidden inactive screens and measured layout.

| State | Mean absolute channel difference /255 | Pixels with any channel difference >10 |
| --- | --- | --- |
| home | 2.1574 | 5.7215% |
| event | 3.0618 | 6.4919% |
| event-joined | 2.9221 | 6.0087% |
| events | 1.6675 | 4.9843% |
| memories | 2.7476 | 8.0711% |
| profile | 3.2476 | 9.8513% |
| attendees | 2.1867 | 5.5891% |
| album | 5.4332 | 14.4823% |

Measure inside the rounded Figma frame at y50...852. Native text/vector anti-aliasing, image resampling and device chrome produce nonzero differences. Review the actual pairs; an average does not establish all local details match. Original My Events uses a754point scroll viewport; other pages use the measured22point bottom boundary.

Stable capture avoids comparing a launch fade with the reference:

```sh
python3 ui/ComponentPreview/capture.py --device YOUR-SIMULATOR-UUID \
  --output /tmp/dip-captures --reference-status-bar
```

Build/install the Preview app first. Capture uses the same402x874 viewport, waits for consecutive stable frames and clears its optional status-bar override afterward. Failure sysdiagnose collection is disabled in the runner to avoid lengthy simulator diagnostics; ordinary test results/failure screenshots remain available.

## Existing Home evidence

These files describe the previous Home-only revision, not proof all new destinations match:

- [Figma Home](figma-home.png), [native Home](reference-standard.png).
- [Side-by-side](home-comparison.png), Figma left and native SwiftUI right.
- [50% overlay](home-overlay.png), [absolute difference](home-difference.png), [report](home-comparison.json).
- [Earlier gallery at Accessibility 3](gallery-accessibility.png), a separate state/API review.

Home was cropped at x104,y100 from its 610 × 1082 shadow-inclusive export, preserving the 402 × 874 frame. The actual iPhone 17 Pro / iOS 27 capture was reduced from 1206 × 2622 by exactly3.

Previous measured app region: inside Figma's rounded frame, y50 through852, excluding OS chrome. Mean absolute channel difference was **2.159 / 255**; **5.7171%** of pixels had a channel difference over10. This was not a zero-pixel-difference claim. Remaining differences included text/vector anti-aliasing and image resampling. Local photo/mascot comparisons found zero-position shifts as their best alignment. The former developer gallery reference-standard.png was replaced with actual Home.

The previous revision passed nine design-system tests, one contracts test, three gallery simulator tests, two Home simulator tests, a full DIP simulator build, repository checks and eight emulator baseline tests. Those results are historical; current expanded checks must be recorded separately.

## Reproduce screen comparisons

Use a simulator with a 402 × 874 logical viewport. The interaction runner may use other iPhones; pixel comparison deliberately rejects a different viewport.

```sh
python3 -m pip install -r ui/ComponentPreview/requirements-review.txt
python3 ui/ComponentPreview/compare.py \
  --name profile \
  --figma /path/to/figma-profile-export.png \
  --simulator /path/to/simulator-profile-capture.png \
  --output /tmp/profile-review
```

The tool accepts a 610 × 1082 export or cropped 402 × 874 frame, records source checksums, converts simulator scale by an exact integer factor and saves pair/overlay/difference/report. A global mean does not establish all local details match.

Native iOS supplies status bar, battery and home indicator. Time formatting, battery appearance, indicator visibility and unmasked screenshot corners differ from the Figma device drawing; these remain visible in full captures and excluded from app-region metrics. No reference screenshot is used as screen implementation. See [asset provenance](../../../docs/design/asset-provenance.md).

## Interaction and scope limits

Home routes to actual Profile, My Events, Puppy Yoga details and attendees. Joining updates local root state, so reopening that event retains Joined during this process. Profile supports a native local edit form; Activity Chat is a local composer/messages sheet. Album supports local PhotosPicker imports, native photo viewing and sharing. There are no Firebase writes or production persistence guarantees.

Only Puppy Yoga has supplied detail/Joined frames; other event details are synthetic content in the same template. Every memory link currently opens the provided reference album. Native edit/chat/photo-picker/viewer UI has no supplied matching high-fidelity frame. Rewards, notifications and challenge workflows remain explicit notices.

Manual VoiceOver, larger text, RTL, contrast and physical-device review remain open. The original duplicate Join affordances remain for fidelity and share local state; a production usability decision is still needed. Light appearance only; image release rights remain unconfirmed.
