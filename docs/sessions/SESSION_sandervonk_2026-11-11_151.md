# Work session

User: sandervonk
Date: 2026-11-11
Workstream: landing-frame-logo
Agent: claude
Status: complete

## Summary

Landing page (letsdip.work root): real iPhone 16 bezel around the phone, real simulator screenshots instead of Figma crops, app logo in the header and as favicon.

## Changes

- apps/landing/index.html: phone is the Apple iPhone 16 black bezel (860x1751) overlaid on the screenshots, screen inset 2.1698% 5.1028% 2.2073% and clip radius 7.75%/3.58% from the frame's meta.json; old CSS bezel removed; float/cross-fade and reduced-motion kept. Header logo is the Figma favicon (node 3201:1095) before a single-colour DIP wordmark; favicon and apple-touch-icon updated.
- apps/landing/img: iphone-frame.png, logo.svg, apple-touch-icon.png (180px, square), home/event/joined/album/rewards.webp (600x1305, 40-81 KB); old jpgs removed.
- scripts/build-site.sh: copies every file in apps/landing/img to site-dist/img/landing.

## Validation

- Screenshots from the Preview app (ui/ComponentPreview, feature/v2-remaining, fixtures only, no Firebase) on simulator Claude-DIP (iPhone 17 Pro, light, status bar 9:41) holding /tmp/dip-sim-lock; status bar cleared, app uninstalled, lock released, build output deleted.
- scripts/build-site.sh --skip-admin-build with a stub apps/admin/out; checked 375px and 1280px in the built-in browser, animations frozen per screen, no horizontal scroll.
- npm run check (Node 24.12): 178 pass, 0 fail, 6 todo.

## Decisions

- Event page (not joined) was reached by tapping the Puppy Yoga card on Home, because --screen=event with v1 fixtures opens the already joined state.
- Album uses the fixture's bundled reference photos.

## Handoff

Coordinator deploys Hosting. Not tested on a real Safari/iOS device.
