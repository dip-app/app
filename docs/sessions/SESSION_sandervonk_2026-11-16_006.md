# Work session

User: sandervonk
Date: 2026-11-16
Workstream: testflight-script
Agent: Claude
Status: complete

## Summary

TestFlight publish script plus privacy and support pages for App Store Connect.

## Changes

scripts/testflight.sh, ui/Config/ExportOptions-TestFlight.plist, apps/landing/privacy and support pages, build-site.sh copies them, runbook section.

## Validation

scripts/testflight.sh --dry-run archives Release successfully; real upload verified earlier with the same options.

## Decisions

Policy states no ads or third-party analytics SDKs (verified none in ui/); contact address support@letsdip.work must exist.

## Handoff

Owner: create the support mailbox, have the policy reviewed, enter URLs in App Store Connect.


