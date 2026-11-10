# Work session

User: sandervonk
Date: 2026-11-10
Workstream: Onboarding P3 demo stage + B1 scene
Agent: Claude Code
Status: handoff

## Summary

Implemented phase P3 of the onboarding proposal (`docs/milestones/v2/ONBOARDING_SPEC.md`, aligned to the coordinator's v3 revision of the B1 table): the reusable `DemoStage` engine, the `DemoScene` protocol, the ghost finger, callout and `EXAMPLE` chip, the B1 "Discover & Join" scene built from the shipping event components, fictional fixtures with Crew avatars rendered through `ImageRenderer`, and a Preview-app host (`--onboarding-demo=discover`) with Debug-only `freezeAt` / `timeScale` / `reduceMotion` overrides. It also extracts `EventBarAction` from `DIPPrototypeApp.bottomAction` with no behaviour change, and adds an additive `tabs:` parameter to `DIPFloatingNavigation` so demo mini bars show three tabs. Branch `feature/onboarding-p3-demo` is stacked on the open P0 PR (#49). Onboarding is still the uncommitted V2 item O pending team approval; nothing here is shown in the DIP app yet (the tour shell is P2). No contract, rules or backend change.

## Changes

- `ui/DIP/Features/Onboarding/Stage/DemoScene.swift`: `DemoScene` protocol (`id`, `script`, `applyContinuous`, `description`, `hostFace`, `stageFill`, `reducedStills`, `accessibilityRows`, `prepare()`, `canvas(_:)`; `finalState` derived), `DemoAccessibilityRow`, `DemoCanvas` constants, `DemoPoint`, `AnimationSpec.swiftUI(speed:)`.
- `.../Stage/DemoStage.swift`: `DemoStage<Scene>`, `DemoStageConfiguration`, `DemoPlaybackPhase`, `DemoStageLayout`, `DemoExampleChip`.
- `.../Stage/GhostTouch.swift` (`GhostTouch`, `GhostState`, `GhostMotion`), `.../Stage/DemoCallout.swift`.
- `.../Fixtures/OnboardingDemoFixtures.swift`: `CrewMember`, `CrewAvatarImages` (PNG @3x via `ImageRenderer`, cached, failures not cached), `DemoEvent`, `OnboardingDemoFixtures` (five fictional events, Maya/Theo/Jun/Priya, demo `DIPEventDetail`).
- `.../Scenes/DiscoverJoinScene.swift`: `DiscoverJoinScene`, `DiscoverJoinTimeline` (beats with `moves`/`targets`, continuous parameters), `DiscoverJoinState`, `DiscoverJoinCanvas`.
- `ui/DIP/Features/EventDetails/EventBarAction.swift` (NEW): `EventBarAction.Route`, `resolve(route:snapshot:isLoading:now:)`, `forEvent(_:isLoading:now:)`. `ui/DIP/Features/Prototype/DIPPrototypeApp.swift` now uses it (`Route` is a typealias of `EventBarAction.Route`).
- `ui/Packages/DIPDesignSystem/.../DIPHomeComponents.swift`: `DIPFloatingNavigation(tabs:)`, default `DIPHomeTab.allCases` (identical layout and drag behaviour by default).
- `ui/Packages/DIPCore/Sources/DIPCore/Onboarding/AnimationCurve.swift` (NEW): `AnimationSpec.progress(at:)` / `progress(seconds:)` (closed-form springs, SwiftUI Bézier timing curves) for continuous parameters; tests in `AnimationCurveTests.swift`. P0's files are unchanged.
- `ui/ComponentPreview/App/OnboardingDemoPreview.swift` (NEW) and `PreviewApp.swift`: `--onboarding-demo=<scene>` host and override parsing.
- Tests: `ui/DIPTests/Events/EventBarActionTests.swift`, `ui/DIPTests/Onboarding/DiscoverJoinSceneTests.swift`, `ui/ComponentPreview/UITests/OnboardingDemoTests.swift`.
- `ui/ComponentPreview/Review/Onboarding/`: README, Figma reference PNGs and simulator captures.

## Validation

See the PR description for the final list; filled in as checks complete.

## Decisions

See the PR description; summarized at the end of the session.

## Handoff

See the end of this log.
