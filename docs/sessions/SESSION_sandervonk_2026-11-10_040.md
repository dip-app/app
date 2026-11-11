# Work session

User: sandervonk
Date: 2026-11-10
Workstream: Onboarding P2 tour + scenes
Agent: Claude Code
Status: handoff

## Summary

Onboarding phase P2 (tour shell) and scenes B2–B5 on top of the merged P0/P1/P3/P4 work (spec v4, `docs/milestones/v2/ONBOARDING_SPEC.md`; onboarding remains the uncommitted V2 item O). After membership resolves, a first-time uid sees the tour as an overlay in `DIPMemberHome`: B0 Arrival, B1–B4 demos on the shared `DemoStage`, B5 Interests with the embedded picker saving through the existing profile path, then a `WindowSheet` window reveal into whatever Home surface is underneath. Skip, back, resume (per-uid `dip.onboarding.v1.<uid>` record) and a Profile "How DIP works" replay are wired. No contract, rules or backend change; nothing deployed.

## Changes

- DIPCore (pure, `swift test`): `Onboarding/OnboardingTour.swift` (entrance choice fresh/resume/replay, Crew stack 3 faces + "+n", header overflow rule, home surfaces → bar treatment/focus/wait, handoff timing, Stage fills), `Onboarding/DemoGhost.swift` (ghost visits, progress helpers), `Onboarding/Scenes/PeopleInviteTimeline.swift`, `ChallengeTimeline.swift`, `MemoriesTimeline.swift` (B2–B4 tables, one beat per row with `moves`/`targets`, flag variants, stills, continuous parameters). Tests `OnboardingTourTests.swift`, `OnboardingSceneTimelineTests.swift`.
- App `ui/DIP/Features/Onboarding/Tour/`: `OnboardingTourModel` (flow + record store + announcements + handoff wait/reveal), `OnboardingTourView` (header with back/pill/stack/Skip, Stage card morphing per step, perch host faces with matched-geometry flights into the stack, per-step title entrances, B5 picker + "Skip for now", Bar, window reveal with You flying to the profile button, Reduce Motion crossfades, accessibility-size scrolling layout with SF Symbol rows), `TourParts`, `WindowSheet`, `OnboardingCopy`, `OnboardingTourSettings` (UserDefaults store + Debug launch arguments `-onboarding.reset|timeScale|reduceMotion|resumeAt|freezeAt|features`).
- App scenes: `Scenes/PeopleInviteScene.swift`, `ChallengeScene.swift`, `MemoriesScene.swift`, `DemoSceneSupport.swift` (F2/F3/F4 stand-ins marked "PREVIEW").
- Integration: `DIPMemberHome` (tour overlay, `onboarding:` settings parameter, surface reporting, replay full-screen cover, shell transparent until the reveal), `DIPPrototypeApp` (`onSurfaceChange`, `onReplayTour`), `DIPProfileScreen` ("How DIP works" row, `profile.howDIPWorks`), `DIPParticipantsScreen` (`DIPParticipantRow` extracted, no visual change), `DIPApp` (passes `.standard()` settings).
- Preview app: `--onboarding-tour` (member host), `--onboarding=member|member-save-fails`, demo preview hosts `people`, `challenges`, `memories`.
- Tests: `ui/DIPTests/Onboarding/OnboardingTourTests.swift` (SwiftUI `settlingDuration` gate for B1–B4 incl. flag variants, engine-estimate bounds, render checks, WindowSheet halfway interpolation, tour model persistence/resume/replay/handoff wait, settings parsing, copy), `ui/ComponentPreview/UITests/OnboardingTourTests.swift` (first run to Home, skip at B2, resume, interest save failure + retry, replay from Profile, Reduce Motion, step captures).
- Review captures `ui/ComponentPreview/Review/Onboarding/tour-B0…B5*.png` with Figma references `figma-B0…B5*.png`; README section added.
- `docs/milestones/v2/FRONTEND_PLAN.md` status board.

## Validation

- `swift test` (DIPCore): 128 XCTest, 0 failures; `npm run test:swift`: exit 0.
- `npm ci` + `npm run check`: exit 0 (Node v26.7.0, not the pinned 24.12).
- `xcodegen generate` for both projects; DIP and Preview `build-for-testing` (generic iOS Simulator): succeeded.
- DIPTests (`xcodebuild test`, scheme DIP, iPhone 17 Pro iOS 27 simulator): 158 tests, 0 failures, 2 pre-existing skips.
- Final Preview UI run (`-only-testing` OnboardingTourTests, OnboardingFlowTests/testWelcomeSignsInToHome, MemberEventsFlowTests; iPhone 17 Pro iOS 27, under `/tmp/dip-sim-lock`): 9 tests, all passed (** TEST SUCCEEDED **).
- Final DIPTests run after merging origin/main (#61): 158 tests, 0 failures, 2 pre-existing skips.
- Simulator shut down, lock released, DerivedData and xcresults deleted.
- Regression UI run (OnboardingFlowTests 11, MemberEventsFlowTests 1, ProfileInterestTests 3, OnboardingInterestsTests 5, OnboardingDemoTests 4): all pass except three failures in files this branch does not touch, left to the iOS fixer: `OnboardingDemoTests.testReduceMotionShowsStillsThenRests` and `testStageIsOneElementThatAutoplaysRestsAndReplays` (already documented as failing in the P3 log) and `OnboardingInterestsTests.testSearchAndSkipWriteNothing` (search still shows `tag-food`).
- Not run: `npm run test:rules` (no rules change), VoiceOver / Low Power Mode / iPhone SE–12 manual passes, Instruments, GIFs.

## Decisions

- B2–B4 timelines live in DIPCore; canvases in the app.
- `OnboardingFeatures.shipping = []`: B3 is dropped and B2 has no invite beats until F3/F4 ship (spec "drops out cleanly"); `-onboarding.features all` shows everything in Debug. B2's CTA reads "And after the event?" when B3 is absent.
- Tour shown only where a host passes `OnboardingTourSettings` (the app does; older previews/tests don't), so existing UI tests are unaffected.
- Home is hosted in UIKit, so the shell under the tour is opacity 0 (plus `accessibilityHidden`) until the reveal starts.
- B0 Crew follows the Figma frame (four faces at the corners, You centred) rather than a row.
- Owner decision (mid-session): accessibility and Dynamic Type work and tests are deferred. The accessibility audit and large-text UI tests were removed; the accessibility-size layout, VoiceOver labels and announcements that were already written stay in the code but are not verified. Reduce Motion keeps its existing compositions and one UI test.
- Known gap (deferred with accessibility): the audit run before that decision found Home's "This Week's Events" text still exposed to accessibility under the tour. `accessibilityHidden` on the shell, opacity 0 and a UIKit `isHidden` on `DIPSlidingPages` did not remove it; the `DIPSlidingPages` attempt was reverted. The shell stays transparent and non-hit-testable until the reveal.

## Handoff

- When F2/F3/F4/F5/F1 land, add their flags to `OnboardingFeatures.shipping` and replace the "PREVIEW" stand-ins.
- Not implemented from the spec: B4 → B5 strip with F1 cards, the standard step-change keyframed host flight (matched geometry is used instead), demo pre-decoding budget checks, GIFs, Low Power Mode composition for the tour chrome, `-home.surface` override.
