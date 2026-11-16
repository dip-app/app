# Weekly theme art

Illustrations for the eight new weekly challenge themes (sleep, hydration, mindfulness, outdoors, kindness, learning, creativity, cooking), in the style of the Fitness "This Week's Challenge" mascot art.

- Figma (vector frames): https://www.figma.com/design/FvmgH1dGuUqRonq9YgHtdH (file "DIP Weekly Theme Art", in the author's personal team). It was built from the authored SVGs and omits a few small spiral accents; the SVGs in the repo are the source of truth.
- Web: `apps/admin/public/img/themes/<key>.svg` and `<key>.png` (730x539, transparent, same slot as `fitness.png`). Backgrounds per theme: `apps/admin/public/img/themes/ACCENTS.md`.
- iOS: `Home.xcassets/Mascot<Key>.imageset` (for example `MascotSleep`), same Contents.json as `Mascot` (Fitness).
- Style: flat blob character, black limb strokes, simple faces, white clouds plus confetti, brand palette plus the Fitness blue, green and coral. Bottom-left (title and participant pill) is kept clear.
- Review: no Figma exists for this art, so a design-crit round was run on a 9-up contact sheet (consistent style, readable at 400px wide, title area clear, brand palette only); verdict PASS after one revision round. Extra colours beyond the tokens: deep green #2FBF71 (outdoors tree), greys #404040/#606060 (pot, as the barbell), #E8FAFF (water drop), #FFE9B8 (palette).
- Wiring the art into `DIPThemeCatalog` and the admin `themes.ts` is done separately by the catalog work; this change adds assets only.
