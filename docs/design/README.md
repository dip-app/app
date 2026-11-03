# Design-system working agreement

The repository contains DIPDesignSystem, canonical JSON tokens, a generator, presentation components and a connected native SwiftUI prototype on [PR #3](https://github.com/dip-app/app/pull/3), branch feature/ui-foundations. The current revision adds Event Details, My Events and Profile to Home, with supporting Participants and Album screens. The pre-motion revision has same-viewport evidence for eight screen states and eight passing simulator tests. The current priority is a persistent, animated bottom component and sliding page/section transitions. The motion revision passed a full app build and nine simulator UI tests, with navigation/section/page clips in ui/ComponentPreview/Review/Motion. Integrated verification of the subsequent repository refactor is pending; earlier static or motion results do not verify that refactor.

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

The October 29 human direction requires original visual fidelity at 402 × 874 points, using matching mock data. Match font faces, text, imagery, crops, colors, spacing, radii and navigation geometry. Earlier system-font, opaque-card and native-tab adaptations in the optional gallery are not the visual standard for these screens. The latest correction also requires motion fidelity: one persistent bottom component, a sliding marker/crossfading icons, Action/Complete overlay fades, sliding Active/Memory content and side-entering pages. See [motion and composition contracts](motion.md).

DIPPrototypeApp connects screens, owns navigation and injects DIPRepository. DIPAppViewModel observes snapshots; feature views receive data and callbacks. DIPMockRepository currently owns joined state, profile edits, messages and photo additions for its instance lifetime. Album uses native viewing/sharing and PhotosPicker selection, followed by a repository command. These interactions do not implement Firebase, authorization, server counts, persistent RSVP, cloud uploads or production chat. Rewards, notifications and challenge workflows remain explicit notices.

Only Puppy Yoga has the supplied Event Details reference and Joined variant. Other event names use synthetic details in the same visual template, not additional Figma-audited screens. Memory links use stable memory/event IDs; the mock retains synthetic reference album content. Native edit/chat/photo-picker surfaces are supporting preview UI without supplied matching high-fidelity frames.

The bottom component belongs to DIPPrototypeApp, outside page transitions. Composed feature screens suppress their standalone footer; they do not mount competing navigation bars. Both in-page and bottom Join actions read the same observed snapshot and call the same view-model command; no joined Binding is mutated by the view. This takes priority over adding Past Event or photo-selection pages, which were inspected but remain deferred.

## Tokens and ownership

Edit ui/DesignSystem/tokens.json, then regenerate:

```sh
python3 scripts/generate-tokens.py
python3 scripts/generate-tokens.py --check
swift test --package-path ui/Packages/DIPDesignSystem
```

Tokens distinguish observed Figma values from proposals. Use semantic names for shared roles; keep feature layout local. Coordinate shared token, generated output and component API changes with consuming workstreams. Feature screens render DIPCore read models through shared presentation inputs; DIPMedia supports asset, URL and byte references. The [repository contract](../contracts/ui-repositories.md) and [ADR 0005](../adr/0005-observable-ui-repositories.md) define the interchangeable adapter boundary. Firebase and authorization stay outside the design-system package.

## Typography and assets

Original resources are bundled under ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Resources. Home and screen manifests record source asset names and checksums. Register actual bundled fonts; family names alone do not prove they are available. Seven font files supply eight tested named faces, including Figtree Bold, Inter Light and Inter Italic. Preserve OFL notices and [asset provenance](asset-provenance.md).

Temporary MCP URLs are not runtime dependencies. No reference screenshot is an implementation asset. Exporting third-party images from a supplied prototype does not establish release rights; those remain prototype review fixtures pending confirmation.

## Visual verification and accessibility

Compare each requested native state at 402 × 874 against its original frame. Confirm export bounds before cropping the Figma shadow and convert simulator scale by an exact integer factor. Save the reference, actual capture, pair, overlay, difference and metrics. Separate app-content differences from OS/device-shell chrome and never equate an average score with zero differences. Expanded evidence belongs under ui/ComponentPreview/Review/Screens; [review notes](../../ui/ComponentPreview/Review/README.md) record current validation.

Only light appearance is specified. Home and expanded-screen Dynamic Type, VoiceOver, touch targets, RTL, contrast and physical-device review remain separate work. Preserve the requested standard-size visual target instead of silently substituting another design. The prototype's duplicate Join affordances and low-contrast accents remain explicit usability/accessibility decisions for integration review.

## Contributor handoff

UI foundations owns shared components, tokens, resource provenance and preview fixtures. Feature owners own data mapping, formatting and production workflows. Agree on shared APIs before changing consumers. The [component map](components.md) records the current boundary; the [Figma inventory](figma-inventory.json) is a metadata index, not proof every frame was visually audited. No verified Code Connect mapping is registered.
