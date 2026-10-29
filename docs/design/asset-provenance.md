# Home fixture asset provenance

The native SwiftUI Home fixture references the supplied [Figma Home frame](https://www.figma.com/design/DCIagJo7uk5IOUGqlKzAjf/Team-05-High-Fidelity-Prototype--with-links-?node-id=35-147&m=dev), file `DCIagJo7uk5IOUGqlKzAjf`, node `35:147`. Resources were retrieved through official Figma MCP for the October 29, 2026 fidelity work on `feature/ui-foundations`.

## Exported prototype assets

Resource root: `ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Resources`. The `home-assets.json` manifest records each bundled Home asset and its SHA-256 checksum so reviewers can identify the exact files used. This includes the prototype's event photography, avatars, mascot and navigation/header icons. Assets are bundled locally; temporary MCP download URLs must not be runtime dependencies. The full-frame Home screenshot is a comparison reference only and must not be used to implement the screen.

Figma export establishes where these files came from, not who owns their copyrights or their release licenses. Third-party photography, illustrations and avatar rights are **unknown**. Treat them as supplied prototype review fixtures until the team confirms redistribution rights or replaces them with cleared equivalents. Do not attribute ownership to the team merely because a file appears in its prototype.

## Fonts

Figtree and Fjalla One come from the [official Google Fonts repository](https://github.com/google/fonts), directories ofl/figtree and ofl/fjallaone. Inter comes from the [upstream Inter 3.19 release](https://github.com/rsms/inter/releases/tag/v3.19), using its desktop Regular, Medium and Light Italic instances. Their bundled SIL Open Font License notices accompany the font resources. Preserve those notices when redistributing the fonts and consult their terms for modification or reserved font names. Register the actual bundled fonts and verify the intended faces are rendered; a family name in a token file is not proof of registration.

## Verification

All 22 bundled image/SVG checksums were verified. A package regression test confirms all five font faces resolve without system fallback. Native Home rendering and comparison evidence are saved in the review folder. Record completed checks in the [Home review notes](../../ui/ComponentPreview/Review/README.md) and the active session log. Provenance records source evidence; it does not grant a license or establish visual fidelity.

Font versions and hashes: [Fonts/provenance.json](../../ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Resources/Fonts/provenance.json). Inter 3.19 static instances match the reference label widths; the current Google Fonts Inter release produced different metrics.
