# Work session

User: sandervonk
Date: 2026-11-17
Workstream: swift-ci-xcode
Agent: Claude
Status: completed

## Summary
xcodebuild on CI failed: no AppIcon set found. AppIcon is an Icon Composer .icon bundle; runner default Xcode 16.4 cannot compile it.

## Changes
swift.yml: select newest Xcode 26+ (installed on the macos-15-intel image) before xcodegen/xcodebuild.

## Validation
CI-only; verified by the run on main.

## Decisions
Select Xcode 26 rather than adding a legacy appiconset, keeping a single icon source.

## Handoff
Watch Swift checks on main; ComponentPreview verify is the remaining untested step.
