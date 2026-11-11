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
