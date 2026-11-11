# Work session

User: sandervonk
Date: 2026-11-11
Workstream: web
Agent: Claude (Sonnet 5.5)
Status: handoff

## Summary

Web metadata for https://letsdip.work/ and /admin/, share images, a full favicon/manifest set, and a redesigned admin login page that uses the app's real avatar characters. Nothing was deployed.

## Changes

- apps/landing/index.html: title, description, canonical, robots (noindex kept, matches the firebase.json `X-Robots-Tag`), light/dark theme-color, Open Graph (with image size and alt), Twitter card, favicon set, apple-touch-icon, manifest link. All URLs are absolute.
- apps/admin: `src/lib/seo.ts` (shared metadata), `src/app/layout.tsx` (title template, canonical /admin/, OG/Twitter, icons, manifest, viewport theme-color), new `src/app/login/layout.tsx` (own title/description). Removed the template's placeholder `src/app/icon.svg` (a yellow "S") in favour of the DIP mark PNG set.
- Assets: apps/landing/img/og.jpg, favicon-32.png, icon-192/512.png, apple-touch-icon.png (now an opaque full-bleed square), site.webmanifest; apps/admin/public/img/og-admin.jpg and public/img/admin/ (favicons and manifest). Built by scripts/make-og-images.py (Pillow, rsvg-convert for the favicons).
- Admin login redesign: login/page.tsx, new components/LoginArt.tsx, login block in styles/globals.scss; removed components/Faces.tsx (hand-drawn identical faces). Avatars (8, webp) in apps/admin/public/img/avatars/ via scripts/export-admin-avatars.py from the iOS asset catalog and the Figma `Avatar=*` set.
- Docs: apps/admin/README.md, docs/design/share-links.md.

## Validation

- Admin: lint, typecheck and the build ran under Node 24.12 (see PR for exact results); the built pages and site-dist were checked for every tag and that each image path resolves.
- Design audit (shared auditor): login and both share images, 2 rounds, PASS; small edits applied after round 2. Screenshots in the session scratchpad (shots/web).
- Independent code review applied: landing no longer carries a robots meta (the firebase.json header is the single noindex switch), admin theme-color is one colour (light-only portal), tablet banner fixes, `role="list"`, and `/favicon.ico` copied to the site root by scripts/build-site.sh.
- Checks run under Node 24.12: `npm --prefix apps/admin run lint`, `typecheck`, `test` (42 passed, 2 skipped), `scripts/build-site.sh` (full build), `python3 scripts/tests/test_hosting_share_links.py`.
- Sign-in in mock mode verified in the browser (button routes to /events/).
- Not verified: live Google sign-in, social-platform previews (Facebook debugger, Slack, iMessage) after deploy, real-device Reduce Motion.

## Decisions

- Pre-release noindex stays everywhere. To open the landing to search engines later, remove the `X-Robots-Tag` header in firebase.json (and the `robots` meta in apps/landing/index.html and layout.tsx for the admin, which should stay noindex).
- The avatars exist only as 44-80 px rasters in the app (Figma flattens them too), so the export script upscales and snaps them to their flat palette. Better source art (vector) would improve them.
- The share-function default image (`/share/og/default.jpg`) is unchanged; no gcp code was touched.
- The portal is light-only, so the login stays light in dark mode.
- Share cards keep the logo and headline inside the centre 630px square so square crops stay readable.

## Handoff

Owner deploys. After deploy, paste both URLs into a link-preview debugger and check `https://letsdip.work/img/landing/og.jpg` and `https://letsdip.work/img/og-admin.jpg` return 200. Rebuild the admin with the live Firebase env before deploying (README).
