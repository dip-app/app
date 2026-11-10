# Onboarding (v4)

> **Status.** This is a design spec. Nothing in it is built yet.
>
> Onboarding is the uncommitted **O** item in `docs/milestones/v2/FRONTEND_PLAN.md`, so the team must approve it before work starts. It needs no change to contracts, rules or the backend.
>
> Every claim about existing code was checked against the repository on 2026-11-10. Anything the spec relies on that doesn't exist yet is marked **NEW**, and §5 says who owns it.

## 1. Principles and the through-line

### The through-line: one Bar, one Stage, one Crew

The whole sequence is one composition. Three elements stay on screen from first launch to Home and change shape instead of being replaced.

#### 1. The Bar

The Bar is the real `DIPFloatingNavigation`: an 80 pt ink capsule with a 20 pt side inset.

- **Position.** `DIPPrototypeApp` places it at `.position(x: width / 2, y: height − 61)` with the safe area ignored. Its bottom edge sits 21 pt above the screen edge, so on an 874 pt screen it occupies **y 773–853**.
- **Welcome matches.** `WelcomeView`'s footer also ends with 21 pt bottom padding under `.ignoresSafeArea(.container)`, so its bar lands on the same rectangle.
- **The Bar never moves. What it carries changes:**
  1. the sign-in button ("Continue with Google")
  2. a progress capsule while the company resolves ("Finding your company…")
  3. each blocked state's primary action
  4. the tour's CTA
  5. at the end, its action overlay dissolves (`action = nil`). That reveals the tabs with the white marker on Home: the onboarding bar *becomes* the app's bar, as `docs/design/motion.md` requires ("one persistent bottom component").

#### 2. The Stage

The Stage is one rounded card (radius `card` 20, width = screen − 40). It holds every illustration and demo, and its fill moves through token colours, one per step (§4.3).

- **On Welcome**, it is today's pink `OnboardingFaceCard`.
- **In the tour**, it frames a small, live version of DIP built from real components.
- **At handoff**, it becomes a window that grows until it *is* the real Home.

#### 3. The Crew

The Crew is the four existing `OnboardingFace` characters (purple round, white pill, yellow square, gray round), plus **You** (your initials or OAuth portrait in a `DIPAvatar`).

- **On Welcome**, they greet you.
- **While the company resolves**, they look for it.
- **In the demos**, they are the coworkers who attend, invite and share photos.
- **One Crew member hosts each tour step.** It perches on the Stage's top edge and joins your stack when the step ends. The stack fills the same way "Who's Attending" fills.

### Principles

1. **Never a page change.** Each step morphs the Stage and Bar that are already on screen. If a frame would be easier to build as a push or a slide, redesign it.
2. **Every step enters differently.**
   - No step reuses another step's entrance.
   - Titles are revealed, gathered, stamped or developed by the moving Stage (§3.0).
   - Demo content grows out of the Stage colour or out of a shared element. It never slides in from an offset.
3. **Show the real app, smaller.**
   - Demos are built from shipping components on a fixed 390 × 540 pt white canvas, scaled down. The components are `DIPPhotoEventCard`, `DIPDetailHero`, `DIPDetailPeopleRow`, `DIPDetailActionRow`, a participant row extracted from `DIPParticipantsScreen`, `DIPChallengeCard` and `DIPFloatingNavigation`.
   - Where shipping UI is missing (invitations, points, challenge entry), the demo uses a marked placeholder, replaced when the feature lands.
4. **Coworkers first, fitness last.**
   - Demos open on social activities: board games, pasta night, a hike.
   - The one fitness cover is fifth in the feed.
   - The copy says "coworkers", "team" and "together". It never says "workout".
5. **Teach the confusing parts by name.**
   - one Join action, and the bar changing once you've joined
   - a "My Events" label over the squares icon
   - "Past events" spelled out
   - challenge requirements, how to submit, the deadline and the reward, shown before the submit action
6. **Honest demos.**
   - Every Stage carries an `EXAMPLE` chip.
   - Names, events and photos are fictional and bundled.
   - The joined bar is drawn exactly as shipped ("Activity Chat"), and the copy never promises chat.
   - Each feature step drops out cleanly if its feature slips.
7. **Quiet by default, with a still for every motion.**
   - A demo plays once, rests on its final frame, and replays on tap.
   - Only the loops listed in §5 ever run.
   - Haptics fire only on the user's own taps.
   - Reduce Motion, VoiceOver, accessibility text sizes and Low Power Mode each get a designed composition.

## 2. Flow map

### Placement decision

**Before sign-in, show Welcome only.** It is one living screen that sells meeting coworkers and offers one action.

**After the account resolves to a member, run the tour.** Reasons:

- Before membership there is no tenant context, no name and no profile write.
- People on a personal, blocked or not-yet-onboarded domain would sit through a tour they can't use.
- Saving interests needs `MemberProfileBridge.save` through `ProfileEditor`, which exists only inside `DIPMemberHome`.
- The tour can greet the person by first name and hand off into their real Home.

Correcting the "fitness app" misreading before sign-in is the Welcome hero's job.

### Flow

```
launch ─▶ A0 Pending (authenticationPending)   bar: "Just a moment…"
             │ signedOut                │ member, tour complete      │ member, tour incomplete
             ▼                          ▼                            ▼
          A1 Welcome               H reveal                B0 (fresh) or B[n] resume entrance
             │ tap bar
             ▼
          Google sheet ──cancel──▶ A1
             │ success
             ▼
          A2 Resolving (resolvingCompany)   bar = progress
             │                  │                  │
       noCompany(reason)   recoverableError      member ─▶ isComplete(uid)? ─▶ H or B0
             ▼                  ▼
          A3 No company      A4 Problem
          Try again =        Try again = restart
          retryMembership    ▶ A0 retry look ▶ A2 / member / notice
          ▶ A2 directly
                                              B0 Arrival
                                              B1 Discover & Join    (always)
                                              B2 People & Invites   (participants always; invite beats need F4)
                                              B3 Challenges         (needs F3; points beat needs F2)
                                              B4 Memories           (always; upload beat needs F5 or the mock album)
                                              B5 Interests          (always; live reshape needs F1)
                                              H Handoff (4 surface cases, §3 H) ─▶ Home ─▶ sign out ─▶ A1
```

### Routes

| Route | Session state | Bar | Secondary | Back | Skip |
|---|---|---|---|---|---|
| A0 Pending | `authenticationPending` | "Just a moment…" + progress | — | — | — |
| A1 Welcome | `signedOut` | "Continue with Google" | — | — | — |
| A2 Resolving | `resolvingCompany` | "Finding your company…" + progress | — | — | — |
| A3 No company | `noCompany(_, reason)` | the notice's primary action | the notice's secondary, as a text button | — | — |
| A4 Problem | `recoverableError` | "Try again" | "Sign out" where the notice has one | — | — |
| B0–B5 | `member`, tour not complete | the step's CTA | B5 only: "Skip for now" | B1–B5 | B0–B4 |
| H | B5 CTA, Skip, or a returning member | dissolves to tabs, or fades out (§3 H) | — | — | — |

**Route split (NEW work).** Today `AccountsRoute.progress(String)` merges `authenticationPending` and `resolvingCompany`.
- Replace it with two cases, `.pending` and `.resolving`.
- Move the copy into `AccountsStageView`.
- Update the existing `AccountsRoute` unit tests.

**Two retry paths, both animated.**
- On A3 "company not found", "Try again" calls `session.retryMembership()`. That sets `.resolvingCompany` directly, so the path is A3 → A2.
- On A4, "Try again" is `.restart`, which calls `session.start()`. That sets `.authenticationPending` first and then whatever the observer reports. The path is A4 → A0 (in its retry look, §3) → A2, member, or a notice.

### Persistence

- **Store.** `UserDefaults.standard`, key `dip.onboarding.v1.<uid>`. The value is JSON: `OnboardingRecord { version: 1, lastStep, outcome: nil | .finished | .skipped, updatedAt }`. Nothing goes to Firestore.
- **Store API (NEW).**

  ```swift
  protocol OnboardingRecordStore {
      func record(for uid: String) -> OnboardingRecord?
      func save(_ record: OnboardingRecord, for uid: String)
      func isComplete(uid: String) -> Bool   // outcome != nil
  }
  ```

- **When to write.**
  - Write `lastStep` when a step settles, meaning its CTA was tapped and the next step began.
  - Write `outcome` the moment handoff *starts*.
  - **Outcomes.** These match the built P0 `OnboardingFlow`; no P0 change is needed.
    - The header **Skip** (B0–B4) calls `skip()` and writes `.skipped`.
    - The B5 CTA calls `next()`, which on the last step runs `beginHandoff()` and writes `.finished`.
    - B5's **"Skip for now"** also calls `next()` and writes `.finished`. The member has finished the tour; they only skipped saving interests.
- **Resume.**
  - A relaunch with `outcome == nil` and a `lastStep` resumes at that step. `OnboardingFlow.resume(record:features:catalogEmpty:)` is a static function that returns a flow, clamped forward to the next step still available under the current feature flags.
  - The resumed step plays the **resume entrance** (§4.1) and its demo restarts at t = 0.
  - The resume entrance is a **view-layer concern**, not a P0 effect. `OnboardingTourView` plays it when it built its flow with `resume` from a record whose `lastStep != nil`, and the plain entrance otherwise.
  - A relaunch with no record starts at B0.
- **Kill during the B5 save.** The profile observation is the source of truth. B5 reopens with `editor.profile.interestTagIds` selected.
- **Accounts and devices.**
  - Signing out keeps records.
  - Another uid on the same device gets its own tour.
  - Reinstalling the app clears UserDefaults, so the tour shows again. This is accepted and documented.
- **Replay.**
  - Profile gets a new **"How DIP works"** row (NEW). It presents the tour as a `fullScreenCover` with `.presentationBackground(.clear)` in `.replay` mode, starting at B1.
  - Skip reads "Done", and B5 saves through the same path.
  - The tour ends with the H window reveal, uncovering Profile, and the cover is then dismissed with animations disabled.
  - Replay never writes the record.

## 3. Step specs

### 3.0 Shared layout, motion vocabulary and entrance characters

**Tour layout.** The reference is iPhone 17 Pro, 402 × 874 pt (safe area: top 62, bottom 34). All fonts scale with Dynamic Type through `relativeTo:`.

| Element | Geometry and type |
|---|---|
| Header row | y 70–114. Back is a 44 pt circle at x 20 (`surfaceMuted`, ink chevron). The **step pill** starts at x 72: height 44, `actionPrimary`, Figtree 20 `relativeTo: .headline`, white, 16 pt horizontal padding, `lineLimit(1)`. The **Crew stack** sits 10 pt after the pill: 28 pt faces at an 18 pt step (−10 overlap), at most **3 faces then a "+n" disc** (28 pt, `surfaceMuted`, Inter Medium 12, ink), so it is never wider than 82 pt. **Skip** is Figtree 17 `relativeTo: .body`, ink at 70%, trailing-aligned to x 382, 44 pt tall. Its hit area is `max(44, labelWidth + 16)` wide, so it grows with the label, its Dynamic Type size and its localization. "Skip" at default size is ≈ 33 + 16 = 49 pt, so its hit area runs x 333–382. |
| Header overflow rule | Keep `pill.maxX + 10 + stackWidth ≤ skip.minX − 8`. At default size that limit is ≈ 325. (1) The stack already caps at 3 faces + "+n". (2) If it still overflows, the pill truncates (tail) down to a minimum width of 88. (3) At accessibility sizes the header becomes two rows: back + Skip, then pill + stack. Pill labels are short so the default size never truncates ("Find events", "Who's going", "Challenges", "Memories", "Interests"; the widest ≈ 144 pt). The worst case is B4, "Memories" + 4 stack slots, which ends at x 284. |
| Stage | x 20, y 134, width 362, height = (title top − 22) − 134. That is 429 at default sizes. If larger text pushes the title down and the Stage would drop below 300 pt, the step switches to its accessibility-size layout. |
| `EXAMPLE` chip | top-left inside the Stage at x 32, y 145. Height 22, Inter Medium 11, tracking 0.6, ink on white at 85%. |
| Host face | 40 pt at x 322–362, y 114–154. It is centred on the Stage's top edge and drawn in front of it. |
| Demo canvas | 390 × 540 logical, white, radius 23 (16 pt on screen). Scaled by 0.691 to 269.5 × 373 at x 66, y 174 (40 pt gutter on top, 16 pt below). |
| Replay | 44 pt white circle with an ink `arrow.counterclockwise`, at x 336, y 507. |
| Title | x 20, y 585. Fjalla One 34 `relativeTo: .largeTitle`, uppercase, ink, at most 2 lines at default sizes. |
| Body | Inter 16 `relativeTo: .body`, ink, at most 2 lines at default sizes, 10 pt below the title. |
| Secondary text action | Figtree 17 `relativeTo: .body`, centred, y 717–761. |
| Bar | x 20, y 773–853, centre y = H − 61. |

The background is always `surfaceDefault`. Only the Stage changes colour.

**Motion tokens.** These are NEW, in `OnboardingMotion`. `DIPMotion` is unchanged.

**Settle time definition, used everywhere in this spec.** "Settle" means **SwiftUI's own `Spring(response:dampingRatio:).settlingDuration`**, which is roughly a 0.01% residual.
- The 1% figures quoted in review (for example stage ≈ 0.47–0.54 s) describe a looser threshold and are **not** used anywhere in this spec.
- **The engine's own estimate runs below SwiftUI's.** The built P0 `AnimationSpec.settleTime` is the decay envelope at 1e-4. It comes out about 4% below SwiftUI's value for the underdamped tokens, and about 8% below for the critically damped `section`.
- **The binding gate is therefore the XCTest in §5**, which reads SwiftUI's `settlingDuration`. `script.validate()` is a quick DIPCore-level check that also has to pass.
- Timing curves settle at their stated duration.

The values below are **measured** with `settlingDuration`:

