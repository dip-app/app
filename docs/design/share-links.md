# Event share links and Universal Links

Status: implemented in the app and hosting files; **nothing deployed**. Needs the owner steps below.

## Link format

`https://letsdip.work/e/<eventId>` (constant `DIPShareLink.baseURL` in `ui/Packages/DIPCore/Sources/DIPCore/DIPShareLink.swift`; the only place the domain lives in Swift). The URL carries only the opaque event id, never a company id, title or personal data. Authorization is unchanged: the app opens the id inside the signed-in member's own company; a member of another company (or an id that no longer exists) sees "Activity unavailable". `DIPShareLink.url(forEventID:)` builds it and `DIPShareLink.eventID(from:)` parses it, rejecting other hosts, schemes, ports, user info and paths. The parser also accepts the push deep link `dip://events/<id>[/chat]` (see `docs/contracts/callables.md`); the `dip` URL scheme is now registered in `ui/project.yml`.

Share button: `ShareLink(item: <link>, message: <share text>)` on the event page, so rich targets show a link preview and text targets get the paragraphs followed by the link as the last line. `DIPEventMetadata.shareText(title:description:link:)` appends the link as its last line when given one (used and tested in DIPCore). Cancelled events share no link.

## App behaviour

`DIPApp` receives `.onOpenURL` (custom scheme, and Google sign-in redirects are handled first) and `.onContinueUserActivity(NSUserActivityTypeBrowsingWeb)` (Universal Links) and queues the event id in `EventLinkInbox`. The queue is consumed by `DIPMemberHome` only for a resolved member and not while the onboarding tour or its replay is showing, then `DIPPrototypeApp` opens the event page. Signed-out users keep the queued link through sign-in and company resolution.

## Hosting (files only)

- `apps/admin/public/aasa/apple-app-site-association.json`: the association file, served at `/.well-known/apple-app-site-association` through a rewrite in `firebase.json` (with `Content-Type: application/json`). It is a normal file in the admin export's `public/` folder so the `**/.*` ignore rule does not drop it.
- `/e/**` is rewritten to the `eventSharePageV1` Cloud Function (see Rich link previews). Its page reuses the landing page's "Get the app" button (`dip://events/<id>` through a hidden frame: opens the installed app, otherwise nothing happens; with `APP_STORE_ID` set, a tap that leaves the page visible after about 1.5 seconds goes to the App Store listing). Below it one muted line says DIP is coming to the App Store while `APP_STORE_ID` is unset, or links to the listing once it is set. Nothing redirects automatically. Fonts (Fjalla One, Figtree) load from Google Fonts, as on the landing page. The old static `share/event.html` was removed.
- `firebase.json` is a shared choke point: the edit is two `rewrites` entries and one `headers` entry; existing admin rules are unchanged. `scripts/tests/test_hosting_share_links.py` checks the config.

## Placeholders

| What | Where | Value now |
| --- | --- | --- |
| Apple Team ID | `apps/admin/public/aasa/apple-app-site-association.json` | `AX2A775SS6.work.letsdip.app` |
| App Store ID | `APP_STORE_ID` in `gcp/functions/src/config/launch.ts`, read by the share page and the landing build ([launch switches](../ops/launch-switches.md)); the Safari banner meta uses `0000000000` until set | empty (shows "coming to the App Store") |
| Public domain | `DIPShareLink.baseURL`, `SHARE_ORIGIN` in `sharePage.ts`, `applinks:` in `ui/Config/DIP-Paid.entitlements`, Firebase Hosting custom domain | `letsdip.work` (the old `team05-dip.web.app` only redirects here; it is not an `applinks:` host because Apple does not follow redirects for the association file) |

## Associated Domains and local builds

