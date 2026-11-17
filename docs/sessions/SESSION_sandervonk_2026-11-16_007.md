# Work session

User: sandervonk
Date: 2026-11-16
Workstream: testflight-guard
Agent: Claude
Status: completed

## Summary

TestFlight script now fails if the archive lacks App Attest (production), push or Associated Domains entitlements. Set the Team ID on the Firebase iOS app (needed for App Attest verification).

## Changes

scripts/testflight.sh entitlement guard.

## Validation

scripts/testflight.sh --dry-run passes with the guard.

## Decisions

Guard instead of trusting Local.xcconfig overrides.

## Handoff

Teammate to retest sign-in and event join on the existing TestFlight build.


