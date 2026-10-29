# Design-system working agreement

The repository contains the `DIPDesignSystem` Swift package, canonical JSON tokens, a generator, presentation components and development fixtures. Work continues on `feature/ui-foundations` in [PR #3](https://github.com/dip-app/app/pull/3). The current priority is a native SwiftUI Home fixture that matches the original Figma Home screen. Home comparison evidence and simulator geometry/action checks are recorded in the review notes; live workflows remain unimplemented.

## Reference and acceptance target

Source: [Team 05 High Fidelity Prototype — Home](https://www.figma.com/design/DCIagJo7uk5IOUGqlKzAjf/Team-05-High-Fidelity-Prototype--with-links-?node-id=35-147&m=dev), file `DCIagJo7uk5IOUGqlKzAjf`, node `35:147`, inspected through Figma MCP on October 28–29, 2026. Home is 402 × 874 points. The reference uses Figtree, Fjalla One and Inter, original avatar/event/mascot images, white title text on purple, image-overlay event cards and a dark four-icon navigation pill.

The human's October 29 direction makes fidelity to that screen the current acceptance target. Earlier proposals to substitute system fonts, opaque card metadata, ink title text and native labeled tabs do not define this fixture's appearance. Use matching mock data, not live data that changes the reference. Match font faces, text, imagery, crops, colors, spacing, radii and navigation geometry. The challenge, reward icon and sample notification count are presentation fixtures; they do not expand V1 backend scope.

## Tokens and ownership

Edit `ui/DesignSystem/tokens.json` first, then run:

```sh
python3 scripts/generate-tokens.py
python3 scripts/generate-tokens.py --check
swift test --package-path ui/Packages/DIPDesignSystem
```

Tokens distinguish observed Figma values from proposals. Use semantic names for shared roles; keep feature layout local. Coordinate shared token, generated output and component API changes with consuming workstreams. Feature screens map domain values into presentation inputs; Firebase and authorization stay outside the design-system package.

## Typography and assets

Home resources are bundled under `ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Resources`. Use the original exported assets and register bundled fonts rather than silently falling back to system typography. Asset hashes, source evidence and license limits belong in [asset provenance](asset-provenance.md). Expiring MCP URLs are not runtime dependencies. A screenshot of the Home frame must never substitute for native view implementation.

Google Fonts files include their SIL Open Font License notices. Export from the supplied Figma file establishes the images' prototype source, not third-party redistribution rights. Those images remain prototype review fixtures until their rights are confirmed for release.

## Visual verification and accessibility

Capture the native Home at the reference's 402 × 874 viewport and compare against the original frame. Confirm export bounds before cropping Figma's surrounding shadow; avoid independent stretching. Record app-content differences separately from operating-system status bar/home-indicator differences. Keep a side-by-side or overlay and describe remaining discrepancies honestly. Comparison evidence and measured differences are in the [review notes](../../ui/ComponentPreview/Review/README.md).

Only light appearance is specified. Dark mode remains pending design review. Preserve the reference appearance at the standard text size; review Dynamic Type, VoiceOver names/selected state, touch targets, contrast and long-content behavior separately. The reference's white-on-purple and yellow-on-white text still require accessibility review. Do not claim those concerns are resolved by visual parity or quietly change the approved comparison target.

## Contributor handoff

UI foundations owns shared components, tokens, resource provenance and preview fixtures. Feature owners own screen composition, formatting, navigation and data workflows. Agree on component changes before agents modify dependent consumers. The [component map](components.md) records API boundaries; the [Figma inventory](figma-inventory.json) indexes known nodes and is not a visual audit of every screen. No verified Code Connect mapping is registered.
