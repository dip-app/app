# Work session

User: sandervonk
Date: 2026-11-27
Workstream: testflight-0-1-8
Agent: Claude
Status: completed

## Summary

Bump the iOS marketing version to 0.1.8 for TestFlight, carrying iOS polish wave 4 from #378.

## Changes

- ui/project.yml: MARKETING_VERSION 0.1.7 to 0.1.8 (wave 4: skeleton fade-in, rolling join counts, cancelled notice, grouped notification settings, unified text actions, points wording).

## Validation

- Archive and upload with scripts/testflight.sh --use-secrets after merge; check with scripts/testflight-distribute.sh --version 0.1.8 --list.

## Decisions

- New 0.1.N version per upload.

## Handoff

Next TestFlight upload after this one is version 0.1.9.
