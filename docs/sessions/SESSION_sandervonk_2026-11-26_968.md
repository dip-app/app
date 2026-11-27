# Work session

User: sandervonk
Date: 2026-11-26
Workstream: public-polish-1
Agent: Claude (Opus), public surfaces polish owner
Status: completed

## Summary

Audited and polished the public website and the event share pages (the email templates are a separate PR from the same session). Audit with headless Chrome screenshots at 1440, 768, 390 and 320 px in light and dark, reproduced link unfurls and measured metrics; ranked findings in docs/design/polish-2026-11/public.md; an independent Opus critique changed the plan before code; two fresh Opus review rounds (FAIL with three P2, then PASS).

## Changes

- apps/landing/index.html: honest private-beta call to action ("Private beta on iPhone", "How to join" button and three steps, secondary "Open the app" with a hedged didn't-open notice and an iPhone-only message on desktop), brand accent buttons without the App Store glyph, header "Admin portal" link, shared footer with Privacy, Support and the contact address, H2 feature cards, WebP bezel (183 KB to 26 KB), self-hosted fonts with metric-matched fallbacks, no horizontal overflow at 320.
- apps/landing/privacy, support, 404.html (new): same header and footer, centered reading column, AA link color, contact callouts, stacked privacy table on small phones, Open Graph tags, a "How do I get the app?" answer; legal text unchanged. scripts/build-site.sh copies 404.html.
- apps/landing/img: figtree.woff2 and fjalla-one.woff2 (Latin subsets of the repo's OFL fonts, licenses beside them), iphone-frame.webp.
- apps/landing/robots*.txt, sitemap.xml: a link-preview crawler group in both variants; sitemap lists privacy and support.
- gcp/functions/src/config/launch.ts: TESTFLIGHT_URL switch (empty). scripts/launch_config.py renders the private beta, TestFlight and App Store states.
- gcp/functions/src/modules/share: "Open in DIP" primary, honest beta line or secondary install button, hedged notice, no automatic store redirect, no placeholder Smart App Banner, description shown on the page, neutral generic page ("An event on DIP"), company time zone for the coarse date (emailSettings, read in parallel), cover strip cropped, longer page heading, self-hosted fonts.
- apps/admin/public/share/og/default.jpg and scripts/generate-share-og-images.sh: square-safe stacked mark.
- Tests: gcp/tests/unit/share-page.test.ts, scripts/tests/test_launch_config.py. Docs: share-links.md, launch-switches.md, testflight-universal-links.md.

## Validation

- `node --import tsx --test gcp/tests/unit/share-page.test.ts`: 23 pass.
- `python3 -m unittest scripts/tests/test_launch_config.py scripts/tests/test_hosting_share_links.py`: pass.
- `npx tsc --noEmit -p gcp/functions`: clean. `python3 scripts/check-docs.py`: clean. `npm run test:sessions` before the PR.
- Screenshots: 88 after captures per round, 0 px overflow, no tap target under 44 px outside running text, no third-party requests.
- Not run: real iPhone (Universal Links, hidden-frame launch), live crawler unfurls, deploy (coordinator deploys).

## Decisions

Recorded in docs/design/polish-2026-11/public.md (critique accepted and rejected items, both review rounds). Key ones: no automatic store redirect after a tap; robots preview group allows everything but /admin/, /u/, /o/; the share page shows the description already public in og:description; desktop gets an "iPhone app" message instead of a QR code.

## Handoff

Owner items: confirm the hidden-frame `dip://` launch on a current iPhone; decide how invited members get the beta build (and set TESTFLIGHT_URL if there is a public link); name the email provider in the privacy policy before email is turned on; replace category preview photos with cleared art when available. Remaining P3: the notice shifts content after a tap, 768 px hero alignment. Coordinator: redeploy Functions (eventSharePageV1) and Hosting together.
