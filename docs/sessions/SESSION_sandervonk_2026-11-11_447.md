# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Ops runbook, launch switches, push prep
Agent: Claude Code
Status: completed

## Summary

Wrote the production deploy runbook and ops docs, prepared the launch switches (noindex, App Store ID and badge) and the push enablement switch. Everything is off by default and nothing was deployed.

## Changes

- docs/ops/** (README, deploy-runbook, launch-switches, testflight-universal-links, seed-data); docs/milestones/v2/DECISIONS.md (locked decisions); CURRENT_STATE.md, FRONTEND_PLAN.md, docs/design/push-client.md, docs/design/share-links.md refreshed.
- gcp/functions/src/config/launch.ts (APP_STORE_ID, USE_OFFICIAL_APP_STORE_BADGE) read by sharePage.ts; badge variant in renderSharePage with a unit test in gcp/tests/unit/share-page.test.ts.
- scripts/launch_config.py, scripts/set-indexing.sh, scripts/build-site.sh (landing render, robots.txt, sitemap.xml), scripts/tests/test_launch_config.py, scripts/tests/test_hosting_share_links.py (placeholder moved).
- apps/landing/robots.txt, robots.noindex.txt, robots.index.txt, sitemap.xml; landing comment and an unused .store-badge style.
- ui/Config/Push.xcconfig, DIP-Paid-Push.entitlements, Local.example.xcconfig, Base.xcconfig comment.

## Validation

- python3 -m unittest discover -s scripts/tests: 22 pass (13 new). python3 scripts/check-docs.py: links ok. Landing build with an empty ID is byte-identical to the source page. Per the speed rules no tsc, npm run check, emulator suites or Xcode build were run; they run once at the end on the combined branch (the sandbox had Node 10 and no node_modules).

## Decisions

- Single config file for the App Store wiring (launch.ts), parsed as text by the landing build, so Functions deploys stay self-contained.
- Push enablement is one include line (Push.xcconfig) because xcconfig cannot conditionally add the aps-environment entitlement; a separate entitlements file carries it.
- set-indexing on also adds a /admin/** noindex header so the portal never becomes indexable.
- Locked owner decisions recorded in docs/milestones/v2/DECISIONS.md.

## Handoff

Owner: Team ID in the AASA file, APNs key upload, official badge SVG from Apple, App Store ID, and every deploy. Run the full test suite on the combined branch before deploying. Seed-weekly-theme needs manifest and undo support before its next production run.