Associated Domains need a paid Apple Developer team. A free Personal Team cannot sign the entitlement, so the default `ui/Config/DIP.entitlements` (now tracked, no longer generated) has only the keychain group, and `CODE_SIGN_ENTITLEMENTS` is `$(DIP_ENTITLEMENTS)` (default in `Config/Base.xcconfig`). A paid-team build sets `DIP_ENTITLEMENTS = Config/DIP-Paid.entitlements` in the untracked `ui/Config/Local.xcconfig`. Local phone builds are unaffected; Universal Links simply do not open the app there, but `dip://events/<id>` does (the landing page's button). If a personal `project.local.yml` defines its own `entitlements:`, drop that block.

## Owner steps

1. Join the paid Apple Developer Program team, enable Associated Domains for `work.letsdip.app`, and put `DIP_ENTITLEMENTS = Config/DIP-Paid.entitlements` in `Local.xcconfig`.
2. Team ID AX2A775SS6 is in the AASA file.
3. Create the App Store Connect listing and set `APP_STORE_ID` in `gcp/functions/src/config/launch.ts`, then redeploy the function and hosting (the landing page is built from the same value). Full checklist: [TestFlight and Universal Links](../ops/testflight-universal-links.md).
4. Build the admin export (`npm --prefix apps/admin run build`) and deploy hosting (`firebase deploy --only hosting`) after approval. Verify `curl -i https://letsdip.work/.well-known/apple-app-site-association` returns 200 JSON without a redirect.
5. Done: `letsdip.work` is connected in Firebase Hosting (apex plus `www` redirect) and the three places above were switched together.

## Rich link previews

Crawlers (iMessage/LinkPresentation, Facebook, LinkedIn, Slack, Discord, WhatsApp, Telegram, Teams, X) do not run JavaScript, so `/e/**` is served by a public HTTP function, `eventSharePageV1` (2nd gen, `us-central1`, codebase `dip`, no auth, GET/HEAD only; App Check does not apply to crawlers). Code: `gcp/functions/src/modules/share/` (pure `domain/sharePage.ts`, `application/getSharePage.ts`, `infrastructure/firestoreShareStore.ts`, thin `transport/eventSharePageV1.ts`).

**Data flow.** The URL carries only the opaque event id. A collection-group query cannot find a document by id alone (`documentId()` needs the full path) and events store no id field, so the smallest safe alternative is a server-owned top-level index `eventShares/{eventId} = { companyId, createdAt }`, written by the same transaction as `createEvent` in `createEventV1`. Rules are untouched: the collection falls into the deny-all baseline, only the Admin SDK reads it. The function does two bounded reads (index doc, then the event with a Firestore field mask of `companyId, title, description, startTime, coverImageURL, status`, so venue, tags, counts and audit fields are never loaded), with a 4 s timeout. Events created before this change need `gcp/scripts/backfill-event-shares.mjs` (dry-run default, `--apply` creates missing entries only, never overwrites; reports conflicts). Without an index entry the page shows the generic DIP card.

**What the page exposes (privacy).** To anyone holding the unguessable link, and to every preview service the link is pasted into: the event title, up to about 180 characters of the description (whitespace collapsed, cut at a word boundary), a coarse date such as "Fri, Nov 20" (America/New_York, never a time of day) and an image. Never the venue, address, locality, coordinates, cost, tags, attendee names or counts, company id or user data. Caveat: the description is organizer-written free text; if an organizer types an address into it, that text is in the preview. Cancelled, draft, deleted, unknown, malformed and not-yet-indexed ids all return the same generic DIP page with HTTP 200, so an id's existence is not revealed. Responses are `Cache-Control: public, max-age=300, s-maxage=600`, `X-Robots-Tag: noindex`; lookup failures use a 30 s cache.

**Tags emitted:** `og:title/description/url/site_name/type/locale`, `og:image` (+`:secure_url`, `:type`, `:width`, `:height` for our 1200x630 JPEGs, `:alt`), `twitter:card=summary_large_image`, `twitter:title/description/image/image:alt`, `<title>`, `meta description`, `link rel=canonical`, `link rel=image_src`, `theme-color`, `apple-itunes-app`. No `meta refresh`; there is no automatic redirect.

**Images.** `catalog://default/<category>` maps to `https://letsdip.work/share/og/<category>.jpg` (cover art scaled to 1200x630 with a DIP brand strip; under 300 KB each); `og/default.jpg` is the clover and wordmark on periwinkle. An https cover is used only when on this site or this project's Firebase Storage buckets, otherwise the default; arbitrary URLs are never hotlinked. Regenerate with `scripts/generate-share-og-images.sh` (needs `rsvg-convert` and macOS `sips`). The site pages have their own share cards at the same size and host: the landing page uses `https://letsdip.work/img/landing/og.jpg` and the admin portal `https://letsdip.work/img/og-admin.jpg`, both built by `scripts/make-og-images.py`; the function's default image path is unchanged.

**Shared files touched:** `firebase.json` (the `/e/**` rewrite now targets the function; every other rule unchanged) and `gcp/functions/src/index.ts` (one export). `scripts/tests/test_hosting_share_links.py` checks the hosting config.

### Deploy (needs owner approval; nothing here has been run for you)

```
npm --prefix apps/admin ci && npm --prefix apps/admin run build
firebase deploy --project team05-dip --only hosting,functions:dip:eventSharePageV1,functions:dip:createEventV1
node gcp/scripts/backfill-event-shares.mjs --project team05-dip            # dry run, read the output
node gcp/scripts/backfill-event-shares.mjs --project team05-dip --apply
```

First 2nd-gen deploys can fail on Eventarc/permission propagation; wait a few minutes and retry.

### Verify after deploy

```
curl -si -A 'facebookexternalhit/1.1' https://letsdip.work/e/<eventId> | head -60
curl -s  -A 'Twitterbot/1.0'          https://letsdip.work/e/<eventId> | grep -E 'og:|twitter:'
curl -sI https://letsdip.work/share/og/hiking.jpg            # 200 image/jpeg
curl -s  https://letsdip.work/e/doesnotexist1 | grep og:title  # generic "DIP"
```

Then paste the link into Messages (iMessage caches previews, so test a fresh link), the Facebook Sharing Debugger and opengraph.xyz. Confirm that no address, venue or attendee data appears and that the admin portal and `/.well-known/apple-app-site-association` still load.
