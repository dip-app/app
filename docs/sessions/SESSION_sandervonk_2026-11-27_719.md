# Work session

User: sandervonk
Date: 2026-11-27
Workstream: testflight-0-1-6
Agent: Claude
Status: completed

## Summary

Bump the iOS marketing version to 0.1.6 for TestFlight, carrying the weekly challenge copy rename from #370.

## Changes

- ui/project.yml: MARKETING_VERSION 0.1.5 to 0.1.6 (iOS strings now say weekly challenge instead of weekly theme).

## Validation

- Archive and upload with scripts/testflight.sh --use-secrets after merge; check with scripts/testflight-distribute.sh --version 0.1.6 --list.

## Decisions

- New 0.1.N version per upload.

## Handoff

Next TestFlight upload after this one is version 0.1.7.
