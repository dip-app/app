# Work session

User: sandervonk
Date: 2026-11-23
Workstream: testflight-0-1-3
Agent: Codex
Status: completed

## Summary

Bump the iOS marketing version to 0.1.3 for the next TestFlight upload.

## Changes

- ui/project.yml: MARKETING_VERSION 0.1.2 to 0.1.3. The build carries the push quick actions, the notification center rows, the Email settings rows (weekly theme, admin digest, day-before reminder), the Duo top-spacing fix and the localized in-app notices.

## Validation

- Archive and upload with scripts/testflight.sh --use-secrets after merge; check with scripts/testflight-distribute.sh --version 0.1.3 --list.

## Decisions

- A new 0.1.N version per upload, as the owner asked.

## Handoff

Next TestFlight upload is version 0.1.4.

