# Work session

User: sandervonk
Date: 2026-11-27
Workstream: testflight-0-1-5
Agent: Codex
Status: completed

## Summary

Bump the iOS marketing version to 0.1.5 for TestFlight, carrying iOS polish wave 3.

## Changes

- ui/project.yml: MARKETING_VERSION 0.1.4 to 0.1.5 (wave 3: bar fade fix, large-text chips, Duo profile, failed upload tiles, onboarding interests preview, My Events pull to refresh, launch screen).

## Validation

- Archive and upload with scripts/testflight.sh --use-secrets after merge; check with scripts/testflight-distribute.sh --version 0.1.5 --list.

## Decisions

- New 0.1.N version per upload.

## Handoff

Next TestFlight upload is version 0.1.6.

