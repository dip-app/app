# Work session

User: sandervonk
Date: 2026-11-16
Workstream: testflight
Agent: Claude
Status: complete

## Summary

First TestFlight upload (bundle work.letsdip.app, team AX2A775SS6, build 1 via Xcode 27.2). Tracked config now defaults to the paid team.

## Changes

ui/Config/Base.xcconfig: DEVELOPMENT_TEAM, paid push entitlements, DIP_PUSH_ENABLED=YES. Entitlements: App Attest production. project.yml: iPhone-only, ITSAppUsesNonExemptEncryption=NO.

## Validation

Release archive signed; export upload to App Store Connect succeeded; beta Xcode was rejected earlier.

## Decisions

iPhone-only until iPad screenshots and orientations exist.

## Handoff

Owner: create APNs key and upload to Firebase; set up TestFlight testers and privacy policy URL in App Store Connect.


