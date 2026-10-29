# Design-system working agreement

The repository contains DIPDesignSystem, canonical JSON tokens, a generator, presentation components and a connected native SwiftUI prototype on [PR #3](https://github.com/dip-app/app/pull/3), branch feature/ui-foundations. The current revision adds Event Details, My Events and Profile to Home, with supporting Participants and Album screens. Eight screen states have fresh same-viewport comparison evidence; all eight simulator tests pass. Native raster differences and remaining manual review are documented.

## Reference and acceptance target

The source is [Team 05 High Fidelity Prototype](https://www.figma.com/design/DCIagJo7uk5IOUGqlKzAjf/Team-05-High-Fidelity-Prototype--with-links-?node-id=35-147&m=dev), file DCIagJo7uk5IOUGqlKzAjf. The inspected reference frames are:

| Screen/state | Node |
| --- | --- |
| Home | 35:147 |
| Event Details / Joined | 46:1397 / 76:1742 |
| My Events / Memories | 76:6032 / 76:6204 |
| Profile | 76:4016 |
| Participants | 76:4932 |
| Album | 46:1995 |

The October 29 human direction requires original visual fidelity at 402 × 874 points, using matching mock data. Match font faces, text, imagery, crops, colors, spacing, radii and navigation geometry. Earlier system-font, opaque-card and native-tab adaptations in the optional gallery are not the visual standard for these screens.

DIPPrototypeApp connects the screens and owns local navigation/join state. Join state survives navigation in this process; profile edits and chat messages remain local. Album uses native photo viewing/sharing and local PhotosPicker imports. These interactions do not implement Firebase, authorization, server counts, persistent RSVP, cloud uploads or production chat. Rewards, notifications and challenge workflows remain explicit notices.

Only Puppy Yoga has the supplied Event Details reference and Joined variant. Other event names use synthetic details in the same visual template, not additional Figma-audited screens. All memory links currently open the supplied reference album. Native edit/chat/photo-picker surfaces are supporting preview UI without supplied matching high-fidelity frames.

## Tokens and ownership

Edit ui/DesignSystem/tokens.json, then regenerate:

```sh
python3 scripts/generate-tokens.py
python3 scripts/generate-tokens.py --check
swift test --package-path ui/Packages/DIPDesignSystem
```

Tokens distinguish observed Figma values from proposals. Use semantic names for shared roles; keep feature layout local. Coordinate shared token, generated output and component API changes with consuming workstreams. Feature screens map domain values into presentation inputs; Firebase and authorization stay outside the design-system package.

## Typography and assets

Original resources are bundled under ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Resources. Home and screen manifests record source asset names and checksums. Register actual bundled fonts; family names alone do not prove they are available. Seven font files supply eight tested named faces, including Figtree Bold, Inter Light and Inter Italic. Preserve OFL notices and [asset provenance](asset-provenance.md).

Temporary MCP URLs are not runtime dependencies. No reference screenshot is an implementation asset. Exporting third-party images from a supplied prototype does not establish release rights; those remain prototype review fixtures pending confirmation.

## Visual verification and accessibility

Compare each requested native state at 402 × 874 against its original frame. Confirm export bounds before cropping the Figma shadow and convert simulator scale by an exact integer factor. Save the reference, actual capture, pair, overlay, difference and metrics. Separate app-content differences from OS/device-shell chrome and never equate an average score with zero differences. Expanded evidence belongs under ui/ComponentPreview/Review/Screens; [review notes](../../ui/ComponentPreview/Review/README.md) record current validation.

Only light appearance is specified. Home and expanded-screen Dynamic Type, VoiceOver, touch targets, RTL, contrast and physical-device review remain separate work. Preserve the requested standard-size visual target instead of silently substituting another design. The prototype's duplicate Join affordances and low-contrast accents remain explicit usability/accessibility decisions for integration review.

## Contributor handoff

UI foundations owns shared components, tokens, resource provenance and preview fixtures. Feature owners own data mapping, formatting and production workflows. Agree on shared APIs before changing consumers. The [component map](components.md) records the current boundary; the [Figma inventory](figma-inventory.json) is a metadata index, not proof every frame was visually audited. No verified Code Connect mapping is registered.
