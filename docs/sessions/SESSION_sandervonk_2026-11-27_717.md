# Work session

User: sandervonk
Date: 2026-11-27
Workstream: testflight-0-1-4
Agent: Codex
Status: completed

## Summary

Bump the iOS marketing version to 0.1.4 for TestFlight, carrying iOS polish waves 1 and 2.

## Changes

- ui/project.yml: MARKETING_VERSION 0.1.3 to 0.1.4 (polish waves 1 and 2: press feedback, scroll fades, skeletons, shared error states, live card dates, event facts line, notifications sheet).

## Validation

- Archive and upload with scripts/testflight.sh --use-secrets after merge; check with scripts/testflight-distribute.sh --version 0.1.4 --list.

## Decisions

- Owner asked to ship waves 1 and 2 now; wave 3 goes in 0.1.5.

## Handoff

Next TestFlight upload is version 0.1.5 with iOS polish wave 3.

