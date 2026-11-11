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

## Owner revisions (later in the session)

- Demo panes now run on the app's real screens in a device frame:
  - B2 pushes the real `DIPParticipantsScreen` (the `.participants` route); its bar comes from `EventBarAction.resolve`.
  - B3 pushes the real `DIPChallengeDetailsScreen`. The entry form and balance stay marked F3/F2 placeholders.
  - B4 uses the real `DIPMyEventsScreen`, `DIPEventDetailsScreen` and `DIPAlbumScreen`, fed by `DIPMockFixtures.reference`.
  - Real screens are laid out at 390 × 844, and the canvas shows their lower 540 pt (`DemoPhoneScreen`). Beat tables, timings and validators are unchanged; the timeline motion still drives the transitions (pushes with the beat springs, crossfades).
- Device frame (`DemoDeviceFrame`): ink bezel. The canvas fills the Stage height and bleeds off its top and bottom, so there is no dead space below the phone. The `EXAMPLE` chip is removed. Replay sits top-right of the visible screen. The spec §3.0 table is updated.
- Host face: no perch on the Stage, since the frame owns the top edge. The step's host now sits in the header after the Crew stack, with an `actionPrimary` ring, and joins the stack when the step ends.
- Demo mini bars use the real `DIPFloatingNavigation` default tab list: four tabs including the Rewards gift. Spec §7.1 is updated.
- Header leading control:
  - Back on later steps.
  - On the first step of a first run, a 44 pt icon "Sign out" circle styled like Back (`onboarding.signOut`). It uses the existing session sign-out, which has no confirmation, the same as Profile.
  - Nothing in replay; the content starts flush left with no reserved gap.
- Bar progress: the shimmer band (`DIPProgressBand`) is replaced by `DIPProgressPulse`, three ink dots breathing in the trailing white circle, with a gentle label breath (`DIPProgressBreath`). Under Reduce Motion the dots rest with no loop. Identifiers and values are unchanged. Spec §3 A2 is updated.
- Process:
  - Simulators: this session first created "Claude-DIP" (UDID B1885C1A-2AC8-42B7-A821-21A3406E8887), which is now the shared agents' simulator, and then its own **"Claude-DIP (Onboarding)"** (UDID 44A8367D-1717-4E92-9A3E-8A969CD59F96), which later onboarding runs use. Both are kept and shut down, not deleted.
  - The owner's "iPhone 17 Pro" is no longer used.
  - Large-text, Dynamic Type and accessibility tests and captures are excluded from all runs, by owner instruction.
- Device-frame bug found in captures and fixed: the bezel shape is taller than the Stage (it runs off the top), so the Stage's ZStack centred itself around it and left a ~205 pt dead band under the phone. The frame's layout is now pinned to the Stage. `DemoStageLayoutTests` asserts equal side gaps (within 2 pt) and that the screen ends on the Stage's bottom edge (no band) at three Stage sizes.
- Bar progress (owner, supersedes the pulse):
  - The resolving label is "Finding your company", without dots.
  - `DIPProgressIndicator` draws in the trailing 64 pt circle, the same slot as the action icon, so the label does not jump.
  - Three candidates:
    - `wheel` (shipped): a wheel of the app-assigned avatars; the front face is centred and large, and every 0.55 s it turns with `DIPMotion.marker`.
    - `orbit`: a face with an `actionPrimary` arc spinning around it.
    - `hop`: three small faces hopping in turn with `DIPMotion.affordance`.
  - Compare them in the Preview app with `--progress-style=wheel|orbit|hop` (for example `--onboarding=slow --progress-style=orbit`).
  - Reduce Motion shows one still face with no loop.
  - Choice: `wheel`. It answers the owner's idea, is the most on-brand (faces), and is calmer than `hop`; `orbit` reads as a generic spinner.
- Haptics: `DIPHaptics` in DIPDesignSystem.
  - Semantics:
    - `navigate`: none. Tab switches, opening chat, View Album, back and step CTAs are silent.
    - `select`: selection tick for interest rows.
    - `commit`: light impact at 0.7 for Join the Activity, Save and start, Try again, Continue with Google, a notice's primary action, and the tour's Sign out.
    - `success`: membership resolved after the member watched "Finding your company", and interests saved.
    - `failure`: warning, for a blocked notice and a failed interest save.
  - Tuning: one table (`DIPHapticTuning.table`), an 80 ms throttle per event, and the `dip.haptics.enabled` switch (default on). Reduce Motion does not mute haptics.
  - `DIPBottomBarAction.kind` (`.navigate` / `.commit`) decides the bar press. `EventBarAction` marks Join as commit and chat as navigate; `EventBarActionTests` is updated on purpose.
  - Demo beats fire no haptics (spec §3.0).
  - Call sites left to other areas, not edited here:
    - Events: RSVP join/leave stored → `DIPHaptics.success()`; RSVP failure alert → `failure()`; the Leave Activity row button → `commit()`.
    - Profile: profile save → `commit()` on press, then `success()` / `failure()`; Sign out → `commit()`.
    - Rewards: redeem → `commit()` then `success()` / `failure()`.
    - Chat: send → `commit()`.
    - Album: photo upload finished → `success()`.
