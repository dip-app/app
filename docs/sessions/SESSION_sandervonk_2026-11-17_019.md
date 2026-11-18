# Work session

User: sandervonk
Date: 2026-11-17
Workstream: swift-ci-hinge
Agent: Claude
Status: completed

## Summary
CI xcodebuild (Xcode 26.x) cannot find UIHingeInteraction in DuoLayout.swift; it is an iOS 27.1 SDK API.

## Changes
ui/DIP/Support/DuoLayout.swift: hinge interaction code wrapped in #if compiler(>=6.4); older toolchains return true (no hinge API).

## Validation
xcodebuild DIP scheme builds locally with Xcode 27; behavior on iOS 27.1 builds unchanged.

## Decisions
Compiler-version guard because the SDK symbol is absent on CI's Xcode 26.

## Handoff
Watch Swift checks on main; further CI-only compile or ComponentPreview verify errors may follow.
