# Work session

User: sandervonk
Date: 2026-11-10
Workstream: Onboarding P1 sign-in stage
Agent: Claude Code
Status: handoff

## Summary

Onboarding phase P1 (spec v3 A0–A4, a proposal pending team approval under V2 item O): every non-member sign-in state now renders through one long-lived `AccountsStageView` instead of separate progress, welcome and notice screens. The Stage card, the four-face Crew and the shared bottom Bar stay mounted and change per route: Stage fill per tone, Crew formation, copy entrance, Bar action/progress and the secondary text action. The faces gained an animatable rig (smile, eyeOpen, gaze). No contract, rules or backend change. The post-sign-in tour (P2+) is not started.

## Changes

- `ui/DIP/Features/Accounts/AccountsOnboarding.swift`: `AccountsRoute.progress(String)` split into `.pending` and `.resolving`; two refined notice messages (personal email, company not found).
- `ui/DIP/Features/Accounts/AccountsStage.swift` (new, pure): `PendingLook` (cold / retry / signingOut), `StageTone` with the v3 colours (welcome pink, blocked and problem purple, not found yellow, offline gray), `CrewFormation` presets, `StageCopy` (rise / drop entrances), `StagePill` reel, `StageIntent`, `AccountsStageScene.make(route:isSubmitting:pendingLook:)`.
- `ui/DIP/Features/Accounts/AccountsStageView.swift` (new): renders the scene. Fill/formation springs, crew grow-in from the Stage colour, activity-pill reel (2.4 s, 3 cycles, hop + wink), gaze loop while searching, per-tone arrival beats (blocked mood, not-found glance, offline dashed-link break, problem wobble), copy clipped at the Stage edge, secondary text action 12 pt above the Bar, Reduce Motion crossfades, Low Power Mode (static pill, no loops), scenePhase gating, haptics (`.impact(.light)` on sign-in, `.warning` once per blocked arrival), VoiceOver (Stage hidden, "Finding your company" announcement, focus to the notice title + screenChanged), accessibility sizes without the Stage.
- `ui/DIP/Features/Accounts/AccountsRootView.swift`: member content or the one Stage view. `WelcomeView.swift` and `AccountsNoticeView.swift` deleted (`AccountsProgressView` lived in the latter).
- `ui/DIP/Features/Shared/Characters/OnboardingFaces.swift` (moved from Accounts): `FaceRig`, animatable `FaceFeatures` (nested `AnimatablePair`), continuous wink stroke, `Mood` → rig presets so existing callers are unchanged, `CrewMember`, `StageColor`.
- `ui/DIP/Features/Shared/Motion/OnboardingMotion.swift` (new): stage / expand / hop / reveal springs plus the one-offs (drop, pill, crew entrance) with SwiftUI `settlingDuration`, copyOut, wink timing.
- Design system (additive): `DIPBottomBarAction.showsProgress` (sweeping 80 pt white 25% band; static spinner in the icon circle with Reduce Motion) and `DIPFloatingNavigation.barCenterInset` / `horizontalInset` / `height` / `standardInsets`. Existing behaviour and tests unchanged; two package tests added.
- Tests: `ui/DIPTests/Accounts/AccountsStageTests.swift` (new), `AccountsOnboardingTests.swift` updated; `ui/ComponentPreview/UITests/OnboardingFlowTests.swift` adds Welcome layout, Resolving progress, every notice variant, offline retry/sign-out and large-text notice tests.
- `ui/ComponentPreview/App/OnboardingPreview.swift`: test-only accounts `conflict`, `offline`, `limited`, `problem`, `slow` via a resolve-failing wrapper around `PreviewAccountsRepository`.
- `docs/milestones/v1/FRONTEND_STATUS.md`: V1-01 row points at `AccountsStageView` instead of the deleted views.
- Review captures under `ui/ComponentPreview/Review/Onboarding/`.

## Validation

- `npm run ios:generate`: both projects generated.
- `xcodebuild build -project ui/DIP.xcodeproj -scheme DIP -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO`: BUILD SUCCEEDED (after merging origin/main #48).
- `npm run test:swift`: exit 0 (DIPContracts 1, DIPDesignSystem 11, DIPAccounts 24, DIPCore 40 XCTest + 5 Swift Testing).
- `xcodebuild test ... -only-testing:DIPTests/AccountsStageTests -only-testing:DIPTests/AccountsOnboardingTests` on an iPhone 17 Pro (iOS 27.0) simulator: 34 tests, 0 failures.
- Onboarding UI tests (`xcodebuild test` of the Preview scheme, `-only-testing:PreviewUITests/OnboardingFlowTests`, iPhone 17 Pro iOS 27.0 simulator, under the shared `/tmp/dip-sim-lock`): 11 tests, all passed, including the 5 existing flows unchanged. An earlier run on the v2 code failed `testOfflineRetryRestartsAndSignOutReturnsToWelcome` because the 300 ms preview delay hid the A0 retry look; the offline preview account now holds resolution 1.5 s. Two later runs were killed by disk-full and simulator-service outages, not by test failures.
- Captures (402 × 874 pt, @3x): `ui/ComponentPreview/Review/Onboarding/` a1-welcome (taken during the reel, pill on "Pasta night"), a2-resolving, notice-personal / conflict / unmapped / offline / limited / problem / unconfigured, notice-large-text. Compared by eye with Figma draft nAcWMM3OBnEtrGQj5vCEtk frames 6:55, 13:1660, 13:1885, 13:2003, 13:2087, 13:2177: geometry, faces, title/body/footnote positions and the Bar rectangle match; Stage colours follow spec v3 where the Figma draft (v1 colours) differs (not found yellow, offline gray). Line breaks of some notice titles differ because iOS avoids a one-word last line.
- Not run: `npm run check`, `npm run test:rules` (no backend, contract or rules change); VoiceOver, Low Power Mode and physical-device passes; Instruments hitch measurements; GIF/screen recording.

## Decisions

- Spec v3 supersedes v2 for this work (coordinator message mid-session); settle times use SwiftUI `settlingDuration`.
- Mouth curve: positive smile scales 0.16 h, negative smile 0.2 h, so the worried preset (−0.6) draws exactly today's −0.12 h curve instead of a softer −0.072 h.
- The square face rests eyes-open in the Welcome group so its wink plays as the v3 close → hold → open beat; the Figma Welcome frame (v1) still shows it winking at rest.
- A0 after a Google sign-in uses the retry (search) look, because the session passes through `authenticationPending` before `resolvingCompany`; only cold launch shows the empty Stage.
- The view is `AccountsStageView(session:)` (not `(route:previous:)`); the previous-route context is the view's own `PendingLook` state.
- `DIPPrototypeApp` and other shell consumers are not switched to the new bar constants (other owners' files).
- `onboarding.stage` is set but the Stage is accessibility-hidden in A-states, so UI tests cannot query it.

## Handoff

- Team approval of onboarding item O is still required before merge.
- Tour shell (P2) should reuse: `DIPFloatingNavigation(action:showsTabs:false…)` placed with `standardInsets`; `DIPBottomBarAction(showsProgress:)`; `OnboardingFace(fill:figure:rig:size:)` with `FaceRig` presets; `CrewMember` / `StageColor`; `OnboardingMotion` springs and settle times.
- Pending: manual VoiceOver / Low Power / iPhone SE–12 passes, motion GIFs, redrawn Figma frames for not found (yellow) and offline (gray) per v3.
