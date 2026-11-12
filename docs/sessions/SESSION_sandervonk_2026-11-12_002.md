# Work session

User: sandervonk
Date: 2026-11-12
Workstream: bundle-id
Agent: Claude
Status: complete

## Summary

Bundle ID moved to work.letsdip.app under Apple Team AX2A775SS6. Also three stale Preview UI tests repaired.

## Changes

ui/project.yml, entitlements, AASA (AX2A775SS6.work.letsdip.app), docs, hosting test; Preview HomeThemePreview error mode (fails first two reads), DIPPrototypeApp --screen=event starts unjoined, ScreenFlowTests carousel drag. New Firebase iOS app registered, App Attest enabled; local plist and Local.xcconfig updated (gitignored).

## Validation

DIP scheme builds for simulator; test_hosting_share_links passes; the three UI tests pass individually on Claude-DIP.

## Decisions

Bundle ID work.letsdip.app (reverse of letsdip.work).

## Handoff

Deploy hosting for AASA; upload APNs key; rebuild phone with new plist.


