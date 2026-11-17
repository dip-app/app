# Email client compatibility

Whether the notification emails render in Gmail, Outlook and Apple Mail is checked automatically on every functions unit-test run, with free local tools and no network. A short manual pass in real clients is still required before the first real send. Companion to [email setup](email-setup.md) and the [email design](../design/stretch/email.md).

## What runs

```sh
npm run check:email              # all templates, errors fail (exit 1), warnings are listed
npm run check:email -- --verbose # also print the caniemail note for each finding
npm run check:email -- --online  # adds HEAD requests for the hosted brand art (needs the admin site deployed)
```

The same checker runs in CI as `gcp/tests/unit/email-compat.test.ts` (part of `npm run test:unit`). It renders every case in `PREVIEW_CASES` through `renderEmail` (all seven templates, both reminder windows, approved and changes-requested reviews, long, emoji and RTL titles, event updates with strikethrough for time, date, venue, address, title and both, event updates without old values, and the open-pixel variant). Source: `gcp/functions/tools/emailCompat/`.

### Tools chosen and why

| Layer | Tool | Why |
| --- | --- | --- |
| Client support data | [`caniemail`](https://www.npmjs.com/package/caniemail) 2.x (MIT, Node 22+, updated 2026) with the data from [caniemail.com](https://www.caniemail.com/) | Maintained successor of `doiuse-email` (last release November 2023, still on `css` 3 and `htmlparser2` 9). Same engine idea: parses HTML, inline styles and the `<style>` block, and reports unsupported or partial features per client (`gmail.*`, `outlook.*`, `apple-mail.*`). Free and offline |
| Structure | [`html-validate`](https://html-validate.org/) (MIT) | Catches unclosed or badly nested tags, invalid attributes, duplicate ids, missing alt. Rules that email legitimately breaks (presentational attributes, inline styles, `role=presentation`, MSO conditional comments, tables without `tbody`) are switched off in `checks.ts`, each by name |
| DIP rules | `checks.ts` | Things generic tools cannot know, listed below |

Not used: `juice` (CSS inlining). Our templates are hand written with every essential style inline, so there is nothing to inline; instead the checker fails if essential styling appears only in `<style>`. Paid tools are covered in the last section.

### How findings are classified

- **Error (fails the test):** a DIP rule is broken, `html-validate` reports a structural error, or caniemail says an essential feature (an element or an inline property) is unsupported in Gmail, Outlook or Apple Mail and the degradation has not been reviewed.
- **Warning (printed, does not fail):** partial support; anything unsupported that only lives in the progressive-enhancement layer (`<style>`, `@media`, `@import`, `<link>`, the `color-scheme` meta, selectors) because inline styles are the fallback; and unsupported essentials that are listed in `REVIEWED_DEGRADATIONS` with the reason the template still works. Every warning prints the client and property.
- Adding to `REVIEWED_DEGRADATIONS` is a design decision: say in the reason what the reader sees instead.

### DIP rules checked on every template

| Rule | Check |
| --- | --- |
| Gmail clipping | HTML under 100,000 bytes (error), warning above 80,000. Gmail clips at about 102 KB and hides the rest behind "View entire message", which also hides the footer, unsubscribe link and open pixel |
| Inline-only layout | Outside `@media` and the Outlook.com `[data-ogsc]` overrides, `<style>` may hold only resets (margin, padding, `-ms-interpolation-mode`); every rule inside `@media` needs `!important` or it could never beat the inline value |
| No unsupported layout | No float, grid, flexbox, `display:flex/grid/contents`, transform, filter, animation, `z-index`, `position` (except the visually hidden "was" helper, which must carry `clip`), CSS variables, `calc()`/`clamp()`, `vw/vh/rem` units |
| Background images | Only with both a `bgcolor` attribute and a `background-color` fallback (none are used today) |
| Images | Every `<img>` has `alt`, numeric `width` and `height` attributes, an absolute `https://letsdip.work/` URL, `border:0` and `display:block` (or hidden); every referenced brand asset exists in `apps/admin/public/img/email/` |
| Dark mode | `color-scheme` and `supported-color-schemes` meta; a `prefers-color-scheme: dark` block; `[data-ogsc]`/`[data-ogsb]` rules for Outlook.com with parity for the classes the media block restyles; each light image has a `-dark.png` twin that is hidden inline (`display:none`, `max-height:0`, `mso-hide:all`) so clients without dark CSS show only one |
| Links | `href` is never empty, `#`, `javascript:` or contains `undefined`, `null`, `{{`; absolute `https://letsdip.work/...` or `mailto:...@letsdip.work`; `<link>` only to the Google Fonts stylesheet; `@import` only for fonts |
| Plain text | Part exists, has no HTML tags, contains the unsubscribe link and every HTML link |
| Document | doctype, `lang`, charset, viewport, non-empty title and subject, fonts have a generic fallback, no text under 12px, outer table carries the page background (Outlook for Mac strips `<body>`), no `<script>`, `<form>`, `<iframe>`, `<video>` |

The regression tests in `email-compat.test.ts` mutate a rendered template (add flexbox, drop alt, make the page 100 KB, break a link, remove the dark meta, ...) and assert the checker fails for each.

## What the checker cannot tell you

It reads support tables, it does not render. It cannot show clipped text, the Outlook Word engine's spacing, Gmail's automatic dark-mode colour changes, image blocking, or how a font actually looks. Use the manual checklist.

## Known limits that matter for our templates

Sources: [Google: Gmail CSS support](https://developers.google.com/workspace/gmail/design/css), [caniemail.com](https://www.caniemail.com/) (the data the checker uses), Microsoft's Word-engine HTML and CSS support notes for Outlook (the engine in classic Outlook for Windows), vendor write-ups on [Gmail clipping](https://www.emailonacid.com/blog/article/email-development/gmail-email-clipping/) and [Outlook.com dark mode](https://medium.com/emails-hteumeuleu/dealing-with-outlook-coms-dark-mode-dd56a1c0fdbc). Gmail and Outlook change behaviour without notice; the caniemail result in CI is the freshest signal.

| Client | Limit | What we do |
| --- | --- | --- |
| Gmail (web, iOS, Android) | Clips messages over about 102 KB of HTML (vendor sources; Google does not document it) | Under 100 KB enforced; today at most about 12 KB |
| Gmail | `<style>` and `@media` are supported for Google accounts, but only class, element and id selectors; attribute and combinator selectors are partial | All essential styling inline; `<style>` holds only responsive and dark enhancements |
| Gmail (mobile webmail; caniemail data) | `<style>` may be dropped entirely | Layout and colours are inline, so the light layout is intact; dark mode and the mobile button width are lost |
| Gmail | No `<link>`, no `@import`, no web fonts | Figtree and Fjalla One fall back to the system stack (Helvetica, Arial); headings use `Arial Narrow` |
| Gmail | `position` is stripped; `display:none` unsupported in mobile webmail | The only `position` is the hidden "was" label, which is also sized to 1px and transparent; hidden image and preheader have `max-height:0`, `overflow:hidden` fallbacks |
| Gmail | `<bdi>` unsupported | Replaced by `<span dir="auto">`, which isolates direction the same way |
| Gmail | Forces its own dark-mode colour changes in the iOS and Android apps when the message does not declare support; partial inversion even with it | `color-scheme` meta plus explicit dark colours; check by eye (checklist) |
| Outlook for Windows (Word engine) | No `border-radius`, `max-height`, `overflow`, `opacity`, `@media`, background shorthand quirks; ignores CSS sizes on images; adds phantom spacing | Square card corners accepted; button is a VML `roundrect` inside an MSO conditional comment; images carry width and height attributes; layout is tables |
| Outlook.com and Outlook apps | Dark mode rewrites colours inline and stores the originals in `data-ogsc` and `data-ogsb`; media queries for dark are not used | Parallel `[data-ogsc]`/`[data-ogsb]` rules (parity enforced by the checker) |
| Outlook for Mac | Strips `<body>` styles | Outer table has the page background |
| Apple Mail (macOS, iOS) | Best-in-class support; `color-scheme` meta honoured on macOS, not listed on iOS | `prefers-color-scheme` rules and light/dark art swap |
| All | Images off by default in several clients | Header and footer art have `alt` text, the header link has a text fallback, and the content makes sense without images |
| All | Preheader hidden text | `display:none`, `max-height:0`, `opacity:0`, `mso-hide:all`; one full sentence under 110 characters |

## Before the first real send (manual)

Do this once the provider and DNS in [email setup](email-setup.md) are live, using the pilot company's internal accounts. Trigger real notifications with `EMAIL_ENABLED` on for the pilot only; do not use a mailing tool.

Send each of these templates to every address below: `invite_received`, `event_changed` with old values struck through for time and for location, `event_reminder` (1h), `challenge_reviewed`, and one with a long or non-Latin title.

- [ ] **Gmail web** (Google account, desktop browser): not clipped (no "View entire message"), full-bleed header and footer bands, Figtree falls back cleanly, button purple and tappable, unsubscribe link works and the Gmail unsubscribe link shows next to the sender.
- [ ] **Gmail iOS app** and **Gmail Android app**: same, plus narrow-width layout, no horizontal scroll, button at least 44px tall.
- [ ] **Gmail mobile web** (Gmail in a phone browser) and, if you can, the Gmail app with a non-Google account: the "no `<style>`" cases; layout must still be intact.
- [ ] **Outlook for Windows** (classic): button visible, text readable, card with square corners is acceptable, header and footer art present.
- [ ] **Outlook.com** (web) and **Outlook iOS/Android**: layout, then switch the client to dark mode.
- [ ] **Apple Mail on macOS** and **iOS Mail**: layout, then switch the device to dark mode; light header and footer art are replaced by the dark art, no white boxes around logos.
- [ ] **Dark mode in each client above**: text legible, struck-through old values still visible but muted, button still purple with ink (#1E212B) text, hairlines visible, no inverted art.
- [ ] **Images blocked**: preheader and heading still convey the message; header `alt` shows.
- [ ] **Plain-text view** (Gmail "Show original" or Apple Mail View > Message > Plain Text): readable, links intact.
- [ ] **Right-to-left title**: the Hebrew or Arabic sample renders in the right order and does not break the layout.
- [ ] **Headers**: Gmail "Show original" shows SPF, DKIM, DMARC pass, as in email setup section 8.
- [ ] Record the results (client, version, pass or issue, screenshot) in the session log.

## Optional paid services (final pre-launch step)

Not required and not signed up for. If the owner wants real-device screenshots across 90 or more clients in one pass before a wider launch, [Litmus](https://www.litmus.com/), [Email on Acid](https://www.emailonacid.com/) or [Mailtrap](https://mailtrap.io/) (email testing with an HTML check and previews, free tier available) can render a template from a pasted HTML file produced by `npm run email:preview`. Use it once after the manual checklist, then rely on this checker in CI. Do not paste real member data; the preview cases contain only sample data.

## Changing the checker

- New template or variant: add a case to `previewCases.ts`; it is picked up by the preview, the snapshots and this check.
- New client family: extend `CLIENT_GLOBS` in `gcp/functions/tools/emailCompat/checks.ts` (caniemail glob syntax, for example `yahoo.*`).
- Updating data: `npm update caniemail --workspace @dip/functions` refreshes the support tables; new errors mean a client changed, review before adding to `REVIEWED_DEGRADATIONS`.
- Dependencies are dev-only (`caniemail`, `html-validate`, `htmlparser2`); nothing is added to the deployed functions bundle.

## Primary button contrast rule

Any purple (`#7B88FA`) filled element that carries text uses **white (`#FFFFFF`) text in light mode and ink (`#1E212B`) text in dark mode**. White on `#7B88FA` is only about 3.1:1; ink is about 5.2:1. The inline style is the white base (Gmail-safe, works when `<style>` is dropped). The dark override is `.btn-a, .btn-t { color: #1E212B !important; }` inside `prefers-color-scheme: dark` plus the `[data-ogsc]` mirror for Outlook.com, applied to both the link (`btn-a`) and an inner span (`btn-t`) because clients restyle the `<a>`. The fill stays purple in both modes. The classic Outlook VML fallback stays white (no dark CSS there). The outlined admin "Start this event" button has no fill and keeps ink text. `email-templates.test.ts` asserts the rule for every template.
