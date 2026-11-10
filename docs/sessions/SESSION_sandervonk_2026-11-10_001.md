# Work session

User: sandervonk
Date: 2026-11-10
Workstream: Rewards tab gift icon
Agent: Claude Code
Status: handoff

## Summary

The Rewards tab icon is now a gift (Heroicons v2 `gift`, MIT, the same pack as the other tab icons) instead of a ticket, in both the unselected (outline, gray) and selected (solid, ink) states.

## Changes

- ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Resources/Home.xcassets/HeroiconsOutlineGift.imageset (new SVG, 30pt, stroke #B5B8C0, same stroke weight as the other outline tab icons).
- ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Resources/Screens.xcassets/navigation_HeroiconsSolidGift.imageset (new SVG, 30pt, ink fill #1E212B for the white selected marker).
- ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Components/DIPHomeComponents.swift: `DIPHomeTab.rewards` and the tab asset lookup use the gift assets.
- home-assets.json and screen-assets.json: provenance entries for the two new assets (source file and sha256).
- The old ticket imagesets are left in the catalogs because other screen-reference copies share the name pattern and nothing else was changed.

## Validation

- `swift test --package-path ui/Packages/DIPDesignSystem`: 9 tests pass.
- Xcode build of the Preview scheme for the iPhone 17 Pro Simulator succeeds; Simulator screenshot shows the gift in the second tab slot, matching the weight and size of the neighbouring icons.
- Not run: the selected (solid) state on screen, because the Rewards tab is not connected (it opens a "not connected yet" notice); full UI test suite.

## Decisions

- Heroicons gift SVGs were taken from the official tailwindlabs/heroicons v2 `optimized/24` set and recoloured to the existing tab colours.
- The main Figma design file still has the ticket in its Navigation Bar component; updating it is a design-owner follow-up.

## Handoff

- Update the Rewards icon in the main Figma file's navigation bar and in the onboarding reference frames to the gift.
- When the Rewards screen is built, check the solid selected state on a device.
