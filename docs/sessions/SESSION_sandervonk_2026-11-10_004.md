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

- `swift test` for the four packages (`npm run test:swift` set): DIPContracts passed; DIPDesignSystem 9 XCTest passed; DIPAccounts 24 Swift Testing passed; DIPCore 84 XCTest (81 existing + 3 new `AnimationCurveTests`) and 5 Swift Testing passed, 0 failures.
- `npm ci` + `npm run check`: exit 0 (functions unit tests 87 pass / 6 todo, docs, contracts, sessions). Ran on Node v26.7.0, not the pinned 24.12.
- `npm run ios:generate` and `xcodegen generate` for ComponentPreview: OK.
- Builds: Preview scheme (`build` and `build-for-testing`) and DIP scheme (`build-for-testing`, app + DIPTests) for the iPhone 17 Pro simulator: succeeded, no new warnings in the changed files.
- DIP unit tests (`xcodebuild test-without-building`, scheme DIP, iPhone 17 Pro iOS 27 simulator): 74 executed, 0 failures, 2 pre-existing skips. Includes the new `EventBarActionTests` (3, a regression table comparing `resolve` with a verbatim copy of the old switch over every route, snapshot and loading combination) and `DiscoverJoinSceneTests` (11: `validate() == []`, SwiftUI `Spring.settlingDuration` beat timing with no tolerance, state at beats incl. attendees 5 → 6 at 4.30 s, continuous parameters, final state, stills, playback fold, resolver, ImageRenderer render checks of the final state and each still, Crew PNG @3x).
- Preview UI tests (same simulator, one run under `/tmp/dip-sim-lock`): `ScreenFlowTests.testJoinAttendeesAndChatKeepLocalState` passed, `MemberEventsFlowTests.testCompanyFeedOpensExistingDetailAndUnavailableRSVPDoesNotJoin` passed (so the `EventBarAction` extraction changed nothing visible there), `OnboardingDemoTests.testHorizontalDragScrubsAndResumes` passed, `OnboardingDemoTests.testFreezeAtCaptures` passed.
- **Failing, not fixed:** `OnboardingDemoTests.testStageIsOneElementThatAutoplaysRestsAndReplays` failed at the assertion that `event.primary` does not exist in the app: an element inside the canvas (the mini bar's action button) is still exposed to accessibility, so the "exactly one accessibility element" requirement is NOT met yet. `OnboardingDemoTests.testReduceMotionShowsStillsThenRests` saw still 0 → 1 → 2 → resting as designed, but a tap on the Stage afterwards did not replay (phase stayed `resting`), so tap-to-replay is unverified/broken (the scrub drag does work). Likely causes to check: the canvas's `.accessibilityElement(children: .ignore)` sits on the outer view while `DIPFloatingNavigation`'s button keeps its own identifier (try `.accessibilityHidden(true)` on the canvas layer plus a separate element), and the tap gesture may not hit through the canvas with `allowsHitTesting(false)` (try a transparent hit layer above the canvas).
- An earlier attempt at the UI run died with "Mach error -308 (server died)" while the host was overloaded; the coordinator restarted CoreSimulatorService and the run above is the retry.
- Captures: `ui/ComponentPreview/Review/Onboarding/discover-beat1-0.30.png`, `discover-beat4-3.80.png`, `discover-beat6-final.png`, `discover-reduced-{1-feed,2-event,3-joined}.png` (from `testFreezeAtCaptures`), beside the Figma references `figma-*.png`. Reviewed beat 4 and the final frame by eye against frames 13:873 / 13:1019; differences are listed in the folder README. The Reduce Motion and beat 1 captures were saved but not individually reviewed.
- Not run: `npm run test:rules` (no rules change), VoiceOver / Low Power Mode / iPhone SE manual passes, Instruments, GIF recordings, accessibility audits.

## Decisions

- **Spec version.** B1 follows the coordinator's v3 table (browse 1.10–2.60, choose 2.60, press 2.80–3.02, event page 2.90, rows last start 3.02, tap Join 3.80, joined 4.30, callout 4.60, end 6.40) and v3's three-tab mini bar.
- **DemoBeat shape.** P0's `DemoBeat` has one animation and `moves`/`targets` string sets, not v3's per-element `Move { offset, stagger, count }`. Rather than change P0's API, staggered moves are declared as an extra marker beat at the last element's start (develop cards at 0.20, rows at 3.02) and the joined beat's bar icon as a parallel `affordance` beat. `validate()` and the SwiftUI settling test both pass. Moving to v3's `Move` struct is a P0 follow-up.
- **Continuous parameters.** Mask radius, card scales, browse offset, ghost travel/press, card press, row reveal, ring and callout are pure functions of t (new `AnimationSpec.progress(at:)` in DIPCore), so they scrub and freeze exactly. Only the page switch (matched geometry card → hero), the bar action, the joined state and the callout's presence are discrete beats applied with `withAnimation`.
- **One TimelineView while playing.** The stage runs a single `TimelineView(.animation)` for the whole playback instead of one per beat; it is paused at rest, during stills, scrubbing and freeze, so idle redraws nothing.
- **Ghost.** Fades out after the Pasta Night press (3.02–3.17) and reappears at 3.80 to travel to the bar, so the event-page still has no ghost.
- **Join ring** uses `actionPrimary` (a white ring is invisible on the white canvas), at the computed fourth-slot centre (170, 316), not the spec's (170, 300).
- **Callout** hangs under Leave Activity with its tail pointing at the action row (v3: targets `actionRow`).
- **EXAMPLE chip** top-left per spec §3.0 (the draft Figma frames put it top-right).
- **Crew PNGs** are rendered in `DemoScene.prepare()` before the canvas first draws; an `ImageRenderer` call during a view update returned nil and was cached as a blank, so failures are no longer cached.
- **`DIPFloatingNavigation(tabs:)`** added minimally (default `allCases`, identical layout); it will conflict trivially with main's gift-icon change and with P1 if P1 also touches that file.
- **Session log number** `_004`: `_001` and `_002` already exist on main for this date and `_003` is P0's.

## Handoff

- Fix the two failing onboarding UI tests (canvas accessibility leak of `event.primary`; tap-to-replay) before relying on the stage in the tour.
- P2 (tour shell) should use: `DemoStage(scene:configuration:onPhaseChange:)` filling the Stage card (it draws the canvas, `EXAMPLE` chip, Replay and Reduce Motion dots), `scene.hostFace`, `scene.stageFill`, `scene.accessibilityRows` for accessibility sizes, `scene.description`, and `DemoStageConfiguration` for the `-onboarding.*` overrides.
- B2–B5 scenes: conform to `DemoScene`; keep geometry that must scrub in `applyContinuous` (pass the same function as the script's `continuous:`); declare `moves`/`targets` on every beat; add a scene test with `validate() == []` and the settling-duration check; render Crew avatars through `CrewAvatarImages` in `prepare()`.
- Not done: GIFs (`Review/Motion/onboarding-*.gif`), VoiceOver / Low Power Mode / small-device manual checks, accessibility audits, `-onboarding.reset` / `resumeAt` (tour-level).
- The PR is stacked on #49 and must not be merged until the team approves item O. A merge captain takes over the PR from here.
