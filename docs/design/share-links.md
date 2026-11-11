# Event share links and Universal Links

Status: implemented in the app and hosting files; **nothing deployed**. Needs the owner steps below.

## Link format

`https://team05-dip.web.app/e/<eventId>` (constant `DIPShareLink.baseURL` in `ui/Packages/DIPCore/Sources/DIPCore/DIPShareLink.swift`; the only place the domain lives in Swift). The URL carries only the opaque event id, never a company id, title or personal data. Authorization is unchanged: the app opens the id inside the signed-in member's own company; a member of another company (or an id that no longer exists) sees "Activity unavailable". `DIPShareLink.url(forEventID:)` builds it and `DIPShareLink.eventID(from:)` parses it, rejecting other hosts, schemes, ports, user info and paths. The parser also accepts the push deep link `dip://events/<id>[/chat]` (see `docs/contracts/callables.md`); the `dip` URL scheme is now registered in `ui/project.yml`.

Share button: `ShareLink(item: <link>, message: <share text>)` on the event page, so rich targets show a link preview and text targets get the paragraphs followed by the link as the last line. `DIPEventMetadata.shareText(title:description:link:)` appends the link as its last line when given one (used and tested in DIPCore). Cancelled events share no link.

## App behaviour

`DIPApp` receives `.onOpenURL` (custom scheme, and Google sign-in redirects are handled first) and `.onContinueUserActivity(NSUserActivityTypeBrowsingWeb)` (Universal Links) and queues the event id in `EventLinkInbox`. The queue is consumed by `DIPMemberHome` only for a resolved member and not while the onboarding tour or its replay is showing, then `DIPPrototypeApp` opens the event page. Signed-out users keep the queued link through sign-in and company resolution.

## Hosting (files only)

- `apps/admin/public/aasa/apple-app-site-association.json`: the association file, served at `/.well-known/apple-app-site-association` through a rewrite in `firebase.json` (with `Content-Type: application/json`). It is a normal file in the admin export's `public/` folder so the `**/.*` ignore rule does not drop it.
- `apps/admin/public/share/event.html`: plain HTML/CSS landing page served for `/e/**`. It offers an "Open in DIP" button (`dip://events/<id>`) and redirects to the App Store listing after about 2.5 seconds. While `APP_STORE_ID` is unset it shows "DIP is coming to the App Store" with a note instead of redirecting.
- `firebase.json` is a shared choke point: the edit is two `rewrites` entries and one `headers` entry; existing admin rules are unchanged. `scripts/tests/test_hosting_share_links.py` checks the config.

## Placeholders

| What | Where | Value now |
| --- | --- | --- |
| Apple Team ID | `apps/admin/public/aasa/apple-app-site-association.json` | `TEAMID.org.dip-app.DIP` |
| App Store ID | `APP_STORE_ID` in `apps/admin/public/share/event.html` | empty (shows "coming to the App Store") |
| Custom subdomain | `DIPShareLink.baseURL`, `applinks:` in `ui/Config/DIP-Paid.entitlements`, Firebase Hosting custom domain | `team05-dip.web.app` |

## Associated Domains and local builds

Associated Domains need a paid Apple Developer team. A free Personal Team cannot sign the entitlement, so the default `ui/Config/DIP.entitlements` (now tracked, no longer generated) has only the keychain group, and `CODE_SIGN_ENTITLEMENTS` is `$(DIP_ENTITLEMENTS)` (default in `Config/Base.xcconfig`). A paid-team build sets `DIP_ENTITLEMENTS = Config/DIP-Paid.entitlements` in the untracked `ui/Config/Local.xcconfig`. Local phone builds are unaffected; Universal Links simply do not open the app there, but `dip://events/<id>` does (the landing page's button). If a personal `project.local.yml` defines its own `entitlements:`, drop that block.

## Owner steps

1. Join the paid Apple Developer Program team, enable Associated Domains for `org.dip-app.DIP`, and put `DIP_ENTITLEMENTS = Config/DIP-Paid.entitlements` in `Local.xcconfig`.
2. Replace `TEAMID` in the AASA file with the real Team ID.
3. Create the App Store Connect listing and set `APP_STORE_ID` in `event.html`.
4. Build the admin export (`npm --prefix apps/admin run build`) and deploy hosting (`firebase deploy --only hosting`) after approval. Verify `curl -i https://team05-dip.web.app/.well-known/apple-app-site-association` returns 200 JSON without a redirect.
5. Optional: connect a custom subdomain in Firebase Hosting, then change the three places in the table above together.
