# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Landing page and /admin on shared Hosting site
Agent: Claude Code
Status: completed

## Summary

Add a static landing page at the apex of the shared Hosting site and move the admin portal to /admin so one site (and one custom domain, letsdip.work) serves landing, admin, share links and the Universal Links file.

## Changes

- apps/landing/index.html (animated phone, 'Coming soon' pill, small admin link); scripts/build-site.sh assembles site-dist/ (landing at /, admin export at /admin/, aasa/share/img at root); firebase.json hosting public -> site-dist; apps/admin/next.config.ts basePath /admin; .gitignore site-dist/.

## Validation

- Admin build with basePath succeeds; local static server returned 200 for /, /admin/, /admin/login/ and /img/*; landing scenes checked at desktop and phone width. AASA is a Hosting rewrite so it was not testable on the static server.

## Decisions

- One Hosting site with admin under /admin (owner preference) instead of a second site. App download is an informational 'Coming soon' pill until an App Store ID exists. Landing keeps the site-wide noindex header while the app is pre-release.

## Handoff

After merge: deploy hosting, add letsdip.work as a custom domain, then switch DIPShareLink.baseURL, applinks: and SHARE_ORIGIN together once DNS and SSL are live.

## Follow-up: Figma frames

The landing phone now cycles real Figma frames (Home, Event Page, Event Page (Joined), Album Page, Rewards from file DCIagJo7uk5IOUGqlKzAjf), cropped to the screen and stored in apps/landing/img/ (about 440 KB); build-site.sh copies them to /img/landing/. They are design placeholders, so re-export when the designs change.

## Follow-up: letsdip.work

Hosting deployed (landing at /, admin at /admin/). letsdip.work and www.letsdip.work (redirect) were added as Firebase Hosting custom domains via the Hosting API; DNS (A 199.36.158.100, TXT hosting-site=team05-dip) was already in place and the apex serves over HTTPS. This change switches SHARE_ORIGIN, DIPShareLink.baseURL and the paid entitlements' applinks together (old host kept in applinks), keeps the old origin in the approved preview-image prefixes, and updates the hosting test for site-dist. Pending: eventSharePageV1 redeploy, www certificate, Firebase Auth authorized domain for admin sign-in, Team ID in the AASA file.

## Follow-up: separate redirect site

team05-dip.web.app cannot redirect itself while it also serves letsdip.work, so letsdip.work and www moved to a new Hosting site `letsdip` (firebase.json is now a two-site array: `letsdip` = landing, /admin/, share route, AASA; `team05-dip` = redirect-only, apps/redirect, 301 to https://letsdip.work/:path*). Required DNS changes: TXT hosting-site=letsdip and www CNAME letsdip.web.app. Only `hosting:letsdip` was deployed; the redirect (`firebase deploy --only hosting:team05-dip`) must wait until letsdip.work has an active certificate. Admin CI workflow now assembles site-dist before deploying. Note: AASA does not follow redirects, so the legacy applinks: host in the paid entitlements stops working once the redirect is live; drop it then.

## Follow-up: Apple links

Removed the legacy `applinks:team05-dip.web.app` from ui/Config/DIP-Paid.entitlements (only `applinks:letsdip.work` remains; Apple does not follow redirects for the association file) and refreshed the share-link docs, FRONTEND_PLAN row and admin README. Still open: replace `TEAMID` in the AASA file with the paid team's real Team ID.

## Follow-up: authorized domains

Added `letsdip.work` and `www.letsdip.work` to Firebase Auth authorized domains (Identity Toolkit admin API) and to the "DIP Admin web" reCAPTCHA Enterprise key's allowed domains; existing entries kept. The admin's Google popup sign-in uses the firebaseapp.com handler, so no OAuth client change was needed.

## Follow-up: redirect live

Owner approved turning the legacy redirect on without waiting for letsdip.work's certificate (nothing had been shared). `hosting:team05-dip` deployed: every path (including `/`) answers 301 to https://letsdip.work/<path>. Until letsdip.work has an active certificate, the redirect target does not load over HTTPS; letsdip.web.app serves the same content meanwhile.

## Follow-up: Get it now button

The landing page's informational "Coming soon to the App Store" pill became a solid App Store blue (#0071E3, white text, hover/active/focus states) "Get it now" button. Its href is a placeholder (https://apps.apple.com/) with a TODO: replace with the real listing URL once the App Store ID exists.

## Follow-up: tilt and shimmer

Ported the case-study DeviceFrame effect (sandervonk.github.io/src/components/case/primitives/DeviceFrame: perspective 900px, max tilt 7deg with cursor falloff, spring-like easing, Shimmer sheen sliding against the tilt with proximity opacity) to plain JS in apps/landing/index.html. Disabled for prefers-reduced-motion and coarse pointers. Verified by dispatching pointer events in the browser: tilt follows, then returns to ~0.
