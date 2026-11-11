# Onboarding demo stage: B1 Discover & Join (proposal)

Onboarding is the uncommitted V2 item O and awaits team approval; see [the spec](../../../../docs/milestones/v2/ONBOARDING_SPEC.md). These captures show phase P3 only: the `DemoStage` engine and the B1 scene. The tour shell (header, host perch, entrances, the real Bar behaviour) is phase P2 and is not built. The Preview host draws a static pill, Stage card, host face, copy and Bar at the tour geometry so captures line up with the Figma frames; those pieces are not the shell.

Launch: `--onboarding-demo=discover` on the Preview app, with the Debug-only overrides `-onboarding.freezeAt discover@<seconds|final>`, `-onboarding.timeScale <n>` and `-onboarding.reduceMotion`. Captures are iPhone 17 Pro (402 × 874 pt) simulator screenshots.

| File | Capture | Figma reference (draft file `nAcWMM3OBnEtrGQj5vCEtk`, page "Onboarding flow") |
| --- | --- | --- |
| `discover-beat1-0.30.png` | `discover@0.3`: canvas developing from Stage purple | `figma-beat1-feed.png` (13:494, drawn at rest, not mid-reveal) |
| `discover-beat4-3.80.png` | `discover@3.8`: event page, "Join the Activity" (the ghost is just starting its fade-in) | `figma-beat4-event-page.png` (13:873) |
| `discover-beat6-final.png` | `discover@final`: joined, "Activity Chat", callout, Replay | `figma-beat6-joined.png` (13:1019) |
| `discover-reduced-1-feed.png`, `-2-event.png`, `-3-joined.png` | Reduce Motion stills at 1.10, 3.79 and 6.40 with the three-dot indicator | `figma-reduce-motion.png` (13:1175) |

## Differences from the Figma frames (the build wins, spec §6)

- The draft frames draw the canvas at scale 0.75 in a 437 pt Stage with the `EXAMPLE` chip top-right. The build follows spec §3.0: Stage 362 × 429 at y 134, canvas scale 0.691 with a 40 pt top gutter, chip top-left (the host face perches top-right).
- The frames draw grey placeholder action pills and no capacity header. The build uses the real `DIPDetailPeopleRow` ("5 of 12" / "6 of 12", four 40 pt avatars, "+ 2 More") and `DIPDetailActionRow` (purple Directions / pink Share Event, then ink Leave Activity).
- The frames show a "Thu · 6:30 PM · Office kitchen" line under the title; the spec's event page has none, so the build omits it.
- The join ring is `actionPrimary`, not white: a white ring on the white canvas is invisible outside the avatar.
- The callout hangs under Leave Activity with its tail on the action row (v3: it targets `actionRow`), rather than centred.
- The Reduce Motion dots sit in the Stage's bottom gutter, not below the Stage (the dots belong to `DemoStage`, which does not draw outside the Stage).

Captures come from `OnboardingDemoTests.testFreezeAtCaptures` (iPhone 17 Pro, iOS 27 simulator, November 10, 2026).

## Tour shell and scenes B2–B5 (P2)

Captures from `OnboardingTourTests.testStepCaptures` (`--onboarding-tour`, iPhone 17 Pro, iOS 27 simulator, November 10, 2026), scaled to 402 × 874, beside Figma draft frames from `nAcWMM3OBnEtrGQj5vCEtk`:

| Capture | Launch | Figma reference |
|---|---|---|
| `tour-B0-arrival.png` | fresh first run | `figma-B0-arrival.png` (25:1237) |
| `tour-B1-discover.png` | `resumeAt discover`, `freezeAt discover@final` | B1 frames above |
| `tour-B2-people.png` | `resumeAt people`, `freezeAt people@2.1` (shipping flags: no invites) | `figma-B2-participants.png` (34:1419) |
| `tour-B3-challenges.png` | `resumeAt challenges`, `features all`, `freezeAt challenges@3.2` | `figma-B3-requirements.png` (31:1785) |
| `tour-B4-memories.png` | `resumeAt memories`, `freezeAt memories@5.7` | `figma-B4-my-events.png` (35:1967) |
| `tour-B5-interests.png` | `resumeAt interests` | `figma-B5-picking.png` (37:2565) |

Reviewed by eye: header (back, pill, Crew stack with "+n", Skip), Stage geometry, perch, `EXAMPLE` chip, title/body positions and Bar match. Known differences: B2 is captured without F4, so there is no "Invite a coworker" chip and the Bar reads "And after the event?" (B3 is not in the shipping run); B3's details band and entry form are marked placeholders ("PREVIEW · …") rather than the frame's sketch; B5 shows only the chip strip (no F1 interest cards); the frames show a status-bar home indicator that the simulator capture omits.
