# Work session

User: sandervonk
Date: 2026-10-29
Workstream: 01-ui-foundations
Agent: Codex with documentation/review subagent
Status: completed

## Summary

Corrected Home fidelity on the existing feature/ui-foundations branch / PR #3 after the human rejected the developer gallery as the visual reference. Implemented the actual native SwiftUI Home with identical prototype content, original bundled assets and custom fonts. No live product workflow was added.

## Changes

- Shared Home header, challenge card, full-photo event cards and custom four-icon navigation; fixture composition in ui/DIP/Features/Home.
- Default preview and DIP startup display Home. The earlier state/API gallery remains behind --gallery.
- Bundled 22 original Figma image/SVG assets and five font faces with OFL licenses, source/hash manifests and provenance.
- Added font-fallback regression plus two Home geometry/interaction tests; preserved three gallery tests.
- Added same-viewport comparison tooling, source/native screenshots, pair, overlay, difference and numeric report; replaced the misleading reference-standard gallery image.
- Updated component contracts, milestone tracker, current state, provenance and review instructions.

## Validation

- npm run check passed: contract/seed checks, generation, documentation/session tooling and Functions build. Seven pre-existing backend feature TODO tests remain unimplemented.
- npm run test:rules passed: eight local Firebase baseline emulator tests; no live deployment.
- npm run test:swift passed: one contract and nine design-system tests, including all five bundled font faces resolving to their intended families.
- Simulator: three gallery tests passed; final focused Home run passed both tests on iPhone 17 Pro / iOS 27. Geometry asserts challenge x20/y165/362x225, first event x20/y442/163x205 and 80-point navigation hit regions.
- Full DIP generic iOS Simulator build passed; final incremental build and publication CI recorded in PR.
- Verified all 22 image/SVG and five font manifest hashes.
- Same-viewport comparison: 402x874; source crop x104/y100 from 610x1082 shadow export; simulator reduced by exactly3. App-region mean absolute channel difference2.159/255;5.7171% pixels have any channel difference over10. Nonzero result is explicitly reported. Text/vector rasterization and image filtering differ across renderers; native OS chrome/device-shell corners excluded from the metric.
- Independent read-only code/visual review found no material Home-only fixture regression.

## Decisions

The user's October29 fidelity direction supersedes earlier system-font/native-tab/opaque-card visual adaptations. Keep original white-on-purple/yellow accents for comparison and review accessibility separately. Prototype challenge/rewards presentation does not implement V2 workflows. Image redistribution rights remain unknown; bundled media is supplied prototype review content. Native OS chrome stays native rather than painting a fake status bar.

## Handoff

Review PR #3 and ui/ComponentPreview/Review/home-comparison.png (Figma left, SwiftUI right). Manual Home VoiceOver, larger text, RTL, contrast, physical-device checks and image release rights remain open. There are no connected destination screens, Firebase repositories, account or RSVP workflows. Other feature owners should use the measured Home components and exact Figma resources as the visual standard, then implement their contracts/data flows separately. Do not mistake retained gallery adaptations for the Home target or claim zero pixel differences.
