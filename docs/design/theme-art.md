# Weekly theme art

Illustrations for the broad weekly challenge themes (outdoors, food, arts, games, music, learning, volunteering, wellness), in the family of the Fitness "This Week's Challenge" mascot art and the admin avatar blobs.

- Figma (vector frames): https://www.figma.com/design/FvmgH1dGuUqRonq9YgHtdH (file "DIP Weekly Theme Art", in the author's personal team). The SVGs in the repo are the source of truth; the Figma frames were built from them (spiral accents are simplified to rings there).
- Web: `apps/admin/public/img/themes/<key>.svg` and `<key>.png` (730x539, transparent, same slot as `fitness.png`). Backgrounds per theme: `apps/admin/public/img/themes/ACCENTS.md`.
- iOS: `Home.xcassets/Mascot<Key>.imageset` (for example `MascotFood`), same Contents.json as `Mascot` (Fitness).
- Style: each theme has its own character (silhouette, size, body colour, face, accessory, pose) taken from the avatar family: pear/teardrop, cloud, round, house, ghost, diamond, spiky and scalloped bodies with dot eyes and simple mouths; group scenes for games and volunteering. Flat shapes, black limb strokes where the Fitness art has them, white clouds plus confetti. Bottom-left (title and participant pill) is kept clear.
- Review: no Figma exists for this art, so design-crit rounds were run on a 9-up contact sheet (characters clearly different, same family, readable at 400px wide, title area clear, brand palette only) until PASS. Colours beyond the tokens: the avatar tones (lime #DDFF4D, orange #FFB014, teal #6BE5D0, violet #9B4DFF, sky #4DBFFF, rose #FFB8C8), deep green #2FBF71 (leaf), greys and cream #FFE9B8 (palette).
- Wiring the art into `DIPThemeCatalog` and the admin `themes.ts` is separate; this change adds assets only. The first set (sleep, hydration, mindfulness, kindness, creativity, cooking) was replaced by this broader set.
