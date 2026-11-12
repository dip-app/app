# TestFlight and Universal Links checklist

Everything here needs the paid Apple Developer Program team. None of it is done yet. Owner steps are marked **(owner)**; the rest are repository changes that agents can prepare. Bundle ID: `org.dip-app.DIP`. Public domain: `letsdip.work`.

## A. Apple Developer account and App ID

- [ ] **(owner)** Enroll or join the paid team; note the **Team ID** (10 characters, developer.apple.com, Membership details).
- [ ] **(owner)** Register the App ID `org.dip-app.DIP` (explicit) with capabilities: Associated Domains, Push Notifications, Sign in is Google only so no Sign in with Apple, App Attest is used by Firebase App Check (nothing to enable on the App ID).
- [ ] **(owner)** In the Firebase console, iOS app settings: set the Team ID and App Store ID later (section E); upload the APNs auth key ([push client](../design/push-client.md)); in App Check, the iOS app uses App Attest.
- [ ] Local signing: put your team in the untracked `ui/Config/Local.xcconfig` (`DEVELOPMENT_TEAM`, bundle ID). Never commit it, and never commit `GoogleService-Info.plist`.

## B. Universal Links (share links `https://letsdip.work/e/<eventId>`)

- [ ] Replace `TEAMID` in `apps/admin/public/aasa/apple-app-site-association.json` with the real Team ID so the app ID reads `<TEAMID>.org.dip-app.DIP`. (One-line change; the path component `/e/*` stays.)
- [ ] In `ui/Config/Local.xcconfig` select the paid entitlements: `DIP_ENTITLEMENTS = Config/DIP-Paid.entitlements` (or `#include "Push.xcconfig"` once push is ready, which selects `DIP-Paid-Push.entitlements` and also carries `applinks:letsdip.work`).
- [ ] Entitlements check: `applinks:letsdip.work` is in the file (it must match `DIPShareLink.baseURL`'s host). No `applinks:team05-dip.web.app`: Apple does not follow redirects for the association file.
- [ ] Deploy hosting `letsdip` after approval ([runbook](deploy-runbook.md#hosting)); then `curl -si https://letsdip.work/.well-known/apple-app-site-association` must return 200, `application/json`, no redirect, and the right app ID.
- [ ] On a physical device (Universal Links do not work in the simulator reliably): install the build, tap a `https://letsdip.work/e/<id>` link in Notes or Messages (typing it in Safari's address bar does not trigger it): the app opens the event for a member of that company; "Activity unavailable" for another company. Long-press the link: "Open in DIP" is offered. Delete and reinstall the app if iOS cached an older association file; Apple's CDN can take a few hours to refresh.
- [ ] Not installed: the link opens the share page with a preview and "Get the app".
- [ ] `dip://events/<id>` (landing "Get the app" and notification deep links) opens the app.

## C. Build and upload

- [ ] Versioning: `MARKETING_VERSION` (user-facing) and `CURRENT_PROJECT_VERSION` (monotonic build number, bump for every upload) from `ui/project.yml`; regenerate the project (`xcodegen` as documented in the ui README).
- [ ] Release configuration: Firebase config present locally (`GoogleService-Info.plist` from the Firebase console), the Google sign-in reversed client ID set (`GOOGLE_REVERSED_CLIENT_ID` in `Local.xcconfig`), App Check provider = App Attest (not the debug provider).
- [ ] Product, Archive; Distribute App, App Store Connect, Upload. Check the exported entitlements: `aps-environment` is `production` for push builds, `com.apple.developer.associated-domains` contains `applinks:letsdip.work`.
- [ ] Privacy manifest and "Export compliance": the app uses only standard HTTPS encryption (answer accordingly); Firebase SDK privacy manifests ship with the SDK versions in use.
- [ ] Debug-only surfaces are excluded from release builds (preview account repository, fixtures). Shake to report is limited to Debug and TestFlight (the TestFlight receipt check), so it does not ship in the App Store build.

## D. App Store Connect: TestFlight

- [ ] **(owner)** Create the app record (name "DIP", bundle ID `org.dip-app.DIP`, SKU, primary language English (U.S.)).
- [ ] Wait for the build to finish processing; fix any email from Apple about missing icons, usage descriptions or privacy items.
- [ ] Internal testing: add the team under Internal Testers (up to 100, App Store Connect users); the build is available immediately without review.
- [ ] External testing (company members outside the team): create a group, add testers or a public link, fill Test Information (what to test, contact, feedback email, demo sign-in notes: Google sign-in with a company-domain account; give App Review a working demo account if they ask), submit for Beta App Review (first build of each version).
- [ ] Testers need a company-domain Google account whose domain is registered with a company in production, or the app says the company is not on DIP.
- [ ] Verify on a device: the [push test plan](../design/push-client.md#device-verification-and-enablement-checklist), Universal Links (section B), photo upload, shake to report.

## E. App Store listing (when going public)

- [ ] **(owner)** Listing: subtitle, description, keywords, support URL (`https://letsdip.work/`), marketing URL, privacy policy URL (a page must exist and be public before submission), category, age rating, screenshots (6.9" and 6.5" iPhone at minimum), app icon (1024 px, no alpha).
- [ ] **(owner)** App Privacy ("nutrition label"): data collected and linked to the user: name and email (Google sign-in), user content (photos, chat messages, bug reports and optional screenshots), identifiers (push token, install id), diagnostics. Match what `docs/contracts/data-ownership.md` says is stored; no tracking.
- [ ] Review notes: Google-only sign-in, company-domain gating, how to get a demo account.
- [ ] After the listing exists, copy its numeric ID (App Store Connect, App Information, Apple ID; or the `id<digits>` in the listing URL) into `APP_STORE_ID` in `gcp/functions/src/config/launch.ts` and deploy Functions and Hosting together; optionally enable the official badge ([launch switches](launch-switches.md#official-badge-prepared-not-enabled)).
- [ ] Flip indexing last, after the listing and landing are final ([launch switches](launch-switches.md#1-search-indexing-noindex)).
- [ ] Submit for review; choose manual release the first time.

## F. Done criteria

A device with a TestFlight build opens a shared event link straight into the app, receives each push type in the push test plan, uploads an album photo, and the landing and share pages show the right store link. Record the outcome, build number and tester devices in the session log and update [CURRENT_STATE.md](../../CURRENT_STATE.md).
