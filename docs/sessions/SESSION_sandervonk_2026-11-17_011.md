# Work session

User: sandervonk
Date: 2026-11-17
Workstream: swift-ci-fix
Agent: Claude
Status: completed

## Summary

Fix the Swift CI failure: PresentationTests read main-actor-isolated statics from a nonisolated test class.

## Changes

PresentationTests marked @MainActor.

## Validation

swift test for DIPDesignSystem, DIPAccounts and DIPCore pass locally; CI toolchain is stricter than local.

## Decisions

Same fix pattern as MessageComposerStateTests.

## Handoff

Watch the Swift checks run on this PR.

