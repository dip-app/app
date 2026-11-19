# Work session

User: sandervonk
Date: 2026-11-19
Workstream: testflight-distribute
Agent: Codex
Status: completed

## Summary

Scripted tester distribution for TestFlight builds, the shared design review protocol, and the closed dispatcher experiment note.

## Changes

- scripts/testflight-distribute.sh and .mjs: list builds and add a processed build to beta groups through the App Store Connect API with the encrypted key.
- docs/ops/testflight-universal-links.md: scripted release steps.
- docs/design/design-review.md: shared design reviewer protocol and rubric used by all UI agents.

## Validation

- Ran the script with --list against production: build 0.1.1 is VALID and the only beta group (team05, internal, all builds) receives it automatically.

## Decisions

- Dispatcher PR 325 closed without merging, branch kept, because of the downsides recorded on the PR.

## Handoff

Next TestFlight upload is version 0.1.2; follow the scripted steps in the ops doc.

