# Event cover library

A curated, licensed catalog of event cover images. Organizers choose from it in the admin portal, and Dipbot picks one for AI drafts. Status: 174 covers in the manifest (160 Pixabay photos, 9 illustrations and the 5 original prototype photos), 16 to 22 per theme, acquired with the Pixabay workflow below.

## Purpose

- Every event can have a good-looking cover without an organizer uploading anything.
- One source of truth: `apps/admin/public/img/covers/manifest.json`. The admin picker, the server index used by Dipbot, the email/share renditions and iOS all derive from it.
- Text-only metadata (label, tags, themes, mood) lets Dipbot choose by words alone, with no image tokens.

## URL schemes

| Scheme | Meaning |
| --- | --- |
| `catalog://default/<category>` | Legacy, unchanged. Category is fitness, outdoors, hiking, games or cooking. Still valid everywhere. |
| `catalog://cover/<key>` | New. Key matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 64 characters, and must exist in the manifest. |
| Weekly-theme art keys | Challenge art, unchanged and separate from this catalog. |

The five legacy seed entries keep their legacy URL as their canonical `url`. All other entries use `catalog://cover/<key>`.

Hosted files (copied to the site root by `scripts/build-site.sh`, which copies `apps/admin/public/img`):

- Full: `https://letsdip.work/img/covers/<key>.webp`, up to 1200 px wide, 16:10 (3:2 allowed), used by iOS and the admin preview.
- Thumb: `https://letsdip.work/img/covers/thumbs/<key>.webp`, 400 px wide, used by the admin grid.
- JPEG: `https://letsdip.work/img/covers/jpg/<key>.jpg`, 960 px wide, used only for emails (Outlook has no WebP) and the share page `og:image`.

## Manifest schema

`manifest.json` has `version` (1), `baseURL`, `themeDefaults` (theme to key, one per theme, the entry must list that theme) and `covers`. Each cover:

| Field | Rule |
| --- | --- |
| `key`, `url` | Key per the regex above; url is the legacy URL for the five legacy keys, otherwise `catalog://cover/<key>`. |
| `kind` | `photo` or `illustration`. |
| `file`, `thumb`, `jpeg` | `<key>.webp`, `thumbs/<key>.webp`, `jpg/<key>.jpg`. |
| `width`, `height`, `orientation` | Measured from the file; aspect 16:10 or 3:2 within 1 percent; `landscape`. |
| `themes` | 1 to 3 of outdoors, food, arts, games, music, learning, volunteering, wellness, fitness. |
| `tags` | 2 to 12 lowercase activity words; multiword allowed ("board games"). |
| `mood` | 0 to 3 of calm, energetic, social, cozy, festive, focused, playful. |
| `season` | 1 to 4 of spring, summer, autumn, winter, any. |
| `label` | Up to 40 characters; shown in the UI and given to Jev as the choice text. |
| `alt` | Required, up to 160 characters. |
| `autoPick` | Optional boolean, default true when missing. `false` means the cover is never offered to Dipbot automatic picks but stays selectable manually in the picker. Import accepts an optional `autoPick` column or field (`false`, `0` or `no`). The generated index carries `autoPick?: boolean`, emitted only when false. |
| `dominantColor` | `#RRGGBB`, computed from the full image. |
| `bytes`, `sha256` | Per-rendition byte sizes and the SHA-256 of the full WebP (dedupe key). |
| `license` | `type`, `source`, `sourceURL`, `creator`, `creatorURL`, `notes`. |

The server reads a generated, text-only index (`gcp/functions/src/modules/covers/domain/catalog.generated.ts`) and never reads image files at runtime.

## Size budget

| Rendition | Limit | Average target |
| --- | --- | --- |
| Full WebP | 150 KB | about 90 KB |
| Thumb WebP | 30 KB | about 18 KB |
| JPEG | 100 KB | about 70 KB |

That is roughly 180 KB per image at most; the 160 Pixabay photos average 79 KB for the full rendition and the whole directory is about 24 MB. The hard cap for the whole covers directory is 40 MB (`covers:validate` fails above it). The import script lowers WebP quality adaptively until each file fits and rejects sources that would need upscaling below 960 px wide.

