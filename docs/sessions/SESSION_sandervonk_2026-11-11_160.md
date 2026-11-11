# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Apple links on letsdip.work (feature branch)
Agent: Claude Code
Status: completed

## Summary

Bring feature/v2-remaining onto the letsdip.work domain so the app, share function and Apple links match main.

## Changes

- DIPShareLink.baseURL, SHARE_ORIGIN (plus LEGACY_SHARE_ORIGIN for stored preview images), applinks: in ui/Config/DIP-Paid.entitlements, and the two push tests that used the old host.

## Validation

- DIPCore Swift tests 202/202; Python hosting tests OK. Node share-page unit test and app tests not run here (CI).

## Decisions

- No legacy host in applinks: Apple does not follow redirects for the association file, and the old host only redirects.

## Handoff

Replace TEAMID in apps/admin/public/aasa/apple-app-site-association.json once the paid team exists; merge feature/v2-remaining into main when ready.
