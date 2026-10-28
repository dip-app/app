# Design system contributor instructions

Read [root AGENTS.md](../../AGENTS.md), [UI instructions](../AGENTS.md), and [design-system workflow](../../docs/design/README.md) first. These instructions apply to ui/DesignSystem/ and its token source.

1. Agree on a narrowly scoped component or token task before editing shared foundations. Claim affected files in the issue/PR; avoid simultaneous token-generator changes.
2. Use the existing Figma source and semantic token names. Read the relevant Figma node with MCP before implementing a component; record the exact file key and node ID in its documentation.
3. Edit tokens.json and regenerate Swift. Never hand-edit generated Swift files. Run generation drift checks and package tests.
4. Components must not import Firebase, fetch data, authorize users, or know collection paths. Accept display values and callbacks; feature code owns state and workflows.
5. Add component states, accessibility behavior, and previews when implementation starts. Do not add unreviewed screen-specific tokens to the shared palette.
6. Do not claim Code Connect exists until a real SwiftUI component and verified mapping exist. Do not copy temporary Figma asset URLs into application code.
7. Dark mode, typography licensing, and prototype contrast concerns remain review items. Do not silently mark these resolved.

The UI foundations workstream owns canonical tokens, the generator, reusable components in ui/Packages/DIPDesignSystem, and their previews/tests. Feature workstreams consume those APIs and own their feature layouts; coordinate foundation changes through a separate reviewed PR.
