# DIP design system

This folder owns the source of truth for design tokens. V1 component candidates live in the linked package; product screens remain separate feature work.

- [tokens.json](tokens.json): versioned primitive and semantic tokens. Edit this file first.
- [Component contracts](../../docs/design/components.md): proposed reusable APIs and Figma mappings.
- [AGENTS.md](AGENTS.md): contributor rules for token work.
- [DIPDesignSystem package](../Packages/DIPDesignSystem): generated Swift token package and token tests; reusable presentation components will live here.
- [Design-system workflow](../../docs/design/README.md): adoption, accessibility, assets, and review workflow.

Run the following from the repository root:

```sh
python3 scripts/generate-tokens.py
python3 scripts/generate-tokens.py --check
swift test --package-path ui/Packages/DIPDesignSystem
```
