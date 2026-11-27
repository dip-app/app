# Public surfaces polish (November 2026)

Owner area: the landing site (`apps/landing`: home, privacy, support), event share pages and their link previews (`eventSharePageV1`, `gcp/functions/src/modules/share`, `apps/admin/public/share/og`, `apps/landing/robots*.txt`), and the visual design of every email (`gcp/functions/src/modules/email/domain/templates/**`, `apps/admin/public/img/email`). Follows the [quality bar](../quality-bar.md) and the [review protocol](../design-review.md).

## How the audit was done

- A static mirror of `site-dist` (landing, privacy, support, `share/og`, `img/`) plus share pages rendered by `renderSharePage` for four cases (catalog cover, very long title with no description, generic page for an unknown or unavailable event, and the future App Store state) and every email from `npm run email:preview` (English and Spanish), served locally.
- Headless Chrome over the DevTools protocol at 1440, 768, 390 and 320 CSS px, light and dark (`prefers-color-scheme`), full page, with measured metrics (overflow, tap targets, computed contrast, font sizes, transfer sizes). Emails at 680 and 390, light, Apple Mail dark (media query) and forced inversion (Chrome auto-dark, a Gmail app and Outlook approximation), plus copies with `<style>` stripped (classic Outlook and style-stripping clients).
- Link unfurls reproduced from the parsed `og:`/`twitter:` tags as iMessage, Slack, WhatsApp and LinkedIn mock cards; every preview image checked at thumbnail and square-crop sizes and by bytes.
- Three Sonnet sweeps (landing, share, email) wrote measured findings; this document ranks them. Nothing here was tested on a physical device or in real mail clients.

## Ranked findings

P1 is broken or misleading, P2 clearly wrong or inconsistent, P3 polish. "Fix" names the planned change; "Defer" says why not now.

### P1

| # | Surface | Finding | Evidence | Plan |
| --- | --- | --- | --- | --- |
| 1 | Landing, share | The only call to action reads "Get the app" with the App Store glyph, but the app is not in the App Store and the link is `dip://`. Without the app (every new visitor, every desktop) the tap does nothing: no navigation, no message. The roster invite email's "Get DIP" button lands on this page, so an invited member hits a dead end. | `home-390-light-fold.png`, `catalog-390-light.png`, source `apps/landing/index.html`, `sharePage.ts` | Fix: label the pre-release action "Open in DIP" (share) or "Open the app" (landing) without the store glyph, say plainly that DIP is in private beta and how to get in, and when the page is still visible about 1.5 s after a tap show an inline status ("DIP didn't open on this device") with the next step. Add a `TESTFLIGHT_URL` launch switch so a public beta link can be dropped in later; the App Store state keeps the current behavior. |
| 2 | Share, robots | Both `robots.txt` variants disallow `/e/` for every user agent (pre-release `Disallow: /`, launch `Disallow: /e/`). Twitterbot, LinkedInBot and Slackbot-LinkExpanding honor robots.txt, so Slack, X and LinkedIn can drop the title, description and image for every event link. Indexing is already prevented by `X-Robots-Tag: noindex` and the robots meta on `/e/`. | `apps/landing/robots*.txt`, `docs/ops/launch-switches.md` | Fix: in both variants add one group for the link-preview crawlers that allows `/e/`, `/share/og/`, `/img/` and nothing else, keeping noindex. Unit test the files. |
| 3 | Landing | Home has no link to Privacy or Support (footer is only "© DIP"); the App Store support and privacy URLs are reachable only by typing them. | `home-1440-light.png` | Fix: shared footer on all three pages with Privacy, Support and the contact address. |

### P2

