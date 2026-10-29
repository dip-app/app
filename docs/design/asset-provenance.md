# Prototype asset provenance

Resources come from the supplied [Figma prototype](https://www.figma.com/design/DCIagJo7uk5IOUGqlKzAjf/Team-05-High-Fidelity-Prototype--with-links-?node-id=35-147&m=dev), file DCIagJo7uk5IOUGqlKzAjf, through official Figma MCP. Home was implemented in session be39ee55-d9c7-4f0a-9060-c6a86dbffcc7. The October 29 expanded-screen session is 0cf05e71-dfb2-4c4a-92f3-db6358767921.

## Exported prototype assets

Resource root: ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Resources.

| Manifest/catalog | Reference |
| --- | --- |
| home-assets.json / Home.xcassets | Home 35:147 |
| screen-assets.json / Screens.xcassets | Event Details 46:1397, Joined 76:1742, My Events 76:6032, Memories 76:6204, Profile 76:4016, Participants 76:4932, Album 46:1995 |

Manifests record individual image/SVG names and SHA-256 checksums. Resources include original photography, avatars, illustration/background curves and icons; downloaded files are bundled locally. Temporary MCP download URLs must not become runtime dependencies. Full-frame reference screenshots are comparison evidence only and are not used to implement any screen.

Figma export establishes source, not copyright ownership or redistribution rights. Third-party photography, illustrations and avatar rights remain unknown. Treat these as supplied prototype review fixtures until the team confirms rights or replaces them with cleared equivalents.

## Fonts

Figtree and Fjalla One come from the [official Google Fonts repository](https://github.com/google/fonts), directories ofl/figtree and ofl/fjallaone. Inter comes from the [upstream Inter 3.19 release](https://github.com/rsms/inter/releases/tag/v3.19), using desktop Regular, Medium, Light, Italic and Light Italic instances. Seven font files provide these faces plus Figtree Regular/Bold and Fjalla One Regular.

Preserve the bundled SIL Open Font License notices. The [font manifest](../../ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Resources/Fonts/provenance.json) records versions/sources and checksums. Inter 3.19 matched the reference label metrics more closely than current Google Fonts Inter. Actual face registration is regression-tested; expanded font checks remain pending for this revision until recorded in the review notes.

## Supporting preview content

Puppy Yoga and its Joined state use the supplied detailed reference. Other event detail content is synthetic data in the same view template. All memory links open the supplied Album reference. The local edit form, chat sheet, photo viewer and system photo picker are supporting native UI without corresponding supplied high-fidelity frames. User-selected album photos stay local to the prototype session and are not original Figma exports or cloud uploads.

## Verification

The previous Home revision verified 22 image/SVG checksums and five named font faces. Expanded screen asset/font hashes, native image slots and screenshot comparison are pending for the current revision. Record results and remaining differences in the [review notes](../../ui/ComponentPreview/Review/README.md) and active session log. Provenance does not grant image rights or prove visual fidelity.
