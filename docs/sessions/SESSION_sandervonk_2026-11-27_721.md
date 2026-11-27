# Work session

User: sandervonk
Date: 2026-11-27
Workstream: testflight-0-1-7
Agent: Claude
Status: completed

## Summary

Bump the iOS marketing version to 0.1.7 for TestFlight, carrying organizer sign-in from #374.

## Changes

- ui/project.yml: MARKETING_VERSION 0.1.6 to 0.1.7 (organizers can sign in and use the app as members).

## Validation

- Archive and upload with scripts/testflight.sh --use-secrets after merge; check with scripts/testflight-distribute.sh --version 0.1.7 --list.

## Decisions

- New 0.1.N version per upload.

## Handoff

Next TestFlight upload after this one is version 0.1.8.
