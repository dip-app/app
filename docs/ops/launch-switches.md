# Launch switches (website and App Store)

Two things change when DIP goes public: search engines are let in, and the pages point at the App Store listing. Both are prepared, documented here, and **off today**. Flipping them edits files in a PR; deploying them is a separate, deliberate step in the [deploy runbook](deploy-runbook.md).

## 1. Search indexing (noindex)

Today the whole `letsdip` site and the legacy redirect site send `X-Robots-Tag: noindex, nofollow`, and `robots.txt` disallows everything.

**The single switch is the `X-Robots-Tag` header in the global (`"source": "**"`) rule of the `letsdip` site in `firebase.json`.** Do not edit it by hand; use the script, which keeps the header, `robots.txt` and the admin protection consistent:

```sh
scripts/set-indexing.sh status   # prints: indexing: OFF (noindex, nofollow)
scripts/set-indexing.sh on       # launch
scripts/set-indexing.sh off      # back to pre-release
```

What `on` changes (and `off` reverses exactly):

| File | `on` | `off` (today) |
| --- | --- | --- |
| `firebase.json`, site `letsdip`, `**` headers | `X-Robots-Tag` removed | `X-Robots-Tag: noindex, nofollow` first in the rule |
| `firebase.json`, site `letsdip` | adds a `/admin/**` header rule with `X-Robots-Tag: noindex, nofollow`, so the admin portal can never be indexed | rule removed (the global header covers it) |
| `apps/landing/robots.txt` | copy of `robots.index.txt`: allow all, `Disallow: /admin/` and `/e/`, `Sitemap:` line | copy of `robots.noindex.txt`: `Disallow: /` |

Not touched by the switch, deliberately: the `team05-dip` redirect site stays `noindex`; event share pages (`/e/**`) always send `X-Robots-Tag: noindex` and a robots meta (per-event pages are private-ish links, only their preview is public); the admin portal keeps its own `robots: noindex` metadata. `apps/landing/sitemap.xml` lists only `https://letsdip.work/` and is already published; it matters once indexing is on.

Launch steps: run `scripts/set-indexing.sh on`, review `git diff`, open a PR, then after merge rebuild (`scripts/build-site.sh`) and deploy hosting `letsdip` ([runbook](deploy-runbook.md#hosting)). Verify with `curl -sI https://letsdip.work/` (no `x-robots-tag`), `curl -sI https://letsdip.work/admin/login/` (has it), `https://letsdip.work/robots.txt`. Then submit the sitemap in Google Search Console and Bing Webmaster Tools. Expect `off` to take days to weeks to take effect in search results once reversed, so flip deliberately. Before launch also confirm the landing images and the event photos have release rights ([asset provenance](../design/asset-provenance.md)).

The pure logic lives in `scripts/launch_config.py` and is unit tested in `scripts/tests/test_launch_config.py`.

## 2. App Store listing

One config file, `gcp/functions/src/config/launch.ts`:

```ts
export const APP_STORE_ID = "";                       // digits after "id" in the listing URL; empty today
export const USE_OFFICIAL_APP_STORE_BADGE = false;    // prepared, not enabled
```

Read by:

- **Share page function** (`eventSharePageV1`, imports the constants): with an ID, the muted line becomes a link to `https://apps.apple.com/app/id<ID>` (or the badge), the `apple-itunes-app` Safari banner uses the real ID, and a tap on "Get the app" that leaves the page visible after about 1.5 seconds goes to the listing. Empty = current behavior ("It's coming to the App Store.", placeholder banner ID).
- **Landing page build** (`scripts/build-site.sh` runs `scripts/launch_config.py landing`, which parses the same file as text): with an ID, the "Get the app" pill's `href` becomes the listing URL instead of `dip://`. Empty = the unchanged "open the app" pill.

Set the ID, then redeploy **both**: Functions (`eventSharePageV1`) and Hosting (landing). Do it in the same release or the two pages disagree.

### Official badge (prepared, not enabled)

Apple requires its own artwork and rules for the "Download on the App Store" badge. We do not redraw it.

1. Download the black "Download on the App Store" badge (SVG, US English) from Apple Marketing Tools (https://tools.applemediaservices.com or https://developer.apple.com/app-store/marketing/guidelines/) and save it as `apps/landing/img/app-store-badge.svg`. It is copied to `/img/landing/app-store-badge.svg` by the existing image copy in `build-site.sh`, which is the path both pages use.
2. Set `USE_OFFICIAL_APP_STORE_BADGE = true` in `launch.ts`.
3. The build fails loudly if the flag is on, an ID is set and the file is missing. With an empty ID the flag has no effect.
4. The badge replaces the pill on the landing page (height 48) and the muted text line on share pages (height 40). Keep clear space and do not recolor or resize it beyond Apple's minimum sizes. After switching, take screenshots of the landing page and one share page at phone and desktop width and have the design auditor review them.

## 3. Also flipped at launch (not automated)

- Apple Team ID in `apps/admin/public/aasa/apple-app-site-association.json` ([TestFlight and Universal Links](testflight-universal-links.md)).
- Push: `#include "Push.xcconfig"` in `ui/Config/Local.xcconfig` ([push client](../design/push-client.md)).
- Shake to report stays Debug and TestFlight only; the App Store build does not include it.
