# Design-system setup and working agreement

The repository contains a standalone `DIPDesignSystem` Swift package, a canonical JSON token file, a generator, tests, and component specifications. V1 presentation-component candidates and a development fixture gallery are now implemented on feature/ui-foundations; account/event product screens remain separate feature work. Contributors can build features independently against the component contracts while the shared package evolves through review.

## Sources and scope

The Home frame (`35:147`) in Figma file `DCIagJo7uk5IOUGqlKzAjf` was read through Figma MCP on October 28, 2026. Reference colors are purple `#7B88FA`, challenge pink `#FB72E4`, dark ink/navigation `#1E212B`, white `#FFFFFF`, muted surface `#ECECEC`, and notification yellow `#FFCC3E`. The Figma frame uses Figtree, Fjalla One, and Inter. Reference geometry includes 20 pt content inset, 20 pt event-card radius, 25 pt header-pill radius, 40 pt navigation radius, and 44 pt minimum interaction target as an accessibility proposal rather than a measurement from the prototype.

`ui/DesignSystem/tokens.json` records origin per token. `figma` means observed in the imported Home reference, `proposal` means a setup recommendation that needs design review. This distinction matters: a copied prototype value is evidence, not proof it is accessible or suitable for every screen.

## Token ownership and consumption

Edit canonical tokens first, then run:

```sh
python3 scripts/generate-tokens.py
python3 scripts/generate-tokens.py --check
swift test --package-path ui/Packages/DIPDesignSystem
```

The generator checks alias references, color syntax, numeric ranges, names, and typography declarations. It produces Foundation-only Swift constants so unit tests do not require a simulator or Firebase. Future SwiftUI components should use semantic names such as `DIPTokens.Color.textPrimary`, not primitive brand colors or inline hex values. Keep the conversion to SwiftUI `Color` in the design-system package when that work starts.

Primitive names describe values; semantic names describe purpose. A feature requiring a new value should first check whether an existing semantic role is appropriate. Add a shared semantic role only when more than one use or an explicit design requirement justifies it. Keep feature layout concerns local.

## Typography and assets

Font family names in the manifest are design references, not installed fonts. Obtain the correct font files, verify their licenses and attribution requirements, add them to the appropriate bundle, register them in the app, and validate Dynamic Type before adopting custom fonts. Until then, implementation should use system typography with semantic text styles; do not silently map a family name to an unavailable font.

Download approved static illustrations/icons from Figma when implementing the associated component and record their source, license, dimensions, intended slot, and export date. Do not use expiring MCP URLs in source. Do not use the Home screenshot as a screen implementation asset. No font or image assets are bundled in this setup.

## Accessibility and modes

Only the **light** mode is specified. Dark-mode colors have not been designed or approved. The token manifest records `darkModeStatus: pending-design-review`; a future dark mode must introduce tested semantic values rather than invert primitive colors automatically. The initial app can explicitly use light appearance until design approval, if the team chooses that policy.

The prototype's white text on purple and yellow notifications on white need contrast review. The setup proposes dark ink for `textOnAccent`, preserving the prototype purple as the background while giving small text a stronger contrast. This proposal is not a claim that the prototype was changed. Tests verify the semantic text/background pairs currently provided, not every possible color pairing. Challenge pink and yellow are accent/decorative colors and must not be used as small text on white without checking contrast.

Component acceptance criteria: minimum 44 pt target, readable Dynamic Type without clipped labels, semantic VoiceOver labels, selected/validation states distinguishable beyond color, reduced-motion respect, and sufficient contrast for the specific context. Add previews for long text, loading, empty, error, disabled, and large text when components are implemented. Snapshot testing can be introduced with those components; setup does not manufacture screen snapshots or claim visual parity.

## Parallel contributor workflow

The UI foundations workstream owns `ui/DesignSystem/tokens.json`, its generator, and reusable presentation components, previews, and tests in `ui/Packages/DIPDesignSystem`. Assign one owner per shared component or token change. Feature workstreams own their feature screens and view models and consume foundation APIs; they request API changes in a focused foundations PR. Data adapters and Firebase imports belong outside this package. Specify component inputs and callbacks before two agents work on consumers and producers simultaneously. Include the relevant Figma node, affected semantic tokens, accessibility evidence, and API compatibility notes in the PR.

The component map is in [components.md](components.md). It records proposed APIs and actual inspected node IDs. It is not Code Connect. Once SwiftUI components exist, inspect their Figma variants and add verified SwiftUI Code Connect mappings in a separate change.

See [Figma inventory](figma-inventory.json) for the Final page section/screen IDs retrieved through MCP. This metadata index is not a visual audit of every screen.
