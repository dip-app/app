# DIPDesignSystem

Presentation foundations for the SwiftUI application. Currently: generated color, spacing, radius, and typography-reference tokens only. No Firebase dependency, screens, or reusable components have been implemented.

Source: `ui/DesignSystem/tokens.json`. Run `python3 scripts/generate-tokens.py` from the repository root; do not hand-edit generated Swift. Component API proposals and contributor workflow are in `docs/design/components.md` and `docs/design/README.md`.

Run `swift test --package-path ui/Packages/DIPDesignSystem` from the repository root.
