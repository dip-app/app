# Work session

User: sandervonk
Date: 2026-11-28
Workstream: testflight-0-1-9
Agent: Claude
Status: completed

## Summary

Bump the iOS marketing version to 0.1.9 for TestFlight, carrying iOS polish wave 5 from #381.

## Changes

- ui/project.yml: MARKETING_VERSION 0.1.8 to 0.1.9 (wave 5: header on load failure, shared chat sheet header, next steps for empty Home and full activities).

## Validation

- Archive and upload with scripts/testflight.sh --use-secrets after merge; check with scripts/testflight-distribute.sh --version 0.1.9 --list.

## Decisions

- New 0.1.N version per upload.

## Handoff

Next TestFlight upload after this one is version 0.1.10.