## License rules

- Allowed sources: Pixabay (current source, official API), Pexels and Unsplash, with creator, creator URL and photo page URL stored in `license`. These types require `sourceURL` and `creator`; validation fails without them. Attribution is not required by the Pixabay Content License, but the fields are stored so we can credit, audit or remove an image later.
- `dip-original`: art made in this repository (the nine illustrations).
- `prototype-unconfirmed`: the five legacy photos from the Figma prototype. Their rights are unconfirmed; this is a note only. They stay fully active in the manifest, pickers and Dipbot picks, and simply join the larger library.
- No scraping, no image search engines, no AI-generated photo look-alikes presented as real, no images without a recorded source.
- Never commit API keys. `PIXABAY_API_KEY` lives in the dip-app/secrets repo (`backend/functions.enc.env`) and is read from the environment only (see Workflow).

### Pixabay Content License and API terms (checked)

- Allowed: free use, including commercial use, with no attribution required and modification (we crop to 16:10 and re-encode).
- Not allowed: selling or distributing the content on a standalone basis without creative effort (do not offer the library as a downloadable stock pack), recognizable trademarks or logos used commercially, immoral or illegal use (especially with recognizable people) and misleading use. Covers are used as event backgrounds inside the product, not resold. Keep recognizable people out of misleading contexts, and drop images with visible brands or logos (the fetch script blocks tags such as logo, brand and text, and curation removes the rest).
- API: 100 requests per 60 seconds per key (HTTP 429 when exceeded, header `X-RateLimit-Reset` gives the wait), results cacheable for 24 hours, no permanent hotlinking: we download `largeImageURL` (1280 px; `fullHDURL` needs full API access) once and host our own renditions. Automated bulk downloading is not allowed, so the script fetches a few candidates per shot, not the whole result set.
- Fields stored per image: Pixabay id (in `license.notes`), `sourceURL` (page), `creator`, `creatorURL`, the Pixabay tags (in `license.notes`) and the license name.

## Workflow to add images

1. Load the key without printing it: `scripts/secrets/pull.sh --only backend --force` writes `.secrets-cache/out/functions.env` (gitignored, mode 600). Run the fetch with `node --env-file=.secrets-cache/out/functions.env --import tsx scripts/covers/fetch-pixabay.ts --out <dir outside the repo>` (also `npm run covers:fetch:pixabay -- ...`; options `--theme`, `--shot <id>`, `--candidates 3`, `--min-width 1600`, `--dry-run`). Delete `.secrets-cache` afterwards. The script reads `scripts/covers/query-plan.json` (use `pixabayQuery` on a shot when Pixabay needs different keywords), asks for photos that are horizontal, safesearch, at least 1600 px wide, editors choice first and then popular, falls back to looser keyword variants, keeps only candidates whose tags cover at least half of the query words, drops blocked tags (children, logos, text, gore), dedupes by Pixabay id and near-duplicates (difference hash), rate limits itself to 90 calls per minute with 429 retry, and stages `images/`, `candidates.json` and `labels.json` outside the repo. A rerun continues from `candidates.json`.
2. Curate by eye with contact sheets of the staged candidates (for example 40 thumbnails at 200 px per sheet). Drop blurry, off-theme, text-heavy, branded or close-up people images and take the next candidate. Write `label`, `alt` (plain language, what is in the picture), `tags`, themes and optional `gravity` per image (title area is bottom-left, so avoid a dead-centre subject there).
3. Import: `npm run covers:import -- --src <dir>/images --labels <curated labels.json>` (add `--dry-run` first). It crops to 16:10, writes the three renditions under `apps/admin/public/img/covers/`, skips duplicate keys and identical images, refuses rows without license or alt, and merges the manifest sorted by key. Images that cannot fit the 150 KB budget at quality 40 (very detailed foliage) are rejected and should be replaced.
4. Validate: `npm run covers:validate -- --min-per-theme 12` (default minimum is 1). `npm run covers:check` runs validation and the index check together.
5. Regenerate the server index: `npm run covers:index` (`-- --check` in CI).
6. Open a PR with the new images, manifest and generated index together.

