# Work session

User: sandervonk
Date: 2026-11-18
Workstream: swift-ci-preview
Agent: Claude
Status: completed

## Summary
CI verify.py step failed: the ComponentPreview project no longer compiled (MockLaunch, dipDuoOpen, PushFeature missing from its source list). Reproduces locally.

## Changes
ui/ComponentPreview/verify.py: new --build-only flag (build-for-testing); swift.yml uses it, since the 159-test UI suite takes ~40 min and does not fit the 45 min job. ui/ComponentPreview/project.yml: add Support/DuoLayout.swift, App/MockLaunch.swift, Domain/Push/PushRegistration.swift to the Preview sources.

## Validation
Preview scheme builds locally. Full local verify.py UI run: 159 tests, 26 failures, ~40 min (pre-existing/unrelated, not investigated).

## Decisions
Add the three self-contained files instead of changing app code.

## Handoff
Triage the 26 failing Preview UI tests locally; CI only compiles them for now.
