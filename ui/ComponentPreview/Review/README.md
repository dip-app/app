# Home fidelity review — October 29, 2026

[PR #3](https://github.com/dip-app/app/pull/3), branch feature/ui-foundations, [issue #2](https://github.com/dip-app/app/issues/2). The default preview and DIP startup now render native SwiftUI Home with the original prototype fixtures. Destination taps open an explicit prototype notice; live account, RSVP, challenge and rewards workflows are not implemented.

## Reference and evidence

Figma file DCIagJo7uk5IOUGqlKzAjf, Home 35:147, 402 × 874 points. Official MCP session be39ee55-d9c7-4f0a-9060-c6a86dbffcc7 supplied full context, screenshot, and original image fills. Header 46:276, Event Card 46:1162, Avatar 168:2951, Navigation 46:668 and Event Page 46:1397 were also inspected.

- [Figma Home](figma-home.png): cropped from its 610 × 1082 shadow-inclusive export at x104,y100, preserving the 402 × 874 frame.
- [Native Home](reference-standard.png): actual iPhone 17 Pro / iOS 27 simulator capture, reduced from 1206 × 2622 by exactly 3.
- [Side-by-side](home-comparison.png): Figma on the left, native SwiftUI on the right.
- [50% overlay](home-overlay.png), [absolute difference](home-difference.png), [measurement report](home-comparison.json).
- [Earlier gallery at Accessibility 3](gallery-accessibility.png): this is a separate state/API review, not a Home accessibility approval.

The former reference-standard.png showed a developer gallery. It has been replaced with the actual Home screen. The current implementation uses Figtree/Fjalla One/Inter, original individual illustrations/photos/avatars/SVGs, white-on-purple header, full-photo cards, identical fixture text/counts, and the custom four-icon navigation. No screenshot is used to implement the screen. See [asset provenance](../../../docs/design/asset-provenance.md).

## Comparison result

Measured app region: inside Figma's rounded frame, y50 through852, excluding native status/home-indicator chrome. Mean absolute channel difference is **2.159 / 255**; **5.7171%** of compared pixels have a channel difference over10. This is not a zero-pixel-difference claim. Remaining differences include text/vector anti-aliasing and image resampling between Figma's renderer and native iOS. Local photo/mascot comparisons found zero-position shifts as their best alignment. Layout regression tests independently verify measured positions and dimensions.

Native iOS supplies its status bar, battery and home indicator. Its time formatting, battery appearance, indicator visibility and unmasked screenshot corners differ from Figma's drawn device shell. Those are excluded from the app-region metric and left visible in the full captures.

## Reproduce

Use a simulator with a 402 × 874 logical viewport. The interaction test runner accepts other iPhones; pixel comparison deliberately rejects a different viewport.

```sh
python3 -m pip install -r ui/ComponentPreview/requirements-review.txt
python3 ui/ComponentPreview/compare.py \
  --figma /path/to/figma-home-export.png \
  --simulator /path/to/simulator-capture.png \
  --output /tmp/home-review
```

The comparison accepts the original 610 × 1082 export or cropped 402 × 874 reference. It records input checksums, saves both images, side-by-side, overlay and difference, and reports unrounded input geometry. Review changes visually; a global average does not prove all local details match.

## Validation and limits

Passed: nine design-system package tests (including all five actual font faces), one contracts package test, three retained gallery simulator tests and two Home simulator tests. Home checks cover challenge/event geometry, 80-point navigation hit regions, notifications, attendee action, horizontal event scrolling and explicit fixture destination notices. Full DIP simulator build, repository checks and eight baseline emulator rules tests also passed. CI reruns the complete suite on the PR.

Manual VoiceOver traversal, Home larger-text/RTL/contrast and physical-device review remain open. Light appearance is the supplied target; dark mode is not specified. Prototype image rights need confirmation before a production release.
