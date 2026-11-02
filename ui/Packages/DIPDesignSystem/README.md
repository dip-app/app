# DIPDesignSystem

Presentation foundations for the SwiftUI application. Includes generated color/spacing/radius tokens and V1 SwiftUI presentation candidates. No Firebase dependency or product workflows.

Source: `ui/DesignSystem/tokens.json`. Run `python3 scripts/generate-tokens.py` from the repository root; do not hand-edit generated Swift. Component API proposals and contributor workflow are in `docs/design/components.md` and `docs/design/README.md`.

Run `swift test --package-path ui/Packages/DIPDesignSystem` from the repository root.

V1 presentation candidates now live in Sources/DIPDesignSystem/Components. See [component contracts](../../../docs/design/components.md), [fixture usage](../../DIP/Features/Foundation/README.md), and [preview host](../../ComponentPreview/README.md). Views accept display values and callbacks; the package performs no Firebase or image-network requests.