The Pixabay client (`scripts/covers/pixabay.ts`: rate limiter, search, download, filters, license mapping) is importable without the CLI, so a server-side runtime fallback can reuse it. Server validation of cover keys is `isApprovedCoverURLFrom(url, sources)` in `coverCatalog.ts`, where `indexKeySource()` is the generated index and further sources (for example a Firestore list of dynamic covers) can be added.

`npm run covers:seed` rebuilds the 14 seed entries (5 legacy photos and 9 theme illustrations on the accent from `apps/admin/public/img/themes/ACCENTS.md`). `npm run test:covers` runs the tooling tests in temporary directories.

## How Dipbot picks

1. Lexical shortlist: tokens from the title (double weight) and the first 600 characters of the description are stemmed and scored against tags, label and alt words, and the event theme; the top 20 (15 to 25 is configurable) go forward, always including the theme default. Keys already used in the same batch are penalized so drafts stop sharing one photo.
2. Jev Choice: one choice question over the text labels of the shortlist (label, tags, theme per key). No image tokens are sent.
3. Fallbacks, in order: OpenAI cheap model, the deterministic best lexical match, the theme default, and finally `catalog://default/outdoors`.

The server does not narrow eagerly. With fewer than about 60 eligible covers (config `maxCandidates`) all of them are sent to Jev as one-line text labels (`key: theme | tags | short alt`). Larger libraries keep a broad ranked set plus a generous tail and diverse picks, and split into at most two Jev Choice calls (theme group, then cover) when over the per-call option limit. The only hard exclusions are orientation and `autoPick: false`; fallbacks are unchanged.

## Credits

"Let Dipbot choose" (`pickEventCoverV1`) costs 1 Dipbot credit (`CREDIT_COSTS.coverPick`, `creditCost.coverPick` in the contract). It is charged before the model call, idempotent per `requestId`, and refunded when no model answered (AI off, provider failure or timeout, heuristic provider), so admins pay only when Dipbot actually chose. With no credits left it fails with `AI_CREDITS_EXHAUSTED` before any model call; the manual search and filters stay free. Covers Dipbot picks for generated drafts add nothing: they ride on the per-draft draftCheck call already inside the 10-credit generation.

Server details live with the covers module; this document only records the contract with the catalog.

## Deploy note

New image files only reach users after a hosting deploy of the site (`scripts/build-site.sh` output). The server index is compiled into the functions bundle, so a functions deploy is also needed before Dipbot or approval checks can use new keys. Deploy hosting first, then functions, so a key is never accepted before its files exist.

## Query plan

`scripts/covers/query-plan.json` is the machine-readable plan used by `fetch-pixabay.ts`. It lists 243 shots (the original 171 plus shots with an `x-` id added for Pixabay, which has more scenery and objects than people activities). Each shot gives theme, subcategory, label, query (optionally `pixabayQuery`), planned tags, mood and season. Candidates per shot default to three; the curated library keeps about one image per useful shot.

Planned themes and subcategories: outdoors (hiking, water, picnic, beach, camping, park, gardening, cycling), food (cooking, baking, potluck, coffee, brunch, grill, drinks), arts (painting, pottery, crafts, drawing, photography, lettering), games (board games, cards, trivia, video games, puzzles, tabletop), music (live, singing, guitar, choir, drums, dance floor), learning (book club, workshop, language, coding, study, talks), volunteering (cleanup, community garden, food bank, trees, animals, giving), wellness (yoga, meditation, spa, stretching, mindful walk, slow living, journaling), fitness (running, gym, group class, spin, swimming, pilates, boxing, climbing, team sports).

Result of the Pixabay run: outdoors 19, food 20, arts 19, games 16, music 18, learning 18, volunteering 18, wellness 17, fitness 16 Pixabay photos (plus the illustrations and the five original photos, which also carry themes). Weak spots: Pixabay has few photos of groups doing things, so people-centred subcategories (trivia night, language exchange, food bank, animal shelter, boxing, life drawing) are represented by objects and scenery, and volunteering is mostly recycling, hands and planting imagery.
