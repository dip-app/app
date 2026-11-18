# Work session

User: sandervonk
Date: 2026-11-18
Workstream: testflight-0-1-1
Agent: Codex
Status: completed

## Summary

Bump the iOS marketing version to 0.1.1 for the next TestFlight upload (owner asked for a new 0.1.N version per upload).

## Changes

- ui/project.yml: MARKETING_VERSION 0.1.0 to 0.1.1.

## Validation

- Archive and upload via scripts/testflight.sh --use-secrets after merge.

## Decisions

- Each TestFlight upload bumps the 0.1.N patch version.

## Handoff

Next upload is 0.1.2.