| Token | Value (as `AnimationSpec`) | Settle (SwiftUI) | Use |
|---|---|---|---|
| `stage` | `.spring(response: 0.55, dampingFraction: 0.86)` | 0.946 s | Stage frame and fill, zooms, sheets |
| `expand` | `.spring(response: 0.50, dampingFraction: 0.86)` | 0.868 s | card → page expansions in the canvas |
| `hop` | `.spring(response: 0.36, dampingFraction: 0.62)` | 0.867 s | faces, chips, pops, callout entry |
| `reveal` | `.spring(response: 0.60, dampingFraction: 0.88)` | 1.002 s | handoff window |
| `copyOut` | `.easeIn(duration: 0.18)`, opacity → 0, y −6 | 0.18 s | every outgoing title and body; exits stay short and uniform |
| `bar` | `.easeOut(duration: 0.3)` (`DIPMotion.navigation`) | 0.30 s | Bar title and fill (existing) |
| `affordance` | `.spring(response: 0.45, dampingFraction: 0.68)` (`DIPMotion.affordance`) | 0.975 s | Bar icon circle (existing) |
| `marker` | `.spring(response: 0.38, dampingFraction: 0.82)` (`DIPMotion.marker`) | 0.707 s | tab marker (existing) |
| `section` | `DIPMotion.section` is `.smooth(duration: 0.625, extraBounce: 0)`, **a spring, not a timing curve**. Expressed as `.spring(response: 0.625, dampingFraction: 1.0)` | 1.000 s | My Events sections (existing) |
| one-off springs | `.spring(0.4, 0.8)` A3/A4 title drop; `.spring(0.3, 0.7)` B3 stamp; `.spring(0.45, 0.85)` A1 pill; `.spring(0.5, 0.8)` A0 → A1 Crew entrance | 0.757 / 0.659 / 0.797 / 0.926 s | as named |
| `ghost` | `.easeInOut(duration: 0.45)` travel. Press is `.easeInOut(duration: 0.22)` (scale 1 → 0.86 → 1). Appear is `.easeOut(duration: 0.15)`. Drawn as a 44 canvas-pt ink circle at 16% opacity. | 0.45 / 0.22 / 0.15 s | the demo finger |
| `callout` | Enters with `hop` (scale 0.8 → 1). Holds **at least 0.98 s** (B4's "Past events"; every other callout holds 1.4–1.65 s). **Exits** with `.easeIn(duration: 0.15)` (opacity → 0, scale → 0.9). Drawn as an ink capsule, white Inter Medium 13, with a 6 pt tail. | 0.867 / 0.15 s | user-testing labels |

**Timing rule (checked by the built validator and the XCTest).** Every `DemoBeat` has **one** `animation`, plus `moves: Set<String>` (the elements whose geometry or visibility it changes) and `targets: Set<String>` (the elements it aims at). The rule:

> A beat starts no earlier than `earlier.at + settle(earlier.animation)` for **every** earlier beat whose `moves` intersects its `targets`.

The scene tables below are written for the engine as built:
- **One row per beat.** Each row has its own `at`, one `animation`, `moves`, `targets` and a `label`. A moment that combines several animations is several rows at the same or nearby `at`.
- **Staggers.** The view staggers the elements of a group with per-index `.delay(i × step)`. For validation, the group is declared twice: once at its first start, and as a `.tail` beat at its last element's start. The tail has the same `animation` and `moves` and a no-op action. Because the validator checks every earlier mover, the tail governs.
- **Targets include elements a beat aims at, anchors to, or covers.** A move that covers an element (for example a page expanding over a callout) lists that element in `targets`. The validator then enforces that the covered element has already exited.
- **No tolerance and no headroom claim.** Rows are timed to SwiftUI's measured settle. The engine's lower estimate always passes when SwiftUI's does. Equal times pass (`at < earliestStart` is the failure). Even so, no row sits exactly on a boundary, because `Duration(seconds: Double)` can round by attoseconds. Every dependent beat has at least 0.01 s of slack.
- Beats that don't target a moving element may overlap freely.

**Entrance characters.** Each step's copy enters its own way.

| Step | Title entrance | Body |
|---|---|---|
| A1 | Rises from behind the Stage's bottom edge: clipped at the Stage bottom, offset −36 → 0 with `stage`. | Same, 90 ms later. |
| A2 | Title stays; the body dims to 45%. | — |
| A3 / A4 | Drops out of the Stage: the same edge clip, offset −24 → 0 with `.spring(0.4, 0.8)`, timed to the face's mood change. | 120 ms later. |
| B0 | Word by word: each word scales 0.7 → 1 with `hop`, 70 ms apart, in time with the cheer. | Fades in after the last word. |
| B1 | Wipes in left to right: a mask with a 24 pt feather grows 0 → 100% over 0.45 s easeOut, in time with the canvas developing. | Same wipe, 80 ms later. |
| B2 | Words gather: each starts ±18 pt to alternating sides and converges with `hop`. | Opacity over 0.25 s, 100 ms later. |
| B3 | Stamped: scale 1.12 → 1 and opacity 0 → 1 with `.spring(0.3, 0.7)`. | Line by line, 120 ms apart. |
| B4 | Develops like a photo: blur 8 → 0 and opacity 0 → 1 over 0.5 s easeOut. | Same, 100 ms later. |
| B5 | The copy is pinned to the Stage's bottom edge and rides up with it, revealed from under that edge. | Moves with the title. |

**Standard step change.** t = 0 is the CTA tap.

| t | Event |
|---|---|
| 0.00 | `.sensoryFeedback(.impact(weight: .light))`. Outgoing copy runs `copyOut`. The CTA is disabled until 0.32. |
| 0.05 | The outgoing host face starts its flight to the stack (§4.2). |
| 0.08 | Stage fill (and frame, where it changes) animates with `stage` and settles at about 1.02. |
| 0.10 | The Bar title crossfades to the next CTA (`bar`). |
| 0.20 | The incoming host face rises from behind the Stage's top edge: offset +24 → 0, masked at the Stage top, `hop`. |
| 0.32 | The incoming title starts its entrance. |
| 0.52 | The next demo starts at t = 0. No demo's first beat targets the Stage frame, because the canvas keeps its size between B0 and B4. **Exception:** B4 → B5 resizes the Stage, so the strip starts at 1.08, after the frame settles (0.08 + 0.94 = 1.02, plus headroom). |

**Demo rules.**
- Autoplay runs once, then rests on the final frame with Replay visible.
- Tapping the Stage replays.
- A horizontal drag scrubs at 1 pt = 12 ms. Scrubbing applies `state(at:)` with no animation; releasing resumes from that point.
- Demos fire no haptics.

### A0 Pending, A1 Welcome, A2 Resolving: one view

**Purpose.** One idea before sign-in: *DIP is for meeting coworkers through all kinds of activities.*

**Layout.** This is Welcome's existing geometry, measured from `WelcomeView`.
- **Stage:** x 20, y 60 (60 pt top padding with the safe area ignored), 362 × 225, `challengeAccent` pink.
- **Crew:** four faces at 88 pt, overlapping by −19, centred at y 196.
- **Activity pill:** white, height 32, Inter 15 `relativeTo: .subheadline`, ink, centred at y 98.
- **Title:** y 307, Fjalla One 40 `relativeTo: .largeTitle`. The body sits 10 pt below it.
- **Footnote:** Inter 13 `relativeTo: .footnote`, centred, about y 729–761, 12 pt above the Bar.
- **Bar:** y 773–853.

**Copy.**
- **Title:** **MEET YOUR TEAM OUTSIDE WORK** (kept from today).
- **Body:** **"Board games, cooking nights, hikes and more. See which coworkers are going and join in one tap."**
- **Footnote:** **"Use your work Google account. We find your company from your email."**
- **Bar:** **"Continue with Google"**, then "Connecting…", then "Finding your company…". A0 shows "Just a moment…".
- **Pill (localized):** cycles **"Board game lunch" → "Pasta night" → "Trivia after work" → "Sunset hike" → "Coffee walk"**.

**Storyboard.**

1. **A0, cold launch.**
   - An empty pink Stage fades in (0.25 s easeOut).
   - The Bar reads "Just a moment…" with progress.
   - A restored member goes on to H, or to the resume entrance (§4.1).
2. **A0 → A1.**
   - The Crew grow out of the Stage colour. Each face starts as a pink disc (scale 0.6), and its ink disc and figure fade in while it scales to 1 with `hop`, 60 ms apart.
   - The title rises from behind the Stage edge.
   - The Bar crossfades to "Continue with Google".
3. **The reel.**
   - Every 2.4 s, `.transition(.push(from: .bottom))` with `.spring(0.45, 0.85)` changes the pill.
   - One face in turn hops 6 pt with `hop`. On the third change the square face also winks.
   - After 3 cycles (36 s) the reel rests on "Board game lunch". Tapping the Stage restarts it.
   - In Low Power Mode there is no reel.
4. **Sign-in tap.**
   - `.impact(weight: .light)`.
   - The Bar reads "Connecting…" (existing behaviour).
   - The reel pauses.
5. **A2 Resolving.**
   - The Bar title becomes "Finding your company…" with the progress accessory (NEW, §5). That accessory is a white `LinearGradient` band at 25% opacity, 80 pt wide. Its x offset animates −80 → bar width with `.linear(duration: 1.4).repeatForever(autoreverses: false)`. SwiftUI re-evaluates that offset every frame on the main thread; it is one cheap layer and runs only while A0 or A2 is visible.
   - The Crew look around: the rig's `gaze` goes −1 → +1 → 0 over 1.2 s easeInOut, repeating only while A2 is visible. All four eye paths are recomputed per frame during this loop.
   - The body dims to 45% (0.3 s).
   - The pill becomes **"Looking for your team…"**.
6. **A0 retry look** (entered from A3 or A4).
   - The fill returns to pink.
   - The formation regathers into the looking pose (`stage`).
   - The A2 pill appears and the body dims.
   - The Bar reads "Just a moment…" with progress.
   - When `.resolvingCompany` arrives, only the Bar title changes.

**Interaction.** The Bar is the only control. If the Google sheet is cancelled (`AccountsFailure.cancelled`), A1 is restored.

**Reduce Motion.**
- The Crew are already in place.
- The pill changes with a 0.12 s crossfade, at most once every 4 s.
- There is no gaze and no band. The Bar's icon circle shows a static `ProgressView` instead.

**Accessibility.**
- The Stage is `accessibilityHidden`.
- Focus order: title (header) → body → footnote → Bar.
- Entering A2 posts "Finding your company".
- At accessibility sizes there is no Stage, as today.

**Implementation.** `AccountsRootView` renders a single `AccountsStageView(route:previous:)` (NEW) for every non-member route. It replaces `AccountsProgressView`, `WelcomeView` and `AccountsNoticeView`. A `CrewFormation` value per route animates with `stage`.

### A3 No company and A4 Problem

**Copy.** Titles, messages and actions stay as today's `AccountsNotice`, with two refinements:
- **Personal email:** "DIP finds your company from your work email, so personal Gmail and iCloud accounts can't join."
- **Not found:** "We couldn't find your company yet. Ask your organizer to add your email domain, then try again."

**Layout.** A1 geometry. The notice's primary action moves into the Bar. The secondary is a text button at y 717–761.

**Tone formations.**

| Tone | Stage | Faces |
|---|---|---|
| blocked (personal email, other company, unverified) | `actionPrimary` purple | Yellow square face at 120 pt, centred at y 172, worried. The other three at 88 pt, stepped back 28 pt, at 35% opacity. |
| notFound | `notificationAccent` yellow | Purple pill face at 120 pt, calm, alone. |
| offline | `surfaceMuted` gray | White round face at 120 pt, calm. Gray and purple faces at 64 pt, 35% opacity, joined to it by a dashed 2 pt ink line. |
| problem | `actionPrimary` purple | Pink round face at 120 pt, worried, as `AccountsNoticeView` draws it today. |

**Storyboard.** t = 0 is when the state arrives.

| t | Event |
|---|---|
| 0.00 | Gaze stops. Fill animates pink → tone colour with `stage` (settles ≈ 0.94). |
| 0.05 | A2 copy runs `copyOut`. |
| 0.10 | The formation re-composes with `stage`. **Blocked:** `smile` 1 → −0.6 over 0.4 s easeInOut. **Not found:** gaze left, then right, twice (0.5 s each). **Offline:** the dashed line's middle breaks (`trim` 1 → 0.4 over 0.35 s easeOut, once). **Problem:** wobble ±2° twice over 0.6 s. |
| 0.15 | Bar progress ends and the primary action title crossfades in. |
| 0.32 | The title drops out of the Stage; the message follows 120 ms later. |
| 0.45 | The secondary fades in (0.2 s). **Blocked only:** `.sensoryFeedback(.warning)`, once per arrival. |

**Retry and sign-out.**
- **A3 not found → Try again:** fill → pink, the Crew regather, gaze starts, Bar shows progress (A2).
- **A4 → Try again:** the A0 retry look.
- **Sign-out:** goes to A1.

**Reduce Motion.**
- Fill and copy crossfade over 0.25 s.
- The formation appears in its final pose, with no wobble, gaze or trim.
- The dashed line is drawn already broken.

**Accessibility.**
- Focus moves to the title and posts `.screenChanged`.
- Order: title → message → secondary → Bar. Every target is at least 44 pt.
- At accessibility sizes there is no face card (as today); content scrolls and the actions stay pinned.

**Edge cases.**
- A repeated failure replays the arrival without the haptic.
- While `isSubmitting`, both actions are disabled.

### B0 Arrival

**First frame.** Pixel-identical to A2's last frame. `AccountsRootView` swaps in `DIPMemberHome` at this moment, so continuity comes from matching frames.

A fresh member who arrives straight from A0 (a restored session with no record) starts from A0's empty pink Stage instead. Their Crew grow out of the Stage colour during the morph below.

**Copy.**
- **Header:** "Skip" only.
- **Title:** **"YOU'RE IN, {FIRST NAME}"**, or "YOU'RE IN" if there's no name.
- **Body:** **"Here's how DIP gets your team together. It takes about a minute."**
- **Bar:** **"Show me around"**

**Storyboard.**

| t | Event |
|---|---|
| 0.00 | Bar progress stops. Title → "Show me around" (`bar`). |
| 0.05 | Stage morphs y 60 → 134 and 225 → 429, pink → `notificationAccent` yellow (`stage`, settles ≈ 0.99). |
| 0.10 | The Crew cheer: y −12 → 0 with `hop`, 70 ms apart. Moods → happy. The square face winks at 0.60 (§5, wink timing). |
| 0.25 | The Crew spread 24 pt apart. **You** (88 pt, 3 pt white ring) grows out of the Stage colour: a yellow disc scales 0.4 → 1 with `hop` while the avatar fades in. |
| 0.40 | The title enters word by word ("YOU'RE" · "IN," · "SAM"). The body follows at 0.70. |
| 0.70 | "Skip" fades in (0.25 s). The stack appears only when You flies into it at B0 → B1. |

**Reduce Motion.** A 0.3 s crossfade into the final composition.

**Accessibility.**
- Description: "You and four coworkers, celebrating."
- At accessibility sizes: a 56 pt You avatar, then the title and body, with the Bar pinned.

**Implementation.** `OnboardingTourView` (NEW) is an opaque overlay inside `DIPMemberHome.body`, in a `ZStack` above the existing content `Group`.
- While the tour is up, the content underneath has `allowsHitTesting(false)` and `accessibilityHidden(true)`, and keeps loading.
- `DIPMemberHome`'s private `prototype(...)` needs no visibility change.

### B1 Discover & Join

**Copy.**
- **Pill:** **"Find events"**
- **Title:** **"FIND SOMETHING FUN"**
- **Body:** **"Company events, from lunchtime board games to weekend hikes. Tap Join once and you're on the list."**
- **Bar:** **"See who's going"**

**Stage.** `actionPrimary`. The host face is purple round.

**Canvas.**

- **Feed.**
  - "Upcoming events" in Figtree 18 at y 70.
  - A non-scrolling `HStack` of `DIPPhotoEventCard` (163 × 205, radius 20, spacing 10) at y 102. It moves only by `offset`. The cards, in order:
    - Board Game Lunch (`cover_games`, "5 Attending")
    - Pasta Night (`cover_cooking`, "5 Attending")
    - Saturday Hike (`cover_hiking`)
    - Kayak Morning (`cover_outdoors`)
    - Lunchtime Yoga (`cover_fitness`)
- **Event page.** Composed from shared pieces, not `DIPEventDetailsScreen`, whose `DIPDetailHeader` adds a back button at 60 pt top padding. The page is offset −90, so the hero's top 90 pt are cropped. From top to bottom:
  - `DIPDetailHero`: 350 × 264, radius 20 on all corners, at canvas y −80…184.
  - "PASTA NIGHT" in Fjalla One 40 at y 194–244.
  - `DIPDetailPeopleRow(title: "Who's Attending", avatars: [P, Y, G], total: 5, capacity: 12)`: shows "5 of 12", three 40 pt faces and a "+ 2 More" capsule, at y 264–336.
  - `DIPDetailActionRow(joinInRow: false, directionsURL: <demo URL>, shareTitle: "Share Event")`, at y 356–406.
- **Mini bar.** `DIPFloatingNavigation` at canvas y 439–519 (centre = 540 − 61), with `tabs: [.home, .events, .profile]`. That is the NEW parameter; the Rewards gift tab is never shown in demos (§7.1 tab rule).
- **Avatars.** Crew faces are rendered once with `ImageRenderer` at @3x to PNG and passed as `MediaReference.data(_)`.

**Storyboard.**

Element names: `canvasMask`, `feedCards`, `feedRow`, `card.pasta`, `hero`, `eventTitle`, `peopleRow`, `actionRow`, `miniBar`, `barIcon`, `avatar4`, `moreCapsule`, `joinRing`, `capacityText`, `callout.joined`, `ghost`.

The canvas is Home's events section. The weekly challenge card (§7.1 Home rule) sits above it, scrolled out of view: only its 20 pt pink bottom edge peeks above "Upcoming events" at canvas y 48–68. This keeps the demo faithful to the real Home without spending canvas height on the card.

| Label | at | animation | moves | targets | What happens |
|---|---|---|---|---|---|
| `b1.mask` | 0.00 | `stage` | canvasMask | — | The canvas starts filled with Stage purple. A circular reveal grows from radius 0 to 340, uncovering the white feed. The radius is a continuous function of t. |
| `b1.cards` | 0.00 | `expand` | feedCards | — | Cards scale 0.94 → 1. The view staggers them 5 × 50 ms. |
| `b1.cards.tail` | 0.20 | `expand` | feedCards | — | Stagger tail (no-op). Settles at 1.068. |
| `b1.browse` | 1.10 | `.easeInOut(0.9)` | feedRow, card.pasta | feedCards | `HStack` offset x 0 → −180. An offset, not a `ScrollView`. |
| `b1.browseBack` | 2.00 | `.easeInOut(0.6)` | feedRow, card.pasta | — | Offset back to 0. Ends 2.60. |
| `b1.ghostIn` | 2.62 | `.easeOut(0.15)` | ghost | card.pasta | The ghost appears over Pasta Night. |
| `b1.pressCard` | 2.80 | `.easeInOut(0.22)` | ghost | card.pasta | Press. The card's 0.97 press scale is feedback only, not a geometry move. |
| `b1.hero` | 2.90 | `expand` | hero | card.pasta | **Card → hero:** `matchedGeometryEffect(id: "cover.pasta")` goes 163 × 205 → 350 × 264, radius 20 throughout. Settles at 3.768. |
| `b1.rows` | 2.90 | `expand` | eventTitle, peopleRow, actionRow, moreCapsule | — | Title and rows grow out of the hero's bottom edge (clipped there, offset −16 → 0). Staggered 3 × 60 ms. |
| `b1.rows.tail` | 3.02 | `expand` | eventTitle, peopleRow, actionRow, moreCapsule | — | Stagger tail. Settles at 3.888. |
| `b1.joinTitle` | 2.90 | `bar` | miniBar | — | Mini bar: tabs → **"Join the Activity"** (ink). |
| `b1.ghostToBar` | **3.82** | `ghost` | ghost | miniBar, hero | The ghost travels past the hero to the mini bar. The hero settled at 3.768. |
| `b1.pressJoin` | 4.27 | `.easeInOut(0.22)` | ghost | miniBar | Press. |
| `b1.joined` | 4.32 | `bar` | miniBar | miniBar | Mirrors the app's `bottomAction`. The title crossfades to **"Activity Chat"**, and the fill goes ink → `actionPrimary`. |
| `b1.barIcon` | 4.32 | `affordance` | barIcon | — | A white 64 pt circle holding `event_HeroiconsOutlineChatBubbleOvalLeft` springs in (scale 0.3 → 1). Settles at 5.295. |
| `b1.avatar` | 4.32 | `bar` | avatar4, moreCapsule, capacityText | — | The people row becomes `[P, Y, G, You]` with total 6. The fourth slot fades in, using the component's own insertion. "5 of 12" → "6 of 12" uses `.contentTransition(.numericText())`, applied from outside. |
| `b1.ring` | 4.32 | `.linear(0.5)` | joinRing | — | A demo-only white 2 pt ring at canvas (170, 300) grows 1 → 1.5 and fades. |
| `b1.slot` | 4.32 | `bar` | actionRow | — | Directions → **"Leave Activity"** (crossfade). Ends 4.62. |
| `b1.callout` | 4.65 | `hop` | callout.joined | actionRow | **"Joined. That's it."** at canvas y 412. The action row settled at 4.62. |
| `b1.calloutOut` | 6.25 | `.easeIn(0.15)` | callout.joined | — | Exit, after a 1.6 s hold. |
| end | 6.60 | — | — | — | Rest. |


**Chat honesty.**
- Beat 6 draws the bar exactly as shipped: `DIPPrototypeApp.bottomAction` returns "Activity Chat", `.accent` and the chat icon for a joined event.
- The demo calls the same resolver, `EventBarAction.resolve(...)` (a NEW extraction).
- It mirrors the current app and promises no chat feature. The copy never mentions chat. See open decision 1.

**Reduce Motion.** Three stills, crossfading over 0.3 s and holding 1.6 s each: the feed, the event page, the joined page.

**Accessibility.**
- Description: "Example: a feed of company events, from board games to a hike. Opening Pasta Night and tapping Join the Activity once adds you to Who's Attending, and the bar changes to show you've joined."
- At accessibility sizes: rows "calendar · Browse company events", "hand.tap · Join with one tap", "checkmark.circle · Joined events appear in My Events".

### B2 People & Invites

**Copy.**
- **Pill:** **"Who's going"**
- **Title:** **"GO WITH PEOPLE YOU KNOW"**
- **Body:** **"See who's going before you decide. Invite a coworker and they can join in one tap."** Without F4: **"See who's going before you decide, by name and team."**
- **Bar:** **"What are challenges?"**

**Stage.** `surfaceMuted`. The host face is the yellow square. The canvas opens on B1's final state.

**Participant rows (NEW small refactor).** Extract `DIPParticipantsScreen.personRow` (`DIPParticipantsScreen.swift` line 103) into an internal `DIPParticipantRow(person:)`. The row keeps its measured geometry exactly:
- `HStack(spacing: 16)`
- a 50 × 50 `DIPMedia` avatar
- the name in Figtree Bold 18 and the department in Figtree Regular 18, each in a 22 pt line
- `.padding(.horizontal, 5)`
- `.frame(height: 75)`

**The divider stays in the caller.** Today the `attendees_Line2` 1 pt divider (rotated 180°) is drawn by the caller's `ForEach` (lines 41–48), inside a `VStack(spacing: 4)` between rows, not by `personRow`. The extraction keeps that split: `DIPParticipantsScreen` keeps drawing its dividers and has no visual change.

The demo panel composes rows the same way. It is a white panel, radius 20, 16 pt padding: `VStack(spacing: 4)` of `DIPParticipantRow`, with an `attendees_Line2` divider after every row except the last. Four rows are 4 × 75 + 3 × 4 = 312 pt (canvas), plus 32 pt of padding = 344 pt. The demo doesn't embed the full screen, so there is no back header and no 60 pt top padding.

**Storyboard.**

Element names: `canvasZoom`, `peopleRow`, `moreCapsule`, `participantPanel`, `inviteChip`, `inviteSheet`, `sheetRow.priya`, `priyaCheck`, `sendInvite`, `toast`, `canvasFlip`, `inviteCard`, `acceptButton`, `capacityText`, `pulseRing`, `ghost`.

| Label | at | animation | moves | targets | What happens |
|---|---|---|---|---|---|
| `b2.zoom` | 0.00 | `stage` | canvasZoom, peopleRow, moreCapsule, inviteChip | peopleRow | Canvas scale 1 → 1.35, anchored at the people row (195, 300). Settles at 0.946. |
| `b2.ghostMore` | 0.96 | `.easeOut(0.15)` | ghost | moreCapsule | The ghost appears on "+ 2 More". |
| `b2.pressMore` | 1.00 | `.easeInOut(0.22)` | ghost | moreCapsule | Press. |
| `b2.panel` | 1.15 | `expand` | participantPanel | moreCapsule | The participant panel grows out of the capsule (scale 0.3 → 1, anchored on it, with opacity). Rows: **Maya · Design**, **Theo · Engineering**, **Jun · Finance**, **You**. Settles at 2.018. |
| `b2.unzoom` | 1.15 | `stage` | canvasZoom, peopleRow, moreCapsule, inviteChip | — | The zoom eases back to 1.0. Settles at 2.096. |
| `b2.panelBack` | 2.70 | `.easeIn(0.5)` | participantPanel | moreCapsule | The panel shrinks back into the capsule. Ends 3.20. |
| `b2.ghostChip` | 3.25 | `ghost` | ghost | inviteChip | The ghost travels to the invite control. **NEW, owned by F4:** there is no `InviteEntryPoint` today. Until F4 ships one, `DemoInviteChip` stands in: a purple capsule, Inter 14, white, 50 pt, labelled "Invite a coworker", below the action row. |
| `b2.pressChip` | 3.70 | `.easeInOut(0.22)` | ghost | inviteChip | Press. |
| `b2.sheet` | 3.80 | `stage` | inviteSheet, sheetRow.priya, sendInvite | inviteChip | A sheet grows from the chip (top radius 20) with three `DIPParticipantRow`s. Settles at 4.746. |
| `b2.pressPriya` | 4.80 | `.easeInOut(0.22)` | ghost | sheetRow.priya | The ghost reappears on Priya's row and presses (4.80–5.02). |
| `b2.check` | 4.95 | `hop` | priyaCheck | sheetRow.priya | "Priya · Design" gets a purple check. |
| `b2.pressSend` | 5.30 | `.easeInOut(0.22)` | ghost | sendInvite | The ghost presses **Send invite**. The sheet settled at 4.746. |
| `b2.sheetClose` | 5.55 | `stage` | inviteSheet, sheetRow.priya, sendInvite | inviteChip | The sheet shrinks into the chip. |
| `b2.chipSent` | 5.55 | `bar` | inviteChip | — | The chip becomes "Invite sent" in `actionComplete` gray. |
| `b2.toast` | 5.75 | `hop` | toast | — | Toast **"Invite sent to Priya"**. |
| `b2.toastOut` | 6.75 | `.easeIn(0.15)` | toast | — | The toast exits. |
| `b2.flipOut` | 6.90 | `.easeIn(0.26)` | canvasFlip | — | `rotation3DEffect` 0 → 90°, then the content swaps. The chip text becomes `PRIYA'S VIEW`. |
| `b2.flipIn` | 7.16 | `.easeOut(0.30)` | canvasFlip, inviteCard, acceptButton | — | −90° → 0°. F4 placeholder card: **"Theo invited you to Pasta Night"**, Thu · 6:30 PM, with `DIPButton("Accept")` and `DIPButton("Decline", emphasis: .secondary)`. Ends 7.46. |
| `b2.pressAccept` | 7.50 | `.easeInOut(0.22)` | ghost | acceptButton | Press Accept. |
| `b2.cardCollapse` | 7.80 | `stage` | inviteCard | — | The card collapses. Settles at 8.746. |
| `b2.flipBackOut` | 8.80 | `.easeIn(0.26)` | canvasFlip | inviteCard | Flip back, first half. |
| `b2.flipBackIn` | 9.06 | `.easeOut(0.30)` | canvasFlip | — | Flip back, second half. |
| `b2.counts` | 9.40 | `bar` | capacityText, moreCapsule | — | "6 of 12" → "7 of 12" and "+ 2 More" → "+ 3 More" (numeric). |
| `b2.pulse` | 9.40 | `.linear(0.5)` | pulseRing | — | A ring pulses on the capsule. |
| end | 10.20 | — | — | — | Rest. |


Without F4, the rows from `b2.ghostChip` onward are dropped and the demo ends at 3.30.

**Reduce Motion.** Five stills: the zoomed row → the participant panel → invite sent → Priya's card → "7 of 12".

**Accessibility.**
- Description: "Example: Who's Attending opens a list of coworkers by name and team. Theo invites Priya; on her phone she accepts and the count goes up."
- At accessibility sizes: rows "person.2 · See who's going before you join", "list.bullet · Open the list for names and teams", and "envelope · Invite a coworker from your company" (F4 only).

### B3 Challenges & Points

**Copy.**
- **Pill:** **"Challenges"**
- **Title:** **"TAKE ON A CHALLENGE"**
- **Body:** **"Each challenge shows what to do, how to send it in and when it ends. Once your organizer approves, the points are yours."**
- **Bar:** **"And after the event?"**

**Stage.** `challengeAccent`. The host face is the white pill.

**Storyboard.**

Element names: `canvasWhite`, `challengeCard`, `cardContent`, `detailHeader`, `reqLines`, `deadline`, `reward`, `callout.submit`, `miniBar`, `entryForm`, `sendEntry`, `progressValue`, `caption`, `photoThumb`, `statusPill`, `dim`, `laterChip`, `pointsToken`, `pointsPill`, `ghost`.

| Label | at | animation | moves | targets | What happens |
|---|---|---|---|---|---|
| `b3.white` | 0.00 | `stage` | canvasWhite | — | The canvas starts entirely pink, the Stage colour. The `DIPChallengeCard` ("COFFEE WITH 3", "+ 12 others participating"; artwork is the white-pill Crew face rather than the Fitness mascot, see Principle 4) sits on top in the same pink, 350 × 225 at canvas (20, 20), so it is invisible. A **white background layer behind the card** grows upward from height 0 to 540. As it passes, the margins and the area around the card whiten, so the card is revealed by the whitening. The card is not full-bleed. |
| `b3.content` | 0.30 | `.easeOut(0.25)` | cardContent | — | The card's text and art fade in. |
| `b3.ghostCard` | 0.95 | `.easeOut(0.15)` | ghost | challengeCard | The ghost appears on the card. |
| `b3.pressCard` | 1.00 | `.easeInOut(0.22)` | ghost | challengeCard | Press. |
| `b3.details` | 1.15 | `expand` | challengeCard, detailHeader | challengeCard | The card becomes the F3 details header band. Settles at 2.018. |
| `b3.line1` | 1.40 | `.easeOut(0.3)` | reqLines | — | Wipe: **"1 Have coffee with 3 coworkers you haven't met"** |
| `b3.line2` | 1.52 | `.easeOut(0.3)` | reqLines | — | Wipe: **"2 Send your count, a caption and a photo if you like"** |
| `b3.line3` | 1.64 | `.easeOut(0.3)` | reqLines | — | Wipe: **"3 Your organizer approves it"** |
| `b3.deadline` | 1.76 | `.easeOut(0.3)` | deadline | — | **"Ends Friday"** (`calendar`, Inter 14) |
| `b3.reward` | 1.88 | `.easeOut(0.3)` | reward | — | **"+50 points"** |
| `b3.callout` | 2.20 | `hop` | callout.submit | reqLines, detailHeader | **"How to submit"** |
| `b3.ghostBar` | 3.30 | `ghost` | ghost | miniBar | The ghost travels to the mini bar, which shows the app's current challenge action, **"Add Your Entry"** (from `EventBarAction.resolve`, ink). |
| `b3.calloutOut` | 3.60 | `.easeIn(0.15)` | callout.submit | — | The callout exits after a 1.4 s hold, before the form covers it. |
| `b3.pressBar` | 3.75 | `.easeInOut(0.22)` | ghost | miniBar | Press. |
| `b3.form` | 3.80 | `expand` | entryForm, sendEntry | miniBar, callout.submit | The F3 entry form (a placeholder until F3) grows from the bar and covers the area where the callout was. The callout finished exiting at 3.75. Settles at 4.668. |
| `b3.progress1` | 4.72 | `.easeOut(0.2)` | progressValue | entryForm | Progress 0 → 1 (numeric). |
| `b3.progress2` | 4.90 | `.easeOut(0.2)` | progressValue | entryForm | 1 → 2 |
| `b3.progress3` | 5.08 | `.easeOut(0.2)` | progressValue | entryForm | 2 → 3 |
| `b3.caption` | 5.22 | `.linear(0.67)` | caption | entryForm | Types "Met Jun from Design", 35 ms per grapheme cluster (a continuous function of t). |
| `b3.photo` | 5.97 | `hop` | photoThumb | entryForm | The photo thumbnail grows from a pink square (0.6 → 1) into a fixed slot, so the form's layout doesn't change. |
| `b3.pressSend` | 6.40 | `.easeInOut(0.22)` | ghost | sendEntry | Press Send. |
| `b3.pill` | 6.50 | `hop` | statusPill | sendEntry | The yellow pill **"Waiting for approval"** grows from the Send button's frame. Settles at 7.367. |
| `b3.dim` | 7.40 | `.easeIn(0.15)` | dim | statusPill | Content dims to 80%. |
| `b3.later` | 7.40 | `.easeInOut(0.6)` | laterChip | — | The chip **"Later"** fades in and out. |
| `b3.undim` | 8.00 | `.easeOut(0.15)` | dim | — | The dim lifts. |
| `b3.approved` | 8.10 | `bar` | statusPill | statusPill | Yellow → purple, **"Approved"**. |
| `b3.arc` | 8.50 | `.linear(0.55)` | pointsToken | pointsPill | "+50" follows a `KeyframeTimeline<CGPoint>`, sampled with `value(time:)` from t, so it scrubs. Out (+24, −12) at 0.20, apex (+60, −60) at 0.35, pill centre at 0.55. |
| `b3.balance` | 9.10 | `.easeOut(0.4)` | pointsPill | — | F2 balance **120 → 170 points** (numeric). |
| end | 9.80 | — | — | — | Rest. |


Without F2, `b3.arc` and `b3.balance` are dropped, `b3.approved` shows "Approved · +50 points", and the demo ends at 8.80.

**Arc.** A `KeyframeTimeline<CGPoint>`: out (+24, −12) at 0.20 s, apex (+60, −60) at 0.35 s, the pill centre at 0.55 s, cubic. It is sampled with `value(time:)` from the demo's `t`, so it scrubs. `KeyframeAnimator` is never used inside demos.

**Reduce Motion.** Four stills: the requirements with the deadline → the filled entry → waiting → approved with points.

**Accessibility.**
- Description: "Example: a challenge lists its steps, its deadline and its reward before you start. You send your count, a caption and a photo; it waits for organizer approval, then 50 points are added."
- At accessibility sizes, four rows:
  - "list.number · Each challenge lists what to do"
  - "calendar · It shows when it ends and the points you'll get"
  - "square.and.arrow.up · Send progress, a caption and an optional photo"
  - "checkmark.seal · Your organizer approves, then points are added"

**Honesty.** No points are awarded on the client. The "Later" chip makes the wait for the organizer explicit.

### B4 Memories

**Copy.**
- **Pill:** **"Memories"**
- **Title:** **"KEEP THE MEMORIES"**
- **Body:** **"Your events live in My Events. Past events keep a shared photo album for everyone who went."**
- **Bar:** **"Make it yours"**

**Stage.** `notificationAccent` yellow, distinct from B3's pink. The host face is gray round.

**Storyboard.**

Element names: `miniBar`, `tabMarker`, `myEventsList`, `callout.myEvents`, `sectionMarker`, `sectionContent`, `callout.past`, `pastCard`, `pastPage`, `albumGrid`, `newThumb`, `uploadRing`, `ghost`.

| Label | at | animation | moves | targets | What happens |
|---|---|---|---|---|---|
| `b4.tabs` | 0.00 | `bar` | miniBar | — | The mini bar's action dissolves into the three demo tabs. |
| `b4.marker` | 0.00 | `marker` | tabMarker | — | Marker Home → My Events. Settles at 0.707. |
| `b4.develop` | 0.00 | `.easeOut(0.4)` | myEventsList | — | The My Events content develops in place (blur 6 → 0 and opacity). |
| `b4.callout` | 0.75 | `hop` | callout.myEvents | tabMarker | **"My Events"** above the icon. |
| `b4.calloutOut` | 2.40 | `.easeIn(0.15)` | callout.myEvents | — | Exits after a 1.65 s hold. |
| `b4.section` | 2.55 | `section` = `.spring(0.625, 1.0)` | sectionMarker, sectionContent, pastCard | — | The section marker and content move to the past section. Settles at 3.550. |
| `b4.calloutPast` | 3.60 | `hop` | callout.past | sectionMarker | **"Past events"** |
| `b4.ghostPast` | 3.60 | `ghost` | ghost | pastCard | The ghost travels to "Saturday Hike · Oct 18". |
| `b4.pressPast` | 4.10 | `.easeInOut(0.22)` | ghost | pastCard | Press. |
| `b4.calloutPastOut` | 4.58 | `.easeIn(0.15)` | callout.past | — | Exits after a 0.98 s hold (ends 4.73), before the page covers it. |
| `b4.pastPage` | 4.75 | `expand` | pastPage | pastCard, callout.past | The past event page expands from the card: `DIPDetailHero` and "Who Attended". It covers where the callout was. Settles at 5.618. |
| `b4.viewAlbum` | 4.75 | `bar` | miniBar | — | The mini bar shows the app's past-event action, **"View Album"**. |
| `b4.ghostBar` | 5.65 | `ghost` | ghost | miniBar, pastPage | The ghost travels to the bar. |
| `b4.pressBar` | 6.10 | `.easeInOut(0.22)` | ghost | miniBar | Press. |
| `b4.grid` | 6.35 | `expand` | albumGrid | — | Six `album_Rectangle93x` images develop (blur 6 → 0, scale 0.96 → 1), staggered 6 × 40 ms. |
| `b4.grid.tail` | 6.55 | `expand` | albumGrid | — | Stagger tail. Settles at 7.418. |
| `b4.addPhotos` | 6.35 | `bar` | miniBar | — | Bar → **"Add Photos"**. |
| `b4.pressUpload` | 7.45 | `.easeInOut(0.22)` | ghost | miniBar, albumGrid | Press. |
| `b4.thumbGrow` | 7.70 | `.linear(0.8)` | newThumb, uploadRing | — | A new thumbnail grows out of the bar capsule while a white ring fills 0 → 1. |
| `b4.thumbSettle` | 8.50 | `stage` | newThumb, albumGrid | — | It settles into slot 1, pushing the others along. Settles at 9.446. |
| end | 9.50 | — | — | — | Rest. |


**Reduce Motion.** Three stills.

**Accessibility.**
- Description: "Example: the My Events tab holds your upcoming and past events. A past event opens its photo album, where you can add your own photos."
- At accessibility sizes: rows "square.grid.2x2 · My Events holds upcoming and past events", "clock.arrow.circlepath · Past events keep their photo album", "photo.badge.plus · Add your own photos".

### B5 Interests

**Copy.**
- **Pill:** **"Interests"**. The spec settles on "Interests" so the header fits (§3.0). The built P0 `OnboardingStep.pillTitle` still returns "Your interests", so P0 needs a one-line change: `defaultValue: "Interests"` for `onboarding.pill.interests`. VoiceOver announcements then read "Step 5 of 5, Interests".
- **Title:** **"WHAT ARE YOU INTO?"**
- **Body:** **"Pick a few. You can filter events by them anytime, and change them in Profile."**
- **Bar:** **"Save and start"** (`.accent`) when at least one is selected, otherwise **"Start exploring"**.
- **Secondary:** **"Skip for now"**

**Layout.**
- Stage strip at y 134–330, `surfaceMuted`, no host face.
- Title at y 352.
- Embedded picker from y 450 to 705.
- Secondary at y 717–761.
- Bar at y 773.

**Embedded picker API (NEW refactor of `DIPInterestPicker`).** Today the picker owns `selection`, `isSaving` and `saveError` as `@State`, wraps itself in a `NavigationStack` with a toolbar, shows its own "Try again", and calls `dismiss()`. The refactor adds a second, embedded initializer:

```swift
struct DIPInterestPicker: View {
    struct EmbeddedState { var isSaving: Bool; var errorMessage: String? }
    // Sheet use (Profile): unchanged behaviour.
    init(options: [DIPInterest], selection: Set<String>, onSave: @escaping ([String]) async throws -> Void)
    // Embedded use (onboarding).
    init(options: [DIPInterest], selection: Binding<Set<String>>, embedded: EmbeddedState)
}
```

- **Both** initializers render one shared `InterestList`: search, count, rows, empty state and the 10-item limit.
- **The sheet initializer** keeps today's `NavigationStack`, toolbar, inline retry and `dismiss()`.
- **The embedded initializer:**
  - has no `NavigationStack`, toolbar or retry button, and never dismisses
  - shows `errorMessage` as a label at the top of the list
  - disables rows while `isSaving`
- The host owns the binding, the save, and the only "Try again", which lives in the Bar.

**Save.** `ProfileEdit.department` and `.city` are non-optional, and `MemberProfileBridge.edits` writes them as given. The host therefore passes the editor's acknowledged profile values:

```swift
/// Catalog order, the same as DIPInterestPicker's existing save
/// (options.map(\.id).filter(selection.contains)). `catalog` is the member's
/// InterestCatalog: its `tags` are de-duplicated by id and sorted by
/// (sortOrder, name) only (DIPAccounts/Profile.swift, `load()`). Two tags with the
/// same sortOrder and name keep the repository's order. (MemberProfileBridge.profile
/// sorts by (sortOrder, name, id), but only for display.) Ids no longer in the
/// catalog are dropped, matching today's picker.
func catalogOrdered(_ selection: Set<String>) -> [String] {
    catalog.tags.map(\.id).filter(selection.contains)
}

let edit = ProfileEdit(department: editor.profile.department, city: editor.profile.city,
                       interestTagIDs: catalogOrdered(selection))  // jobTitle/availability/radius nil = unchanged
try await MemberProfileBridge.save(edit, editor: editor, uid: context.uid)
```

- **While saving:** the Bar reads "Saving…" with progress.
- **On success:** `.sensoryFeedback(.success)`, then H.
- **On failure:**
  - `errorMessage` = "Couldn't save your interests. Your choices are kept."
  - The Bar reads **"Try again"** and resubmits the same edit.
  - "Skip for now" stays, and the selection is kept.

**Live reshape (needs F1).**
- The strip shows F1's chip row ("All events" plus the selections) above interest cards. Each card is titled with the real catalog name and has a Crew face on a token fill.
- Selecting an interest grows a chip from the strip colour: a gray capsule fills purple and scales 0.6 → 1 with `hop`. A matching card grows the same way, with `.sensoryFeedback(.selection)`.
- Deselecting collapses both (`stage`).
- "All events" always stays.
- Without F1, the strip shows only the chips.

**Catalog states.**
- **Loading:** six `surfaceMuted` rows, 44 pt, with the shimmer band. The Bar reads "Start exploring".
- **Failed:** the gray face, calm, on the strip, and the message "Your interests couldn't load. You can add them in Profile anytime." No picker. The Bar reads "Start exploring".
- **Empty catalog:** the step is skipped.

**Pre-selection.** `editor.profile.interestTagIds`.

**Reduce Motion.** Chips use opacity over 0.12 s. The Stage height change is a crossfade.

**Accessibility.**
- After each toggle the picker posts a polite announcement, e.g. "3 interests selected".
- At accessibility sizes: no strip; header in two rows; title, body, then the picker; "Skip for now" and the Bar pinned.

### H Handoff into Home

**What is underneath.** `DIPMemberHome` is the shell. What it shows depends on loading state, and only some of those surfaces include the bar:

| Surface | Shown by | Bar underneath? |
|---|---|---|
| `shellLoading` | `DIPMemberHome`: `ProgressView("Loading your company events…")` while the live repository is created | **No** |
| `shellUnavailable` | `DIPMemberHome`: `ContentUnavailableView("Events unavailable")` on a configuration error | **No** |
| `activitiesLoading` | `DIPPrototypeApp`: `ProgressView("Loading…")` while `snapshot == nil && isLoading` | **Yes.** `DIPFloatingNavigation` is a sibling in the shell's `ZStack` and is always drawn: tabs, Home selected, no action. |
| `activitiesError` | `DIPPrototypeApp`: `ContentUnavailableView` "Couldn't load your activities", with a Retry button (`data.retry`), while `snapshot == nil && !isLoading` | **Yes**, as above |
| `ready` | `DIPPrototypeApp` with a snapshot. This includes the "Updates paused — Retry" banner state. | **Yes** |

**Surface signal (NEW).** `DIPPrototypeApp` and `DIPMemberHome` report the surface above through an `onSurfaceChange(HomeSurface)` callback, which is passed to the tour.

**Wait.** At t = 0, if the surface is `shellLoading` or `activitiesLoading`:
- The Bar title becomes **"Getting your events…"** with progress, the copy leaves, and the Stage holds its last frame.
- The tour waits up to 2.0 s for any other surface, then proceeds with whatever surface is current.

**Window reveal.** This runs for every surface. t = 0 is the end of the wait, or the CTA tap if there was none.

| t | Event |
|---|---|
| 0.00 | Header, copy and picker run `copyOut`. The tour's white background is now drawn by `WindowSheet`. |
| 0.10 | The Stage's contents fade (0.2 s), so the surface underneath shows through the window. |
| 0.20 | The window animates to the full screen and radius 0 with `reveal` (settles ≈ 1.20). You (28 pt) flies to the Home header's profile button, 40 pt (`stage`, settles ≈ 1.14). The other stack faces fade (0.2 s). |
| 0.30 | **Bar, by surface.** **(d) `ready`, (b) `activitiesLoading`, (c) `activitiesError`:** the action dissolves (`action = nil`) into tabs with the marker on Home (`bar`, 0.3 s). The shell's bar has the same centre (H − 61), the same 20 pt inset and the same state, so removing the tour layer changes no pixels. **(a) `shellLoading` / `shellUnavailable`:** there is no bar underneath, so the onboarding Bar fades out (0.25 s). When the shell later renders `DIPPrototypeApp`, its bar appears with that view. |
| 1.25 | The tour layer is removed, after the window has settled. |
| 1.25 | VoiceOver focus moves with `.screenChanged`. **(d):** the Home header. **(b):** the "Loading…" label. **(c):** the **Retry** button. **(a):** the loading label, or the "Events unavailable" title. |

In every case `outcome` was already written at t = 0.

In (c) and in (a) unavailable, You's flight ends at the top-right corner position anyway (x W − 65, y 65), then fades, because there is no header there.

**WindowSheet (NEW).** A filled shape with a hole, not a mask:

```swift
import SwiftUI

struct WindowSheet: Shape {
    var window: CGRect
    var radius: CGFloat

    var animatableData: AnimatablePair<AnimatablePair<CGFloat, CGFloat>,
                                       AnimatablePair<AnimatablePair<CGFloat, CGFloat>, CGFloat>> {
        get {
            AnimatablePair(AnimatablePair(window.minX, window.minY),
                           AnimatablePair(AnimatablePair(window.width, window.height), radius))
        }
        set {
            window = CGRect(x: newValue.first.first, y: newValue.first.second,
                            width: newValue.second.first.first, height: newValue.second.first.second)
            radius = newValue.second.second
        }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path(rect)
        path.addRoundedRect(in: window, cornerSize: CGSize(width: radius, height: radius), style: .continuous)
        return path
    }
}

// Usage, in its own layer above the shell:
// WindowSheet(window: windowFrame, radius: windowRadius)
//     .fill(Color.white, style: FillStyle(eoFill: true))
```

The memberwise initializer `WindowSheet(window:radius:)` compiles because `animatableData` is computed. Even-odd fill leaves the window as a hole.

**Profile button target (NEW constant).** `DIPHomeScreen.profileButtonFrame(width:)` = x `width − 65`, y 65, 40 × 40. It is derived from `DIPHomeScreen`'s 20 pt horizontal and 60 pt top padding plus `DIPHomeHeader`'s 5 pt capsule padding. `DIPHomeScreen` uses the same constant, so the two can't drift. The position doesn't change when F0 hides the bell, because the button is the capsule's trailing element.

**Reduce Motion.** Tour → surface crossfade over 0.35 s. The Bar crossfades to tabs, or fades out in case (a).

**Returning member.** A2 or A0 → reveal in 0.6 s, with the Welcome Stage frame as the window.

**Replay end.** The same reveal over Profile, with You flying to Profile's large photo. Then the cover is dismissed with `Transaction(animation: nil)`.

## 4. How the steps flow together

### 4.1 Adjacent pairs and the resume entrance

| From → To | Shared or morphed | Exits | Overlap |
|---|---|---|---|
| A0 → A1 | Stage and Bar title | — | The Crew grow from the Stage colour during the Bar crossfade. |
| A1 → A2 | Stage, Crew gaze, Bar band | Pill text; the body dims. | 0.3 s together |
| A2 → A3 / A4 | Fill (pink → tone), formation, mood, Bar → primary | A2 copy | The formation starts 0.1 s after the fill. |
| A3 → A2 | The reverse | Notice copy | same |
| A4 → A0 retry → A2 | Fill → pink, looking pose, Bar progress | Notice copy | A0 → A2 changes only the Bar title. |
| A2 → B0 | Identical frame across the view swap, then Stage geometry, fill and Bar title | — | Cheer during the morph |
| **A0 → B[n] (resume entrance)** | Stage morphs from A0's empty pink (y 60, 225) to tour geometry (y 134, 429) and B[n]'s fill with `stage` (0.05–0.99). At 0.15 the header row fades in (0.25 s) with the stack **pre-filled**: You plus the hosts of the completed steps, each fading and scaling 0.8 → 1, 40 ms apart, with no flights. At 0.20 B[n]'s host face rises into the perch. At 0.32 B[n]'s own title entrance plays. At 0.52 its demo starts at t = 0. The Bar goes "Just a moment…" → B[n]'s CTA at 0.10. Resuming at B0 uses B0's fresh-member entrance. | — | as listed |
| B0 → B1 | **You** 88 → stack slot 0, and the **purple** face 88 → perch 40, with `matchedGeometryEffect` inside the tour host (`stage`). Fill yellow → purple. | White, yellow and gray shrink to 0.6 and fade into the Stage colour (0.25 s). | B1 develops from 0.52. |
| B1 → B2 | B2 opens on B1's last frame. Zoom; fill purple → gray. | Callout | Purple host → stack; yellow rises into the perch. |
| B2 → B3 | The mini bar persists. Fill gray → pink. | **Pink flood:** a pink rectangle fills the canvas from the top (height 0 → 540, `stage`, starting at 0.08 and settling ≈ 1.02), covering the event page. B3's beat 1 starts at 0.52, which is safe because it targets nothing. Beat 1's white layer then rises from the bottom. | Yellow host → stack; white pill rises into the perch. |
| B3 → B4 | Mini bar action → tabs. Fill pink → yellow. | **Blur-out:** challenge content goes blur 0 → 6 and opacity 1 → 0 over 0.25 s, while My Events develops in place (blur 6 → 0 over 0.4 s from 0.52). | White host → stack; gray rises into the perch. |
| B4 → B5 | The Stage's bottom edge rises 563 → 330 (`stage`, settles ≈ 1.02; the strip starts at 1.08). The copy rides the edge. | Album content stays anchored to the canvas top and is clipped by the rising edge; it doesn't fade. At 0.40 the canvas swaps to the strip, whose chips grow from Stage-coloured capsules. | Gray host → stack. Picker rows come out from under the edge, 30 ms apart, from 0.45. |
| B5 → H | Window reveal | Copy, picker | — |
| Back (any B) | The exact reverse. The previous host leaves the stack and returns to the perch. | — | same |

The canvas keeps one mini `DIPFloatingNavigation` from B1 to B4, matching the app's one-bar rule.

### 4.2 Progress: host faces and the Crew stack

- **Perch.** Each step from B1 to B4 has a host face perched on the Stage's top edge: 40 pt, x 322–362, y 114–154, in front of the Stage. It clears the header row (which ends at 114) and the `EXAMPLE` chip. Hosts: B1 purple round, B2 yellow square, B3 white pill, B4 gray round. B0's Crew are on the Stage itself, and B5 has no host.
- **Arrival.** A host rises from behind the Stage edge (+24 → 0, masked, `hop`) at 0.20 s into the step change.
- **Departure.** At 0.05 s into the CTA, the host flies to the stack with `KeyframeAnimator`. That is allowed in tour chrome, which is never scrubbed. Keyframes: up 30 pt at 0.18 s, into the slot at 0.50 s, scale 40 → 28 pt. It lands with `hop`.
- **Stack.**
  - Order: You (added at B0 → B1), then the hosts of completed steps.
  - The stack shows **at most 3 faces plus a "+n" disc**: You and the first two hosts as faces, then one 28 pt `surfaceMuted` disc reading "+n" (Inter Medium 12) for everyone after them. "n" rolls with `.numericText()` as hosts join.
  - Examples: B2 shows [You, P]. B3 shows [You, P, Y]. B4 shows [You, P, Y, "+1"]. B5 shows [You, P, Y, "+2"].
  - The stack is at most 82 pt wide. `OnboardingFlow.crewStackCount` (built P0) gives the member count; the view maps it to faces and the disc.
  - After a B5 save, You gains an 8 pt `actionPrimary` dot.
  - The stack is one VoiceOver element, e.g. "Step 2 of 5, Who's going".
  - Dropped steps leave no gap.

### 4.3 Colour choreography

The background is always white. These are the Stage fills:

| State | Fill |
|---|---|
| A0 / A1 / A2 | pink (one view; continuity is carried by the Bar and the Crew) |
| A3 blocked | purple |
| A3 notFound | yellow |
| A4 offline | gray |
| A4 problem | purple |
| B0 | yellow |
| B1 | purple |
| B2 | gray |
| B3 | pink |
| B4 | yellow |
| B5 | gray strip |
| H | clear window |

- Every pair of adjacent fills differs.
- `eventsAccent` is unused, because it is too close to pink.
- No text sits directly on yellow or pink.

## 5. Architecture and build plan

### Files

**`ui/Packages/DIPCore/Sources/DIPCore/Onboarding/`** — **built in P0**, on `origin/feature/onboarding-p0-core`. This spec matches that code. Nothing below needs an engine change except the one-line pill title (B5).

- **`OnboardingStep.swift`**
  - `enum OnboardingStep: String, CaseIterable, Codable` with cases `arrival`, `discover`, `people`, `challenges`, `memories`, `interests`.
  - Also provides `specID` ("B0"…"B5"), `hasHostFace` (B1–B4), and `availableSteps(features:catalogEmpty:includeArrival:)`.
  - Only `.challenges` and an empty catalog remove whole steps.
  - `OnboardingFeatures: OptionSet` has `.invites`, `.challenges`, `.points`, `.albums`, `.interestFilter` and `.all`.
- **`OnboardingFlow.swift`**
  - A value type with `mode` (`.firstRun`, `.replay`), `features`, `steps` and `phase` (`.step(OnboardingStep)` or `.handoff(OnboardingOutcome)`).
  - `init(mode:features:catalogEmpty:)`, plus **`static func resume(record:features:catalogEmpty:) -> OnboardingFlow`**.
  - Transitions return `Transition = (flow, effects)`: `next(at:)`, `back()`, `skip(at:)`, `beginHandoff(at:)`.
  - **`Effect` has only `.persist(OnboardingRecord)` and `.announce(String)`.**
  - Derived values: `currentStep`, `isHandingOff`, `canGoBack`, `showsSkip` (false on B5), `progress` (n of m, counting from B1), `crewStackCount`, `announcement(for:)`, and `OnboardingStep.pillTitle`.
  - The **resume entrance** (§4.1) is a **view-layer concern** in `OnboardingTourView`. It is played when the flow came from `resume` with a record whose `lastStep != nil`. It is *not* a P0 effect, and P0 needs no change for it.
- **`OnboardingRecordStore.swift`**
  - `OnboardingOutcome` (`.finished`, `.skipped`).
  - `OnboardingRecord` (`version`, `lastStep`, `outcome`, `updatedAt`, `isSupported`, `isComplete`; unknown step names decode as `nil`).
  - `protocol OnboardingRecordStore` with `record(for:)`, `save(_:for:)`, `isComplete(uid:)`, and `apply(_ effects:uid:)`.
  - `UserDefaultsOnboardingRecordStore(defaults:)` stores records under `dip.onboarding.v1.<uid>`.
- **`DemoTimeline.swift`**
  - **`enum AnimationSpec`** has six cases: `.spring(response:dampingFraction:)`, `.easeIn(duration:)`, `.easeOut(duration:)`, `.easeInOut(duration:)`, `.linear(duration:)` and `.none`.
    - There is no `.smooth`. `DIPMotion.section` is written as `.spring(response: 0.625, dampingFraction: 1.0)`.
    - `settleTime` is the decay envelope at `springSettleThreshold = 1e-4`. It runs about 4% below SwiftUI for the underdamped tokens and about 8% below for `section`.
  - **`OnboardingAnimation`** constants: `stage`, `expand`, `hop`, `copyOut`, `bar`, `affordance`, `marker` and `ghost`. The app adds `reveal`, `section` and the one-off springs in `OnboardingMotion`.
  - **`struct DemoBeat<Action>`**: `at`, `action`, **one** `animation`, `moves: Set<String>`, `targets: Set<String>`, `label`.
  - **`struct DemoScript<State>`**:
    - `init(initial:duration:beats:stills:continuous:)`, or the reducer form `init(initial:duration:beats:stills:reduce:continuous:)`.
    - `state(at:)`, `finalState`, `stillStates`, `beats(between:and:)`, and `scrubbedTime(from:dragging:)` at 12 ms per point.
    - It has no `name`; the tests pass one in.
  - **`script.validate() -> [DemoScriptIssue]`** checks **every** earlier beat whose `moves` intersects a beat's `targets`. Issues: `.startsBeforeSettle(beat:element:earlier:earliestStart:)`, `.beatOutsideTimeline(beat:)`, `.stillOutsideTimeline(_)`, `.stillsNotOrdered`.
  - `Duration.secondsValue` converts a `Duration` to seconds.
  - Each scene in §3 is built straight from its table: one `DemoBeat` per row, with `label` set to the row's label.

**`ui/DIP/Features/Onboarding/`** (NEW, app target)

- `Stage/DemoStage.swift`:
  - Renders on a 390 × 540 canvas with `.scaleEffect(0.691)`, `.compositingGroup()`, `.allowsHitTesting(false)` and `.environment(\.dynamicTypeSize, .large)`.
  - Is one accessibility element: `.accessibilityElement(children: .ignore)`, label "Example", value = description, identifier `onboarding.stage`, action "Replay".
  - **Playback:** a `Task` on `ContinuousClock` sleeps until each beat and applies its discrete state inside `withAnimation(spec.swiftUI)`.
  - **Continuous values** inside a beat are driven by a `TimelineView(.animation(paused: !playing))` that exists only for that beat. Keyframed values use `KeyframeTimeline.value(time:)`.
  - **Scrubbing** sets `t` and applies state with no animation.
  - **Pausing** happens on `onDisappear` and when `scenePhase != .active`. Playback resumes from the current beat's start.
- `Stage/DemoScene.swift`, `GhostTouch.swift`, `DemoCallout.swift`, `DemoInviteChip.swift` (a placeholder until F4).
- `Scenes/DiscoverJoinScene.swift`, `PeopleInviteScene.swift`, `ChallengeScene.swift`, `MemoriesScene.swift`, `InterestStripScene.swift`.
- `Fixtures/OnboardingDemoFixtures.swift`: Crew PNGs rendered once, `ImageRenderer(content:).uiImage?.pngData()` → `MediaReference.data`.
- `Tour/OnboardingTourView.swift`: header (overflow rule), Stage, perch, entrances, resume entrance, Bar, focus, accessibility-size layouts.
- `Tour/WindowSheet.swift` and `Tour/HandoffController.swift`: the surface wait, the four bar cases, replay.
- `Tour/OnboardingCopy.swift`: String Catalog keys.

**`ui/DIP/Features/Accounts/`**

- `AccountsOnboarding.swift`: the `.pending` / `.resolving` route split.
- `AccountsStageView.swift` (NEW).

**Character rig.** Move the faces to `Features/Shared/Characters/OnboardingFaces.swift`. `FaceFeatures` gets three animatable values:

```swift
var smile: Double     // −1 worried … 0 calm … 1 happy (mouth control y: mouthY − 0.12h … mouthY + 0.16h)
var eyeOpen: Double   // right eye: 1 open … 0 winked
var gaze: Double      // −1 … 1: eyes x ± 0.06w, mouth x ± 0.03w
var animatableData: AnimatablePair<Double, AnimatablePair<Double, Double>> {
    get { AnimatablePair(smile, AnimatablePair(eyeOpen, gaze)) }
    set { smile = newValue.first; eyeOpen = newValue.second.first; gaze = newValue.second.second }
}
```

- **Right eye.** One straight stroke through the eye centre, at angle θ = 90° · eyeOpen with half-length L = lerp(eye / 1.5, eye / 2, eyeOpen).
  - At eyeOpen = 1: vertical, length `eye` (today's open eye).
  - At eyeOpen = 0: horizontal, length 1.33 · `eye` (today's wink).
  - At eyeOpen = 0.5: a 45° stroke with half-length 0.58 · `eye`.
  - Only angle and length interpolate, so the change is continuous.
- **Wink timing.**
  - It closes over **0.12 s (about 7 frames at 60 fps)**, holds 0.3 s, and opens over **0.16 s (about 10 frames)**, easeInOut both ways.
  - Through the middle of each half, the stroke passes through the diagonal for about 2–3 frames, which reads as a squint.
- **Moods map to presets** (smile, eyeOpen, gaze): happy (1, 1, 0), calm (0, 1, 0), worried (−0.6, 1, 0), wink (1, 0, 0). Existing callers are unchanged.

**Integration points.**

- `DIPMemberHome.body`:
  - a `ZStack` with `OnboardingTourView` when `!store.isComplete(uid: context.uid)`
  - passes `editor`, `catalog`, the name, `OnboardingFeatures` and `onSurfaceChange`
  - the content underneath has `allowsHitTesting(false)` and `accessibilityHidden(true)` while the tour is up
- `DIPPrototypeApp`: reports `activitiesLoading`, `activitiesError` and `ready` through `onSurfaceChange` (NEW). `DIPMemberHome` reports `shellLoading` and `shellUnavailable` itself.
- `DIPParticipantsScreen`: extract `DIPParticipantRow` (NEW, no visual change).
- `DIPProfileScreen`: the "How DIP works" row (NEW).
- `DIPInterestPicker`: the embedded initializer (NEW).

**Shared choke points** (integrator PR, additive only).

- `DIPBottomBarAction.showsProgress: Bool = false` (NEW).
- `DIPFloatingNavigation.barCenterInset = 61` and `horizontalInset = 20` (NEW constants), used by `DIPPrototypeApp`, `DIPEventDetailsScreen`, `DIPParticipantsScreen`, `WelcomeView` and the tour.
- `DIPFloatingNavigation(tabs:)` (NEW, defaults to all tabs). Demos pass `[.home, .events, .profile]`.
- `EventBarAction.resolve(route:snapshot:pending:)` (NEW), extracted from `bottomAction` with no change in behaviour.
- `DIPHomeScreen.profileButtonFrame(width:)` (NEW).

### Demos reuse real components safely

- Demos get fixture values and no-op closures only, and no repository.
- The canvas is one non-interactive accessibility element.
- The demos call the same initializers the app uses.
- They compose subcomponents wherever a full screen would bring in chrome that is out of scope or depends on layout: the bell in `DIPHomeHeader`, the top padding in `DIPDetailHeader` and `DIPParticipantsScreen`.

### Tests

**DIPCore unit tests.**
- **Flow** (exists in P0): every transition; back at the first step; skip from each step (header Skip → `.skipped`; B5 "Skip for now" → `next()` → `.finished`); handoff idempotency; `resume` returning the stored step, or clamping forward when a flag removes it; `crewStackCount` per step; replay never persists; version mismatch.
- **Resume entrance (app test):** `OnboardingTourView` chooses the resume entrance exactly when it built its flow with `resume` from a record with `lastStep != nil`.
- **Store:** round trip on `UserDefaults(suiteName:)`, uid isolation, `isComplete`.
- **Timeline:** determinism; forward and backward scrubbing converge; the final state equals the end of the fold; stills are ordered; continuous parameters are monotone where specified.

**App unit tests.**

- `AccountsRoute` split.
- `AccountsStageView` mapping from route → formation, colour and Bar, including the A4 → A0 retry look.
- `EventBarAction.resolve` matches today's `bottomAction` on a regression table.
- The B5 edit carries the editor's department and city.
- `catalogOrdered` keeps catalog order and drops unknown ids.
- The embedded picker never dismisses and shows no retry button.
- **Beat timing — the binding gate.** This runs in the app test target, which can import SwiftUI, against SwiftUI's own `settlingDuration`, using the built P0 types. Every scene script runs through it: `DiscoverJoinScene.script`, `PeopleInviteScene.script(features:)` with and without `.invites`, `ChallengeScene.script(features:)` with and without `.points`, and `MemoriesScene.script`.

  ```swift
  import DIPCore
  import SwiftUI
  import XCTest

  /// SwiftUI's settle time for a P0 AnimationSpec.
  func swiftUISettle(_ spec: AnimationSpec) -> Double {
      switch spec {
      case .spring(let response, let dampingFraction):
          return Spring(response: response, dampingRatio: dampingFraction).settlingDuration
      case .easeIn(let duration), .easeOut(let duration), .easeInOut(let duration), .linear(let duration):
          return duration
      case .none:
          return 0
      }
  }

  func assertBeatsSettle<State>(_ script: DemoScript<State>, name: String,
                                file: StaticString = #filePath, line: UInt = #line) {
      // The engine's own check (its estimate runs below SwiftUI's) must pass too.
      XCTAssertEqual(script.validate(), [], "\(name): DemoScript.validate()", file: file, line: line)
      for (index, beat) in script.beats.enumerated() {
          for earlier in script.beats[..<index] {
              for element in earlier.moves.intersection(beat.targets).sorted() {
                  let earliest = earlier.at.secondsValue + swiftUISettle(earlier.animation)
                  // 1e-9 absorbs Duration/Double rounding only; it isn't a timing tolerance.
                  XCTAssertGreaterThanOrEqual(
                      beat.at.secondsValue + 1e-9, earliest,
                      "\(name): \(beat.label) targets \(element) before \(earlier.label) settles",
                      file: file, line: line)
              }
          }
      }
  }

  final class DemoTimingTests: XCTestCase {
      func testDiscoverJoin() { assertBeatsSettle(DiscoverJoinScene.script, name: "B1") }
      func testPeople() {
          assertBeatsSettle(PeopleInviteScene.script(features: .all), name: "B2")
          assertBeatsSettle(PeopleInviteScene.script(features: []), name: "B2 without invites")
      }
      func testChallenges() {
          assertBeatsSettle(ChallengeScene.script(features: .all), name: "B3")
          assertBeatsSettle(ChallengeScene.script(features: [.challenges]), name: "B3 without points")
      }
      func testMemories() { assertBeatsSettle(MemoriesScene.script, name: "B4") }
  }
  ```

  - This loop checks every earlier mover, exactly like `validate()`. Stagger tails are ordinary beats, so they are covered automatically.
  - Tightest margins against SwiftUI:
    - B2 `ghostMore`: 0.96 vs 0.946
    - B4 `pastPage`: 4.75 vs 4.73 (callout exit)
    - B1 `ghostIn`: 2.62 vs 2.60
    - B1 `ghostToBar`: 3.82 vs 3.768
    - B3 `progress1`: 4.72 vs 4.668
    - B3 `dim`: 7.40 vs 7.367
  - A separate DIPCore test asserts that each `OnboardingAnimation` token's `settleTime` is no more than SwiftUI's §3.0 value and no less than 0.9 × that value. That documents the engine's known underestimate.
- **WindowSheet halfway interpolation:**

  ```swift
  func testWindowSheetInterpolatesHalfway() {
      let start = WindowSheet(window: CGRect(x: 20, y: 134, width: 362, height: 429), radius: 20)
      let end = WindowSheet(window: CGRect(x: 0, y: 0, width: 402, height: 874), radius: 0)
      var delta = end.animatableData
      delta -= start.animatableData
      delta.scale(by: 0.5)
      var data = start.animatableData
      data += delta
      var mid = start
      mid.animatableData = data
      XCTAssertEqual(mid.window, CGRect(x: 10, y: 67, width: 382, height: 651.5))
      XCTAssertEqual(mid.radius, 10, accuracy: 0.0001)
      let bounds = CGRect(x: 0, y: 0, width: 402, height: 874)
      XCTAssertFalse(mid.path(in: bounds).contains(CGPoint(x: 201, y: 400), eoFill: true)) // inside the hole
      XCTAssertTrue(mid.path(in: bounds).contains(CGPoint(x: 5, y: 5), eoFill: true))      // sheet
  }
  ```

- **H surface → bar treatment and focus target** for all five surfaces.

**UI tests (`DIPUITests`).**

- **Debug launch arguments:**
  - `-onboarding.reset`
  - `-onboarding.timeScale 8`
  - `-onboarding.reduceMotion`
  - `-onboarding.resumeAt <step>`
  - `-onboarding.freezeAt <scene>@<seconds>` (renders `state(at:)` with animations off, for §7)
  - `-home.surface <case>` (forces an H surface through the mock)
- **Flows:**
  - first run to Home
  - skip at B2
  - kill and relaunch at B3, which resumes with the resume entrance
  - the tour is not shown on second launch
  - replay
  - interest save failure, then retry from the Bar
  - each H surface: (a) the bar is gone and focus is on the loading or unavailable label; (b) tabs; (c) tabs and focus on `data.retry`
- **Accessibility audit.** Run `performAccessibilityAudit()` on every step, at the default size and at AX XXXL. The issue handler ignores only:
  - `.dynamicType` and `.textClipped` on `onboarding.stage`, which is one fixed-size element by design
  - `.dynamicType` on the Bar's action identifiers: today's Figtree 24 with `minimumScaleFactor(0.4)`, existing debt tracked under F6

  Everything else fails the test.
- **Figma comparison.** iPhone 17 Pro screenshots from `freezeAt`, reviewed side by side with §7. This is a manual review, not a pixel gate.

**Render checks.** Final states and stills are rendered with `ImageRenderer`. GIFs go to `ui/ComponentPreview/Review/Motion/onboarding-*.gif`.

**Manual checks.** VoiceOver, Low Power Mode, and iPhone SE, 12 and 17 Pro, recorded in the session log.

### Accessibility-size layouts (summary)

At `isAccessibilitySize`, every step scrolls with the Bar pinned, and the header wraps to two rows.

| Step | At accessibility sizes |
|---|---|
| A1 / A2 | No Stage |
| A3 / A4 | No face card |
| B0 | A 56 pt You avatar |
| B1–B4 | SF Symbol rows (B3 has four) |
| B5 | Picker only |

Focus order: pill (header, "Step n of m") → title (header) → body → Stage description → Bar → Skip → Back. Each step change moves `@AccessibilityFocusState` to the title. Back is also available as an accessibility action, "Previous step".

### Performance budget

- 60 fps on iPhone 12, with a hitch ratio under 5 ms/s during every transition and beat.
- At most 12 views animating at once.
- **Idle means no animation is running.** Once a demo rests, nothing redraws.
- **Loops that run while visible:**
  - the A0/A2 progress band and the B5 loading shimmer: one gradient offset per frame on the main thread
  - the A2 gaze: four face paths per frame
  - the Welcome reel: one spring every 2.4 s, for 3 cycles

  Each stops when its route or state is left, or when `scenePhase != .active`. The reel and gaze are off in Low Power Mode.
- Per-beat `TimelineView`s live only for their beat. No `Canvas`.
- Images are pre-decoded at 2× the canvas size one step ahead. Crew PNGs are rendered once.
- At most +30 MB memory during the tour.
- **Low Power Mode** (`isLowPowerModeEnabled` plus `NSProcessInfoPowerStateDidChange`): no reel or gaze, and demos open on their final frame.

### Phased delivery

S ≈ 1 day, M ≈ 2–3 days, L ≈ 4–6 days.

| Phase | Scope | Size | Depends on |
|---|---|---|---|
| P0 | DIPCore flow, store and timeline, with tests; route split; Profile row; skip and resume plumbing behind a flag | S–M | approval of O |
| P1 | `AccountsStageView` (A0–A4): rig, formations, colours, retry paths, Bar progress, Reduce Motion and accessibility sizes | M | integrator PR (`showsProgress`, bar constants) |
| P2 | Tour shell: layout and overflow rule, entrances, colours, perch and stack, back and skip, B0, resume entrance, `WindowSheet`, `onSurfaceChange` with the four bar cases | L | P0, P1 |
| P3 | DemoStage engine + B1 | M | P2, `EventBarAction`, `tabs:` |
| P4 | B5 + embedded picker; reshape when F1 lands | M | P2; F1 |
| P5 | B4 | S–M | album mock or F5 |
| P6 | B2 + `DIPParticipantRow` | M | F4 replaces `DemoInviteChip` |
| P7 | B3 | M | F3 form and deadline field, F2 balance |
| P8 | Polish: haptics, Instruments, GIFs, audits, Figma comparison | S | all |

P0–P4 is the realistic V2 target. P5–P7 switch on as their features land.

## 6. Risks, open decisions and inputs needed

### Risks and hard parts

- **No matched geometry across the account → member swap.** Continuity relies on identical first frames, guarded by a test that compares A2's last-frame geometry constants with B0's first frame.
- **No anchor preferences through `UIPageViewController`.** `DIPSlidingPages` hosts Home in UIKit. Hence the window sheet and the shared profile-button constant.
- **Five shell surfaces.** Only the three `DIPPrototypeApp` surfaces have a bar underneath, because its `DIPFloatingNavigation` is always drawn as a `ZStack` sibling. The "no pixel change" guarantee holds for (b), (c) and (d). Case (a) fades the Bar out. If the shell's structure changes, the surface table and its unit test must change with it.
- **Spring timing.** Beats are timed against SwiftUI's measured `settlingDuration` (a residual of about 0.01%, not 1%). There is no tolerance and no headroom claim. The engine's own estimate runs about 4% low (8% for `section`), so the SwiftUI-reading XCTest is the binding gate. The `moves` / `targets` validator and the XCTest above enforce this. Changing a spring re-checks every dependent beat automatically. One consequence: demos run longer (B1 6.6 s, B2 10.2 s, B3 9.8 s, B4 9.5 s). Each still rests after one play, and the step's CTA is live throughout, so nobody has to wait.
- **Scaled canvases.** `matchedGeometryEffect` ignores `scaleEffect`, so matching happens only inside the canvas or only inside the tour chrome.
- **Scrubbing.** Only values driven by `state(at:)` scrub. A `KeyframeAnimator` or a `ScrollView` scroll inside a demo would break scrubbing and `freezeAt`. Code review checks for this.
- **Demo drift.** Ghost targets are canvas coordinates. Render checks, `freezeAt` captures and GIF re-recording in the design-system PR template catch drift.
- **Placeholders.** `DemoInviteChip`, the F3 entry form and deadline line, and the F2 balance must be redrawn when their features land.
- **Figma staleness.** The build wins. Frames are redrawn from `freezeAt` captures.
- **Schedule.** This is significant polish on an uncommitted item, 24 days before release. Start P0–P3 only once F1–F4's core rows are on track.
- **Localization.** Captions type by grapheme cluster. Long German Bar titles rely on the existing 0.4 minimum scale. Pill labels may truncate under the overflow rule. Callouts wrap to 2 lines.

### Open decisions

1. **Joined bar title.** The app ships "Activity Chat" (`.accent`, chat icon). The demo mirrors it through `EventBarAction.resolve`. Chat is the stretch item V2-S01, and testers expected a real conversation. If chat doesn't ship, should the joined state read **"You're going"** in `.complete` style? The app decides this, and the demo follows.
2. **Filter preselection.** Should Home filter by saved interests by default (F1 decision 2)?
3. **Re-showing the tour.** Re-show once for a future content version (key `v2`), or never?
4. **Demo content approval.** Names (Maya, Theo, Jun, Priya), "Coffee with 3" and "Ends Friday".
5. **F4's invite control.** Its placement replaces `DemoInviteChip` and sets B2 beat 4's ghost target.

### Needed from others

- **Owner:** approve O. This replaces O1, and O2 merges into B5.
- **Integrator:** `showsProgress`, the bar constants, `tabs:`, `EventBarAction`, `profileButtonFrame`, `onSurfaceChange`, `DIPParticipantRow`.
- **F0:** hide the Rewards (gift) tab and the bell; settle the past-events label.
- **F1 / F2 / F3 / F4:** the chip row, balance, entry form with deadline, and invite control and card.
- **Design review:** the colour sequence, entrances and rig, judged on the §7 frames and the GIFs.
- **Figma builder:** the §7 frames on an "Onboarding" page in `DCIagJo7uk5IOUGqlKzAjf`, reviewed before anything is published.
- **Copy:** one pass on the challenge explanation by a reader outside the team.

## 7. Figma reference frames

All frames are **402 × 874** (iPhone 17 Pro points). They are named by the step IDs used above and listed in flow order.

- §7.2 is the **primary flow, 24 frames**.
- §7.3 lists **variants**: Reduce Motion, accessibility sizes, other tones, intermediate beats, and the H surfaces.
- §7.4 maps the 24 frames already drawn in the draft file (round-1 names) to their new names, so the builder can rename instead of redrawing.

Captures refer to `-onboarding.freezeAt`.

### 7.1 Conventions

**Colours.**

| Token | Hex |
|---|---|
| `surfaceDefault` | #FFFFFF |
| `surfaceMuted` | #ECECEC |
| ink | #1E212B |
| `actionPrimary` | #7B88FA |
| `challengeAccent` | #FB72E4 |
| `notificationAccent` | #FFCC3E |
| `actionComplete` | #CCCCCC |

**Fonts.** Fjalla One Regular; Figtree Regular and Bold; Inter Regular, Medium and Light Italic.

**Radii.** Card 20, pill 25, and the Bar is a full capsule.

**Characters.** `OnboardingFace` is an ink disc with a coloured figure offset 16% down, with ink strokes for the features.
- **P** = purple round, **W** = white pill, **Y** = yellow square, **G** = gray round.
- **You** = `DIPAvatar` with initials "S" on #ECECEC and a 3 pt white ring.

**Tab-bar rule (no mixing).** The tab icons are, in order: Home (`HeroiconsSolidHome` / `profile_HeroiconsOutlineHome`), **Rewards = gift** (`HeroiconsOutlineGift`, `navigation_HeroiconsSolidGift` when selected), My Events (squares), Profile (user circle).
- **Demo mini bars** inside the canvas (B1, B4) always pass `tabs: [.home, .events, .profile]`. They show **three tabs and no gift**, in every frame.
- **The real Bar** (A frames when tabs show, every H frame) is drawn **as built**. Until F0 lands that is four tabs including the outline gift; after F0 it is three.
- All real-bar frames in the file must use the same choice. Mark the choice in the page's cover note, and never mix the two on one page.

**Home rule (header, weekly challenge card, empty sections).** Wherever a frame draws Home (B1's canvas edge, every H frame), draw it as the owner's current design and `DIPHomeScreen` lay it out, top to bottom:

- **Header** (y 60–110). The purple "Home" pill, and the profile avatar alone in its gray capsule, at x 337, y 65, 40 × 40. **The bell is drawn hidden** (note: "bell hidden per F0, V2-S05 stretch").
  - **Pre-F0 rule (same idea as the tab-bar rule).** Until F0 lands, the build still shows the bell and its unread count to the left of the avatar.
  - Frames show the target state, without the bell. Screenshot comparisons before F0 must expect exactly that one difference.
  - The avatar's position is the same either way, because it is the capsule's trailing element.
- **"This Week's Challenge"** (section title Figtree 18, y ≈ 125). Below it, the **`DIPChallengeCard`**: the pink #FB72E4 card, 362 × 225, radius 20, with the **Fitness illustration** (the `Mascot` artwork), "FITNESS" in Fjalla One 40 white, and the white "+ N others participating" capsule with the ↗ circle. Drawn as in the owner's design.
- **"Upcoming events"** (Figtree 20): a horizontal row of `DIPPhotoEventCard`s, 163 × 205.
- **"Attended Your Recent Events:"**: 40 pt avatars plus the ink "See All" capsule.
- **Sections that can be empty** (draw the empty form in the not-ready variants, and note it):
  - The challenge section is **absent** when `home.challenge == nil`. There is no placeholder; "Upcoming events" moves up.
  - The events row shows **"No upcoming events yet."** when there are none.
  - "Attended Your Recent Events:" shows **only the "See All" capsule** when there are no recent attendees. That is Home's empty state for recents.

**Sign-in geometry.**
- Status bar y 0–62.
- Stage x 20, y 60, 362 × 225.
- Title x 20, y 307, Fjalla One 40. Body Inter 16.
- Footnote Inter 13, y ≈ 729–761.
- Secondary Figtree 17, y 717–761.
- **Bar x 20, y 773–853**: Figtree 24 white; icon circle 64 pt, 8 pt inset.

**Tour geometry.**
- **Header** y 70–114:
  - back 44 pt at x 20
  - pill from x 72: #7B88FA, Figtree 20 white, 16 pt padding
  - stack 10 pt after the pill: 28 pt faces at an 18 pt step, at most 3 faces plus a "+n" disc
  - Skip: trailing at x 382. Its hit area is `max(44, labelWidth + 16)`, so at default size it spans x 333–382 and grows with the label.
  - pill + stack must end by `skip.minX − 8` (≈ 325 at default size)
- **Stage** x 20, y 134, 362 × 429. `EXAMPLE` at x 32, y 145.
- **Perch** 40 pt at x 322, y 114.
- **Canvas** x 66, y 174, 269.5 × 373: 390 × 540 at 0.691. The canvas mini bar is at canvas y 439–519.
- **Replay** at x 336, y 507.
- **Title** x 20, y 585, Fjalla One 34. Body Inter 16.
- **Bar** x 20, y 773–853.

**Callouts.** Place them to the right of the frame: Inter Medium 13, ink on #ECECEC, radius 8, with a 1 pt connector. Use the text exactly as given.

### 7.2 Primary flow (24 frames)

**P1 · `Onboarding / A0 Pending / cold launch`**
- **Capture:** `pending@0.30`
- **On screen:**
  - Empty Stage #FB72E4 at 80% opacity, fading in.
  - No title.
  - Bar "Just a moment…" with the white 25% band at x ≈ 120.
- **Callouts:**
  - "Stage fades in · 0.25 s easeOut"
  - "Band offset sweep · linear 1.4 s · while pending"

**P2 · `Onboarding / A1 Welcome / rest`**
- **Capture:** `welcome@3.0`
- **On screen:**
  - Stage #FB72E4 with P, W, Y, G at 88 pt (−19 overlap, centre y 196).
  - Pill "Board game lunch" (white, 32 tall, Inter 15) at y 98.
  - Title "MEET YOUR TEAM OUTSIDE WORK".
  - Body "Board games, cooking nights, hikes and more. See which coworkers are going and join in one tap."
  - Footnote "Use your work Google account. We find your company from your email."
  - Bar "Continue with Google".
- **Callouts:**
  - "Faces grow from Stage colour · scale 0.6 → 1 · spring 0.36 / 0.62 · 60 ms stagger"
  - "Title rises from behind Stage edge · −36 → 0 · spring 0.55 / 0.86"

**P3 · `Onboarding / A2 Resolving / looking`**
- **Capture:** `resolving@0.9`
- **On screen:**
  - As P2, but the faces' eyes are shifted right (gaze +1).
  - Pill "Looking for your team…". Body at 45%.
  - Bar "Finding your company…" with the band at x ≈ 165.
- **Callouts:**
  - "Band sweep · linear 1.4 s · while resolving only"
  - "Gaze −1 → +1 → 0 · 1.2 s easeInOut · while resolving only"
  - "Body dims to 45% · 0.30 s"

**P4 · `Onboarding / A3 No company / personal email`**
- **Capture:** `blocked@1.0`
- **On screen:**
  - Stage #7B88FA. Y at 120 pt, worried, centre y 172. P, W, G at 88 pt, 28 pt back, 35% opacity.
  - Title "USE YOUR WORK ACCOUNT".
  - Body "DIP finds your company from your work email, so personal Gmail and iCloud accounts can't join."
  - Bar "Use a different account".
  - Copy variants:
    - "THIS ACCOUNT BELONGS TO ANOTHER COMPANY" / "Sign in with the Google account you use at that company."
    - "WE COULDN'T VERIFY THIS ACCOUNT" / "Sign in with a work Google account that has a verified email."
- **Callouts:**
  - "Stage pink → purple · spring 0.55 / 0.86"
  - "smile 1 → −0.6 · 0.40 s · others back 28 pt, 35%"
  - "Title drops from Stage edge · spring 0.40 / 0.80 · haptic .warning once"

**P5 · `Onboarding / A4 Problem / offline`**
- **Capture:** `offline@1.0`
- **On screen:**
  - Stage #ECECEC. A white round face at 120 pt, calm. G and P at 64 pt, 35% opacity, linked by a dashed 2 pt ink line, broken in the middle.
  - Title "YOU'RE OFFLINE". Body "Check your connection, then try again."
  - Secondary "Sign out". Bar "Try again".
- **Callouts:**
  - "Stage pink → gray · spring 0.55 / 0.86"
  - "Link breaks · trim 1 → 0.4 · 0.35 s easeOut · once"
  - "Try again → A0 retry look → Resolving (restart)"

**P6 · `Onboarding / B0 Arrival / rest`**
- **Capture:** `arrival@1.4`
- **On screen:**
  - Header: "Skip" only.
  - Stage #FFCC3E, tour geometry. P, W, Y, G at 88 pt, spread 24 pt, with You at 88 pt in the centre. Y winks.
  - Title "YOU'RE IN, SAM".
  - Body "Here's how DIP gets your team together. It takes about a minute."
  - Bar "Show me around".
- **Callouts:**
  - "Stage y 60 → 134, 225 → 429, pink → yellow · spring 0.55 / 0.86"
  - "You grows from Stage colour · 0.4 → 1 · spring 0.36 / 0.62 · 0.25 s"
  - "Title word by word · 70 ms apart"

**P7 · `Onboarding / B0→B1 Transition / You to stack`**
- **Capture:** `transition.arrival-discover@0.40`
- **On screen:**
  - Stage halfway from #FFCC3E to #7B88FA.
  - You at about 50 pt, flying to stack slot 0, which is at pill.maxX + 10 (the pill "Find events" ends at x ≈ 209).
  - P at about 60 pt, moving to the perch.
  - W, Y, G at scale 0.6 and 30% opacity.
  - Bar "See who's going".
- **Callouts:**
  - "You 88 → 28 · matched geometry · spring 0.55 / 0.86"
  - "Purple 88 → 40 to perch · same spring"
  - "Others shrink into Stage colour · 0.25 s"

**P8 · `Onboarding / B1 Discover & Join / beat 1 develop`**
- **Capture:** `discover@0.30`
- **On screen:**
  - Header: pill "Find events" (x 72–209), stack [You] at 219; perch P.
  - Canvas mostly purple, with a circular white reveal at about 55% radius. Inside it: the 20 pt pink bottom edge of the weekly challenge card at the canvas top (Home rule), then "Upcoming events", the "BOARD GAME LUNCH" card (cover_games, "5 Attending") and "PASTA NIGHT" (cover_cooking), at 0.97.
  - Title half-wiped from the left.
  - Body "Company events, from lunchtime board games to weekend hikes. Tap Join once and you're on the list."
  - Bar "See who's going".
- **Callouts:**
  - "Radial develop · 0 → 340 · spring 0.55 / 0.86 (settles 0.946 s)"
  - "Cards 0.94 → 1 · spring 0.50 / 0.86 · 50 ms stagger"
  - "Title wipe · 24 pt feather · 0.45 s easeOut"

**P9 · `Onboarding / B1 Discover & Join / beat 4 event page`**
- **Capture:** `discover@3.78`
- **On screen (canvas):**
  - `DIPDetailHero` cover_cooking, 350 × 264, radius 20, top 90 cropped.
  - "PASTA NIGHT" (Fjalla One 40).
  - `DIPDetailPeopleRow`: "Who's Attending", "5 of 12", P, Y, G at 40 pt, and the "+ 2 More" ink capsule.
  - Action row: "Directions" (#7B88FA) and "Share Event" (#F054A5, the component's own share colour).
  - Mini bar "Join the Activity" in ink, with the ghost on it.
- **Callouts:**
  - "Card → hero · matched geometry · radius 20 throughout · spring 0.50 / 0.86"
  - "Rows grow from hero bottom edge · 60 ms apart"
  - "Tabs → 'Join the Activity' · crossfade 0.30 s easeOut"

**P10 · `Onboarding / B1 Discover & Join / beat 6 joined`**
- **Capture:** `discover@5.80` (callout visible; it exits at 6.25)
- **On screen:**
  - Mini bar #7B88FA, "Activity Chat", with a white 64 pt circle holding `event_HeroiconsOutlineChatBubbleOvalLeft`.
  - People row: P, Y, G, You; "6 of 12"; "+ 2 More".
  - Action row: "Leave Activity" (ink) and "Share Event".
  - Callout "Joined. That's it." Replay is visible.
- **Callouts:**
  - "Fill ink → purple + title crossfade · 0.30 s · mirrors app (EventBarAction.resolve)"
  - "Icon circle 0.3 → 1 · spring 0.45 / 0.68"
  - "'5 of 12' → '6 of 12' numeric roll · ring pulse 0.5 s"

**P11 · `Onboarding / B1→B2 Transition / host face to stack`**
- **Capture:** `transition.discover-people@0.35`
- **On screen:**
  - Stage halfway from #7B88FA to #ECECEC.
  - P at about 32 pt, in mid-arc to the stack.
  - Y half-risen behind the Stage edge at the perch.
  - Canvas zoomed to 1.12 on the people row.
  - Title "GO WITH PEOPLE YOU KNOW" with its words ±9 pt apart.
  - Pill "Who's going".
- **Callouts:**
  - "Host → stack · up 30 pt at 0.18 s, slot at 0.50 s · 40 → 28 pt"
  - "Next host rises · +24 → 0 · spring 0.36 / 0.62"
  - "Words gather · ±18 → 0 · spring 0.36 / 0.62"

**P12 · `Onboarding / B2 People & Invites / beat 2 participants`**
- **Capture:** `people@2.10`
- **On screen:**
  - Stack [You, P]; perch Y.
  - Canvas: a white panel (radius 20) growing from "+ 2 More", with `DIPParticipantRow`s (75 pt each, 5 pt horizontal padding, 4 pt spacing) and an `attendees_Line2` divider after every row except the last. The dividers are drawn by the panel, not the row:
    - Maya · Design
    - Theo · Engineering
    - Jun · Finance
    - You

    Each row has a 50 pt avatar, the name in Figtree Bold 18 and the department in Figtree Regular 18.
  - Body "See who's going before you decide. Invite a coworker and they can join in one tap."
  - Bar "What are challenges?".
- **Callouts:**
  - "Panel grows from '+ 2 More' · 0.3 → 1 · spring 0.50 / 0.86"
  - "Zoom 1.35 → 1 · spring 0.55 / 0.86"

**P13 · `Onboarding / B2 People & Invites / beat 4 invite sheet`**
- **Capture:** `people@5.10`
- **On screen:**
  - `DemoInviteChip` "Invite a coworker" **[placeholder until F4]**.
  - A sheet (top radius 20) with three participant rows; "Priya · Design" checked with a #7B88FA `checkmark.circle.fill`.
  - `DIPButton` "Send invite".
- **Callouts:**
  - "Sheet grows from chip · spring 0.55 / 0.86"
  - "Check · spring 0.36 / 0.62"

**P14 · `Onboarding / B2 People & Invites / beat 7 Priya's view`**
- **Capture:** `people@7.55`
- **On screen:**
  - Chip reads `PRIYA'S VIEW`.
  - Card **[placeholder until F4]**: avatar G, "Theo invited you to Pasta Night" (Figtree 18), "Thu · 6:30 PM · Office kitchen" (Inter 14), "Accept" (#7B88FA) and "Decline" (#ECECEC).
  - The ghost is on Accept.
- **Callouts:**
  - "Flip · 0 → 90° 0.26 s easeIn, −90° → 0° 0.30 s easeOut"
  - "Accept → collapse · spring 0.55 / 0.86 · then '7 of 12', '+ 3 More'"

**P15 · `Onboarding / B2→B3 Transition / pink flood`**
- **Capture:** `transition.people-challenge@0.30`
- **On screen:**
  - Stage halfway from #ECECEC to #FB72E4.
  - The canvas has been flooded pink from the top to about 60% of its height, covering the event page.
  - Y in flight to the stack; W rising into the perch.
  - Title "TAKE ON A CHALLENGE" at scale 1.06 and 60% opacity.
- **Callouts:**
  - "Pink flood from top · height 0 → 540 · spring 0.55 / 0.86"
  - "Title stamp · 1.12 → 1 · spring 0.30 / 0.70"

**P16 · `Onboarding / B3 Challenges & Points / beat 2 requirements`**
- **Capture:** `challenge@2.70`
- **On screen:**
  - Stack [You, P, Y]; perch W.
  - Canvas: a pink band "COFFEE WITH 3" (Fjalla One 40, white).
  - Lines in Inter 16:
    - "1 Have coffee with 3 coworkers you haven't met"
    - "2 Send your count, a caption and a photo if you like"
    - "3 Your organizer approves it"
  - `calendar` "Ends Friday" (Inter 14). "+50 points" (Figtree 18). Callout "How to submit".
  - Mini bar "Add Your Entry".
  - Body "Each challenge shows what to do, how to send it in and when it ends. Once your organizer approves, the points are yours."
  - Bar "And after the event?".
- **Callouts:**
  - "White background rises behind the card · 0 → 540 · spring 0.55 / 0.86"
  - "Lines wipe in · 120 ms apart · deadline at 1.76 s"

**P17 · `Onboarding / B3 Challenges & Points / beat 6 points`**
- **Capture:** `challenge@8.85` (arc apex)
- **On screen:**
  - Entry **[placeholder until F3]**: "3 coworkers", "Met Jun from Design", thumbnail album_Rectangle931.
  - Pill "Approved" (#7B88FA).
  - The "+50" token (Figtree 20, ink on #FFCC3E) at the arc's apex.
  - "120 points" pill **[placeholder until F2]**.
- **Callouts:**
  - "Yellow → purple 'Approved' · 0.30 s"
  - "'+50' arc · KeyframeTimeline · 0.55 s · scrubbable"
  - "Balance 120 → 170 · numeric roll · 0.40 s"

**P18 · `Onboarding / B3→B4 Transition / blur into My Events`**
- **Capture:** `transition.challenge-memories@0.60`
- **On screen:**
  - Stage halfway from #FB72E4 to #FFCC3E.
  - Challenge content at blur 6 and 20% opacity, over the My Events list developing at blur 4.
  - The mini bar showing three tabs with the marker still on Home.
  - W in flight; G rising into the perch.
  - Title "KEEP THE MEMORIES" at blur 4.
- **Callouts:**
  - "Challenge blur 0 → 6, fade · 0.25 s"
  - "My Events develops · blur 6 → 0 · 0.4 s from 0.52 s"
  - "Title develops · blur 8 → 0 · 0.5 s easeOut"

**P19 · `Onboarding / B4 Memories / beat 1 My Events`**
- **Capture:** `memories@1.70`
- **On screen:**
  - Header: stack [You, P, Y, "+1"]; perch G.
  - Stage #FFCC3E.
  - Canvas: the My Events upcoming list (Pasta Night row). Mini bar with **three tabs** (Home, My Events, Profile; no gift), the marker on My Events, and the callout "My Events" above it.
  - Body "Your events live in My Events. Past events keep a shared photo album for everyone who went."
  - Bar "Make it yours".
- **Callouts:**
  - "Action → tabs · 0.30 s · marker → My Events · spring 0.38 / 0.82"
  - "Callout · 0.8 → 1 · spring 0.36 / 0.62 · holds 1.65 s · exits easeIn 0.15 s"

**P20 · `Onboarding / B4 Memories / beat 5 album upload`**
- **Capture:** `memories@8.10`
- **On screen:**
  - "SATURDAY HIKE · OCT 18", with a 3 × 2 grid (album_Rectangle931–936).
  - A new thumbnail above the mini bar with its ring at 50%.
  - Mini bar "Add Photos".
- **Callouts:**
  - "Grid develops · 40 ms apart · blur 6 → 0"
  - "Ring 0 → 1 · 0.8 s linear from 7.70 · settles to slot 1 · spring 0.55 / 0.86"

**P21 · `Onboarding / B4→B5 Transition / stage shrink`**
- **Capture:** `transition.memories-interests@0.35`
- **On screen:**
  - The Stage's bottom edge at y ≈ 420 and rising, with fill halfway from #FFCC3E to #ECECEC.
  - Album content cropped by that edge.
  - Title "WHAT ARE YOU INTO?" half-revealed under the edge.
  - The first picker row emerging.
  - G in flight.
- **Callouts:**
  - "Stage bottom 563 → 330 · spring 0.55 / 0.86 · clipped, not faded"
  - "Copy rides the edge · rows emerge 30 ms apart from 0.45 s"

**P22 · `Onboarding / B5 Interests / picking`**
- **Capture:** `interests@rest`, 2 selected
- **On screen:**
  - Header: pill "Interests" (x 72–189), stack [You, P, Y, "+2"] (x 199–281), Skip.
  - Strip #ECECEC at y 134–330, with chips "All events" (white), "Food & Drink" and "Arts" (#7B88FA, white text). Cards: "FOOD & DRINK" with Y on #FFCC3E, and "ARTS" with P on #FB72E4.
  - Title at y 352. Body "Pick a few. You can filter events by them anytime, and change them in Profile."
  - Picker from y 450 to 705: search, "2 of 10 selected", rows with #7B88FA `checkmark.circle.fill` or a gray `circle`.
  - "Skip for now" at y 717. Bar "Save and start" (#7B88FA).
- **Callouts:**
  - "Chip grows from strip colour · 0.6 → 1 · spring 0.36 / 0.62 · haptic .selection"
  - "Bar ink → purple · 0.30 s · when ≥ 1 selected"
  - "Stack shows 3 faces + '+n' · keeps 8 pt clear of Skip"

**P23 · `Onboarding / H Handoff / window 50%`**
- **Capture:** `handoff@0.45` (surface `ready`)
- **On screen:**
  - A white `WindowSheet` with a hole about 382 × 690, radius 10.
  - Through the hole, the real Home, per the §7.1 Home rule: the "Home" pill and the avatar (no bell, "bell hidden per F0"); "This Week's Challenge" with the pink Fitness challenge card at the top; then "Upcoming events" with its cards.
  - You at about 34 pt, flying to x 337, y 65.
  - The Bar mid-dissolve: about 50% action fill, tabs drawn per the tab-bar rule.
- **Callouts:**
  - "Window → full screen · radius 20 → 0 · spring 0.60 / 0.88 · even-odd sheet"
  - "You → profile button · 28 → 40 · spring 0.55 / 0.86"
  - "Action dissolves → tabs · 0.30 s · haptic .success if saved"

**P24 · `Onboarding / H Handoff / Home`**
- **Capture:** Home, 1.0 s after the handoff
- **On screen:**
  - The real Home per the §7.1 Home rule: header without the bell, "This Week's Challenge" with the pink Fitness card, "Upcoming events", and "Attended Your Recent Events:" (draw 3 avatars plus "See All").
  - The Bar's tabs per the tab-bar rule, with Home selected.
  - **Pre-F0 note:** the build still shows the bell until F0 lands. That is the only expected difference in screenshot comparisons. The tab bar follows its own pre-F0 rule.
- **Callouts:**
  - "Tour layer removed at 1.25 s (after window settles ≈ 1.20 s) · same bar centre H−61 · no pixel change"
  - "Reduce Motion: crossfade 0.35 s"

### 7.3 Variants

Each variant gives its on-screen content and its callouts. "As Pn" means the same as that primary frame except for what is listed.

**V1 · `Onboarding / A0 Pending / retry look`**
- **Capture:** `pending.retry@0.6`
- **On screen:** Stage #FB72E4 with the Crew in the looking pose (gaze +0.5). Pill "Looking for your team…". Body at 45%. Bar "Just a moment…" with the band.
- **Callouts:**
  - "From A3/A4: fill → pink, regather · spring 0.55 / 0.86"
  - "Only the Bar title changes when resolving starts"

**V2 · `Onboarding / A1 Welcome / reel`**
- **Capture:** `welcome@2.6`
- **On screen:** as P2, with "Board game lunch" leaving upward (−10, 50%), "Pasta night" entering (+10, 50%), and Y raised 6 pt.
- **Callouts:**
  - "Push from bottom · spring 0.45 / 0.85 · every 2.4 s · 3 cycles"

**V3 · `Onboarding / A2 Resolving / reduce motion`**
- **On screen:** as P3, with gaze 0, no band, and a white 64 pt circle with a spinner in the Bar.
- **Callouts:**
  - "Reduce Motion: no band, gaze or hops"

**V4 · `Onboarding / A3 No company / company not found`**
- **Capture:** `notFound@1.4`
- **On screen:**
  - Stage #FFCC3E. A purple pill face at 120 pt, calm, eyes left.
  - Title "YOUR COMPANY ISN'T HERE YET".
  - Body "We couldn't find your company yet. Ask your organizer to add your email domain, then try again."
  - Secondary "Use a different account". Bar "Try again".
- **Callouts:**
  - "Gaze left/right twice · 0.5 s each"
  - "Try again → Resolving directly (retryMembership)"

**V5 · `Onboarding / A4 Problem / something went wrong`**
- **On screen:**
  - Stage #7B88FA. A pink round face at 120 pt, worried, rotated 2°.
  - Title "SOMETHING WENT WRONG". Body "Please try again."
  - Secondary "Sign out". Bar "Try again".
  - Also covers "TOO MANY TRIES", "WE COULDN'T LOAD YOUR PROFILE", and "SIGN-IN ISN'T AVAILABLE" (no secondary).
- **Callouts:**
  - "Wobble ±2° twice · 0.6 s"

**V6 · `Onboarding / A3-A4 Notice / accessibility XXXL`**
- **On screen:** no Stage. "USE YOUR WORK ACCOUNT" wraps to about 4 lines; the body scrolls; the Bar is pinned.
- **Callouts:**
  - "AX: face card hidden · Bar pinned"

**V7 · `Onboarding / B0 Arrival / accessibility XXXL`**
- **On screen:** Skip; You at 56 pt; the title wraps; body; Bar "Show me around".
- **Callouts:**
  - "AX: Stage → avatar · scrolls"

**V8 · `Onboarding / B1 Discover & Join / reduce motion`**
- **On screen:** P10 without the ghost, plus three 6 pt dots at y 571 (the third filled).
- **Callouts:**
  - "3 stills · crossfade 0.30 s · hold 1.6 s"

**V9 · `Onboarding / B1 Discover & Join / accessibility XXXL`**
- **On screen:**
  - A two-row header.
  - Rows: `calendar` "Browse company events", `hand.tap` "Join with one tap", `checkmark.circle` "Joined events appear in My Events".
  - Bar "See who's going".
- **Callouts:**
  - "AX: Stage → 3 rows"

**V10 · `Onboarding / B2 People & Invites / beat 5 invite sent`**
- **Capture:** `people@6.10`
- **On screen:** the chip reads "Invite sent" (#CCCCCC); toast "Invite sent to Priya" (ink capsule).
- **Callouts:**
  - "Sheet shrinks into chip · spring 0.55 / 0.86 · toast holds 1.0 s"

**V11 · `Onboarding / B2 People & Invites / reduce motion`**
- **On screen:** "7 of 12", "+ 3 More", "Invite sent", and five dots (the fifth filled).
- **Callouts:**
  - "5 stills · no flip, zoom or growth"

**V12 · `Onboarding / B3 Challenges & Points / beat 4 waiting for approval`**
- **Capture:** `challenge@7.30`
- **On screen:** the entry **[placeholder until F3]**, plus a "Waiting for approval" pill (#FFCC3E, ink Inter 14).
- **Callouts:**
  - "Pill grows from Send frame · spring 0.36 / 0.62"
  - "Caption types 35 ms per character"

**V13 · `Onboarding / B3 Challenges & Points / beat 5 later chip`**
- **Capture:** `challenge@7.70`
- **On screen:** as V12, with the content dimmed to 80% and a centred "Later" chip.
- **Callouts:**
  - "Dim 80% · 'Later' chip 0.6 s · organizer approves offscreen"

**V14 · `Onboarding / B3 Challenges & Points / reduce motion`**
- **On screen:** "Approved", "170 points", four dots.
- **Callouts:**
  - "4 stills · no arc, stamp or typing"

**V15 · `Onboarding / B3 Challenges & Points / accessibility XXXL`**
- **On screen:**
  - Rows: `list.number` "Each challenge lists what to do", `calendar` "It shows when it ends and the points you'll get", `square.and.arrow.up` "Send progress, a caption and an optional photo", `checkmark.seal` "Your organizer approves, then points are added".
  - Bar "And after the event?".
- **Callouts:**
  - "AX: Stage → 4 rows"

**V16 · `Onboarding / B4 Memories / reduce motion`**
- **On screen:** the album with the new photo, three dots.
- **Callouts:**
  - "3 stills · crossfade 0.30 s"

**V17 · `Onboarding / B5 Interests / catalog loading`**
- **On screen:** the strip with "All events" only; six #ECECEC 44 pt rows with the band; Bar "Start exploring".
- **Callouts:**
  - "Shimmer · linear 1.4 s · while loading only"

**V18 · `Onboarding / B5 Interests / catalog failed`**
- **On screen:** G at 64 pt on the strip; the message "Your interests couldn't load. You can add them in Profile anytime."; no picker; Bar "Start exploring".
- **Callouts:**
  - "Message fades in · 0.25 s"

**V19 · `Onboarding / B5 Interests / save failed`**
- **On screen:** as P22, plus the label "Couldn't save your interests. Your choices are kept." at the top of the list; Bar "Try again" (ink); "Skip for now".
- **Callouts:**
  - "'Saving…' → 'Try again' · 0.30 s · one retry control"

**V20 · `Onboarding / B5 Interests / reduce motion`**
- **On screen:** as P22.
- **Callouts:**
  - "Chips 0.12 s opacity · Stage height crossfades"

**V21 · `Onboarding / B5 Interests / accessibility XXXL`**
- **On screen:** a two-row header (back + Skip; then "Interests" and the stack); no strip; the title wraps; body; the picker with large rows; "Skip for now" and the Bar pinned.
- **Callouts:**
  - "AX: no strip · header two rows"

**V22 · `Onboarding / H Handoff / waiting for events`**
- **Capture:** `handoff@wait`
- **On screen:** the copy is gone; the Stage holds its last frame; Bar "Getting your events…" with the band.
- **Callouts:**
  - "Waits ≤ 2.0 s for a non-loading surface"

**V23 · `Onboarding / H Handoff / shell loading (no bar)`**
- **Capture:** `handoff.shellLoading@1.0`
- **On screen:** `ProgressView` "Loading your company events…"; no Bar.
- **Callouts:**
  - "Case (a): Bar fades out 0.25 s · focus to loading label"

**V24 · `Onboarding / H Handoff / events unavailable (no bar)`**
- **Capture:** `handoff.shellUnavailable@1.0`
- **On screen:** `ContentUnavailableView` "Events unavailable" (`calendar.badge.exclamationmark`, "Please sign out and try again."); no Bar.
- **Callouts:**
  - "Case (a): Bar fades out · focus to title"

**V25 · `Onboarding / H Handoff / activities loading`**
- **Capture:** `handoff.activitiesLoading@1.0`
- **On screen:** `ProgressView` "Loading…" centred; the Bar with tabs (per the tab-bar rule), Home selected.
- **Callouts:**
  - "Case (b): action dissolves → tabs · 0.30 s · no pixel change"

**V26 · `Onboarding / H Handoff / activities load error`**
- **Capture:** `handoff.activitiesError@1.0`
- **On screen:** `ContentUnavailableView` "Couldn't load your activities" (`wifi.exclamationmark`) with a "Retry" button; the Bar with tabs.
- **Callouts:**
  - "Case (c): dissolve → tabs · VoiceOver focus to Retry"

**V27 · `Onboarding / Replay / reveal into Profile`**
- **Capture:** `replay.end@0.45`
- **On screen:** the `WindowSheet` hole at about 50%, showing Profile; You flying to the large photo; "Done" faded.
- **Callouts:**
  - "Same reveal over Profile (presentationBackground clear)"
  - "Dismissed without animation at 1.25 s · record untouched"

### 7.4 Draft file mapping (round-1 name → v3 name)

- **Rename + adjust:** rename the frame, then fix its geometry: Bar at y 773, tour Stage at y 134 × 429, canvas at x 66 / y 174 at 0.691, the header overflow rule, gift icons, no bell.
- **Redraw:** the content changed.

| Round-1 frame | v3 frame | Action |
|---|---|---|
| Onboarding / 01 Welcome / rest | P2 A1 Welcome / rest | rename + adjust (Welcome Stage y 60) |
| Onboarding / 01 Welcome / reel | V2 A1 Welcome / reel | rename + adjust |
| Onboarding / 02 Resolving / looking | P3 A2 Resolving / looking | rename + adjust |
| Onboarding / 02 Resolving / reduce motion | V3 A2 Resolving / reduce motion | rename + adjust |
| Onboarding / 03 Blocked / personal email | P4 A3 No company / personal email | rename + adjust |
| Onboarding / 03 Blocked / company not found | V4 A3 No company / company not found | redraw (yellow Stage) |
| Onboarding / 03 Problem / offline | P5 A4 Problem / offline | redraw (gray Stage) |
| Onboarding / 03 Problem / something went wrong | V5 A4 Problem / something went wrong | rename + adjust |
| Onboarding / 04 Arrival / rest | P6 B0 Arrival / rest | rename + adjust (no stack in header) |
| Onboarding / 05 Join demo / beat 1 feed | P8 B1 Discover & Join / beat 1 develop | redraw (radial develop) |
| Onboarding / 05 Join demo / beat 4 event page | P9 B1 Discover & Join / beat 4 event page | redraw (real people row) |
| Onboarding / 05 Join demo / beat 6 joined | P10 B1 Discover & Join / beat 6 joined | redraw (real row, purple bar) |
| Onboarding / 05 Join demo / reduce motion | V8 B1 Discover & Join / reduce motion | redraw (from P10) |
| Onboarding / 05 Join demo / accessibility XXXL | V9 B1 Discover & Join / accessibility XXXL | rename + adjust |
| Onboarding / 05→06 Transition / crew to stack | P11 B1→B2 Transition / host face to stack | redraw (perch) |
| Onboarding / 06 People / beat 1 names | P12 B2 People & Invites / beat 2 participants | redraw (participant rows) |
| Onboarding / 06 People / beat 5 Priya's view | P14 B2 People & Invites / beat 7 Priya's view | rename + adjust |
| Onboarding / 07 Challenge / beat 2 requirements | P16 B3 Challenges & Points / beat 2 requirements | redraw (adds "Ends Friday", "Add Your Entry") |
| Onboarding / 07 Challenge / beat 5 points | P17 B3 Challenges & Points / beat 6 points | rename + adjust |
| Onboarding / 08 Memories / beat 1 My Events | P19 B4 Memories / beat 1 My Events | redraw (yellow Stage, 3 tabs, no gift) |
| Onboarding / 08 Memories / beat 4 album upload | P20 B4 Memories / beat 5 album upload | rename + adjust (yellow Stage) |
| Onboarding / 09 Interests / picking | P22 B5 Interests / picking | redraw (pill "Interests", stack "+2") |
| Onboarding / 10 Handoff / window 50% | P23 H Handoff / window 50% | redraw (no bell) |
| Onboarding / 10 Handoff / Home | P24 H Handoff / Home | redraw (no bell, tab-bar rule) |

**New frames with no round-1 equivalent:** P1, P7, P13, P15, P18, P21; V1, V6, V7, V10–V27.
