# Work session

User: sandervonk
Date: 2026-11-19
Workstream: testflight-0-1-2
Agent: Codex
Status: completed

## Summary

Bump the iOS marketing version to 0.1.2 for the next TestFlight upload.

## Changes

- ui/project.yml: MARKETING_VERSION 0.1.1 to 0.1.2. The build carries iOS 0.1.2 (member language sync, invite push actions, error copy), the Duo rail and orientation fixes, and the pill changes.

## Validation

- Archive and upload with scripts/testflight.sh --use-secrets after merge; check with scripts/testflight-distribute.sh --version 0.1.2 --list.

## Decisions

- A new 0.1.N version per upload, as the owner asked.

## Handoff

Next TestFlight upload is version 0.1.3.

