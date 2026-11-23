# Work session

User: sandervonk
Date: 2026-11-22
Workstream: swift-preview-fix
Agent: Codex
Status: completed

## Summary

Main's Swift checks failed after the Duo PR: the ComponentPreview target compiles DuoLayout.swift but not the app delegate, so the `extension DIPAppDelegate` placed there broke the preview build (cannot find type DIPAppDelegate).

## Changes

- Moved the orientation extension to ui/DIP/Support/DIPAppDelegate+Orientation.swift (app target only); DuoLayout.swift keeps DIPDuoOrientation.

## Validation

- The Swift checks workflow compiles the preview target; the app target still compiles both files. No simulator run.

## Decisions

- Fix in place by moving code, not by adding the delegate file to the preview target, so the preview stays small.

## Handoff

The 0.1.2 TestFlight archive was unaffected because it builds the app target; no new build is needed for this fix.

