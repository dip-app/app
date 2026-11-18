# Work session

User: sandervonk
Date: 2026-11-17
Workstream: swift-ci-boldtext
Agent: Claude
Status: completed

## Summary
Follow-up: after the Metal fix, CI xcodebuild failed on UIAccessibility.isBoldTextEnabled being main-actor isolated in DIPHomeComponents.swift.

## Changes
DIPHomeComponents.swift: read isBoldTextEnabled on the main actor from any caller.

## Validation
xcodebuild DIP scheme (iOS Simulator) builds locally.

## Decisions
Keep the sync nonisolated API; behavior unchanged.

## Handoff
Watch Swift checks on main; remaining step is ComponentPreview verify.