| # | Surface | Finding | Evidence | Plan |
| --- | --- | --- | --- | --- |
| 4 | Privacy, support | Links in light mode are `#7B88FA` on white, 3.11:1 for 17 px text (needs 4.5:1). | `privacy-1440-light.png` | Fix: link color `#4A56D6` in light (the share page accent, 6.3:1), keep `#7B88FA` in dark (5.8:1). |
| 5 | Landing | Muted text is 4.59:1 on white and 4.40:1 on the tinted feature cards (fails). | `home-*.json` | Fix: muted at about 0.72 opacity. |
| 6 | Landing, privacy, support | Tap targets under 44 px on phones: the admin portal link (17 to 38 px), the footer links (18 px), inline mailto. | `*-390-*.json` | Fix: padded footer and admin links (min 44 px block on phones); inline links inside sentences stay inline (WCAG 2.5.8 exception). |
| 7 | Landing | 1 px horizontal overflow at 320 hidden by `overflow-x: hidden` (blur blobs and stage). | `home-320-light.json` | Fix: clip the stage instead of the body. |
| 8 | Landing, share | Fonts come from Google Fonts: a render-blocking third-party stylesheet, a font swap that shifts the 84 px headline, and visitor IPs sent to Google while the privacy policy says the site uses no third parties beyond those listed. | perf JSON, `privacy/index.html` | Fix: self-host Latin subsets of Figtree (variable 400 to 700) and Fjalla One as woff2 from the repo's OFL font files, preload the headline face, drop the Google requests on the public pages. Emails keep their `<link>` (clients ignore it or proxy it). |
| 9 | Landing | Inconsistent shells: home content 1080 px wide, privacy and support 760 px, so the logo jumps 160 px between pages; footers differ; privacy and support lack Open Graph tags and the manifest; title separators differ (`DIP: …` vs `… | DIP`). | `*-1440-light.png` | Fix: one header and footer, logo aligned to the same column at every width, matching metadata on all three pages. |
| 10 | Landing | Heading order jumps from H1 to H3 (feature cards); no `nav`. | `home-*.json` | Fix: H2 for the cards (same look), footer `nav` with an accessible name. |
| 11 | Share | The generic page (unknown, canceled or private id) shows a bare "DIP" title and an ad-like lead; its `og:title` is "DIP". It does not tell the visitor what to do. | `generic-390-light.png` | Fix: neutral copy that does not reveal whether the event exists ("Open this link in DIP to see the event"), a descriptive `og:title`. |
| 12 | Share | The event description only appears in the unfurl, never on the page, so a visitor without the app cannot tell what the event is beyond the title. | `catalog-390-light.png` | Fix: show the same allow-listed description (already public in the unfurl) under the title. No new fields leave the server. |
| 13 | Share | `apple-itunes-app` is emitted with a placeholder id `0000000000` before a listing exists. | `sharePage.ts` | Fix: emit the Smart App Banner only when `APP_STORE_ID` is set. |
| 14 | Share | Button hover color `#0A84FF` is 3.65:1 with white text. | `catalog-1440-light.json` | Fix: darker hover. |
| 15 | Email | Dark mode art: the dark header and footer put the mascots on a bright lavender rectangle, the brightest thing in the email, on a band color (`#23252E`) that matches neither the dark page (`#121318`) nor the card (`#1B1D24`). Three dark tones plus a light sticker. | `welcome_390D.png`, `header-dark.png` | Fix: regenerate the dark art without the panel, giving each mascot a soft light die-cut outline so ink lines stay visible, on the dark page color; make the dark band color equal the dark page color. |
| 16 | Email | Preheader truncation leaves broken text: "Join in with your." (weekly theme), mid-word cuts in admin ideas, a period glued to a cut title. Nothing pads the preheader, so body text ("Hi Sam, …") can leak into the inbox preview. | `pre.txt` | Fix: cut at a word boundary with an ellipsis and never add a period after a cut; add the standard invisible padding after the preheader. |
| 17 | Email | `event_canceled` looks identical to an invite: no badge, while `calendar_cancel` has a "Canceled" badge. | `event_canceled_680L.png` | Fix: "Canceled" badge (existing string) on `event_canceled`. |
| 18 | Email | Secondary "Start this event" buttons in admin ideas are 36 px tall (under 44 px). | `admin_suggestions_390L.json` | Fix: 44 px. |
| 19 | Email | Weekly theme preheader repeats the subject ("Outdoors Week is the new weekly theme…" under "This week's theme: Outdoors Week"). | `pre.txt` | Fix: lead the preheader with the dates and the action instead (English and Spanish). |

### P3

| # | Surface | Finding | Plan |
| --- | --- | --- | --- |
| 20 | Email | Footer rows sit directly under the button with no separation from the message; 12 px gaps between three rows read loose. | Hairline divider above the footer, tighter row spacing. |
| 21 | Email | Heading to lead gap is 12 px while every other gap is 16 to 20 px. | 16 px. |
| 22 | Email | The event title is the weakest element in the card (bold 18 px) under a generic heading ("Event updated"). | Defer: promoting the title to the heading changes every event email's structure and the reviewer rubric fixes the shared layout; revisit with the owner. |
| 23 | Email | `calendar_invite` says "open the attached invite" while the only button is "Open in DIP". | Keep: the attachment cannot be a button; the button is the secondary path and the note explains the primary one. |
| 24 | Landing | Bezel PNG is 183 KB; blur blobs are paint-heavy on low-end phones. | Fix: WebP bezel (same pixels), keep blobs but lighter on phones. |
| 25 | Landing | Title, `og:title` and manifest name differ. No structured data. Sitemap lists only `/`. | Fix: one name, `Organization`/`WebSite` JSON-LD, sitemap adds `/privacy/` and `/support/`. |
| 26 | Share | iMessage shows only image, title and domain, so the date never appears there. | Defer: putting the date in `og:title` duplicates it in Slack and WhatsApp; the page itself now shows date and description. |
| 27 | Share | Category preview photos are soft; `cooking.jpg` shows a readable third-party sign and `games.jpg` a branded toy. `default.jpg` loses the mark in a WhatsApp square crop. | Fix `default.jpg` composition (centered mark and wordmark, square-safe). Replacing the category photos needs new licensed art: logged in [asset provenance](../asset-provenance.md) follow-ups, not done here. |
| 28 | Share | The coarse date uses America/New_York for every company. | Defer: needs the company time zone on the share path (the email time zone setting is server-only); privacy review first. |
| 29 | Privacy | Long paragraphs (about 80 characters per line) and one 120-word list item. "We name that provider here before the first email is sent" is a placeholder while no provider is chosen. | Fix measure (about 68 characters). Legal text unchanged; the provider line is an owner item. |
| 30 | Email | Spanish wording: "Te agregaron" is impersonal, "Administrar en el portal de administración" repeats. | Fix the two strings. |

## What is already good

Tag set complete with sized 1200x630 images and alt text; no overflow on share pages; reduced motion honored on the landing; every email passes AA for body and muted text, survives style stripping, has a plain-text part, full-width 44 px button on phones, and complete natural Spanish.

## Decisions and review log

Filled in as the work lands (critique, review rounds, accepted and rejected findings).
