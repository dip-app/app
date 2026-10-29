# UI foundations preview host

This development-only app renders the gallery in ui/DIP/Features/Foundation. It is outside the production app's source directory and has no Firebase dependency. The production DIP startup is unchanged. No custom fonts, Figma images or default-image catalog are shipped in this host; missing-image/initials states are deliberate until approved assets are supplied by consumers.

From the repository root, with Xcode, an installed iPhone simulator runtime and XcodeGen:

```sh
python3 ui/ComponentPreview/verify.py
```

The script chooses an available iPhone or accepts `--device UDID` / SIMULATOR_ID, generates the ignored Xcode project, and runs three interaction tests. Use `--derived-data /tmp/dip-preview-build` to reuse build output. Open ui/ComponentPreview/DIPFoundationPreview.xcodeproj, scheme Preview, to explore manually. The host sets light appearance because dark mode is not yet designed. Launch argument `--large-text` selects Accessibility 3 text; Xcode previews provide the same variant.

Tests exercise single event-card activation and joined semantics, primary/disabled/in-flight actions, native tab selection, unavailable notification hiding, profile and retry callbacks, and accessibility-text reachability/width. They do not prove VoiceOver reading order, device usability or all visual states; those remain manual review items. Gallery callbacks only update local fixture text/counters, not application data or RSVP state.

[Review notes](Review/README.md) record the Figma nodes, intentional usability adaptations, screenshots and remaining checks. Raw Figma media/expiring URLs are not bundled in the repository. During local review, the same gallery was also run with already-loaded Figma reference images supplied through its initializer; those are review inputs, not approved release assets.
