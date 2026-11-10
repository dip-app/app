# Onboarding (v2)

> Status: design spec, nothing built yet. Onboarding is the uncommitted **O** item in `docs/milestones/v2/FRONTEND_PLAN.md`, so the team has to approve it before work starts. No contract, rules or backend change is needed. Every claim about existing code was checked against the repository on 2026-11-10. Anything the spec needs that does not exist yet is marked **NEW**, with an owner in §5.

## 1. Principles and the through-line

### The through-line: one Bar, one Stage, one Crew

The whole sequence is one composition. Three elements stay on screen from first launch to Home and change shape instead of being replaced.

1. **The Bar.** The real `DIPFloatingNavigation`, an 80 pt ink capsule with a 20 pt side inset. `DIPPrototypeApp` places it with `.position(x: width / 2, y: height − 61)` under `.ignoresSafeArea()`, so its bottom edge sits 21 pt above the screen edge. On a 874 pt screen that is **y 773–853**. `WelcomeView`'s footer ends with the same 21 pt bottom padding under `.ignoresSafeArea(.container)`, so the Welcome bar lands on exactly the same rectangle. The Bar never moves. What it shows changes:
   - the sign-in button ("Continue with Google")
   - a progress capsule while the company resolves ("Finding your company…")
   - each blocked state's primary action
   - the tour's CTA
   - at the end, its action overlay dissolves (`action = nil`) to reveal the tabs with the white marker on Home. The onboarding bar *becomes* the app's bar, as `docs/design/motion.md` requires ("one persistent bottom component").
2. **The Stage.** One rounded card (radius `card` 20, width = screen − 40). It holds every illustration and demo, and its fill moves through token colours, one per step (§4.3).
   - On Welcome it is today's pink `OnboardingFaceCard`.
   - In the tour it frames a small, live version of DIP built from real components.
   - At handoff it becomes a window that grows until it *is* the real Home.
3. **The Crew.** The four existing `OnboardingFace` characters (purple round, white pill, yellow square, gray round) plus **You** (your initials or OAuth portrait in a `DIPAvatar`).
   - On Welcome they greet you; while the company resolves they look for it.
   - In the demos they are the coworkers attending, inviting and sharing photos.
   - One Crew member hosts each tour step, perched on the Stage's top edge, and joins your stack when the step ends. The stack fills the way "Who's Attending" fills.

### Principles

1. **Never a page change.** Each step morphs the Stage and Bar that are already on screen. If a frame would be easier to build as a push or slide, redesign it.
2. **Each step enters in its own way.** No step reuses another's entrance. Titles are revealed by the moving Stage edge, gathered, stamped or developed (§3.0). Demo content grows out of the Stage colour or from shared elements; it never slides in from an offset.
3. **Show the real app, smaller.** Demos are built from shipping components: `DIPPhotoEventCard`, `DIPDetailHero`, `DIPDetailPeopleRow`, `DIPDetailActionRow`, `DIPParticipantsScreen`, `DIPChallengeCard` and `DIPFloatingNavigation`. They sit on a fixed 390 × 540 pt white canvas, scaled down. Where the shipping UI lacks something a demo needs (invitations, points), the demo uses a placeholder that is clearly marked and replaced when the feature lands.
4. **Coworkers first, fitness last.** Demos open on social activities: board games, pasta night, a hike. The one fitness cover is fifth in the feed. The copy says "coworkers", "team" and "together", never "workout".
5. **Teach the confusing parts by name.** Each user-testing finding gets its own beat:
   - one Join action, and the bar changing when you've joined
   - a "My Events" label above the squares icon
   - "Past events" spelled out
   - challenge requirements and how to submit shown before the submit action
6. **Honest demos.** Every Stage carries an `EXAMPLE` chip. Names, events and photos are fictional and bundled. The joined bar is drawn exactly as the app ships it ("Activity Chat"), and the copy never promises chat. Each feature step drops out cleanly if its feature slips.
7. **Quiet by default, with a still for every motion.**
   - A demo plays once, rests on its final frame and replays on tap.
   - Nothing animates unless something is changing; the two loops that do run are listed in §5.
   - Haptics fire only on the user's own taps.
   - Reduce Motion, VoiceOver, accessibility text sizes and Low Power Mode each get a composition designed for them.

## 2. Flow map

### Placement decision

- **Before sign-in: Welcome only.** One living screen that sells meeting coworkers and offers one action.
- **After the account resolves to a member: the tour.**

The tour waits for membership because:
- Before membership there is no tenant context, no name and no profile write.
- People on a personal, blocked or not-yet-onboarded domain would sit through a tour they can't use.
- Saving interests needs `MemberProfileBridge.save` through `ProfileEditor`, which exists only inside `DIPMemberHome`.
- The tour can greet the person by first name and hand off into their real Home.

The fitness misreading still has to be corrected before sign-in. That is the Welcome hero's job.

### Flow

```
launch ─▶ A0 Pending (authenticationPending)   bar: "Just a moment…"
             │ signedOut                           │ member (restored session)
             ▼                                     ▼
          A1 Welcome ──tap bar──▶ Google sheet ──cancel──▶ A1
             ▲                        │ success
             │ signOut                ▼
             │                 A2 Resolving (resolvingCompany)   bar = progress
             │                  │              │              │
             │       noCompany(reason)   recoverableError     member
             │                  ▼              ▼              ▼
             ├──────── A3 No company     A4 Problem    store.isComplete(uid)?
             │         Try again =        Try again =      │yes         │no
             │         retryMembership    restart          ▼            ▼
             │          ▶ A2 directly      ▶ A0 (retry look) ▶ A2 or member
             │                                          H reveal     B0 Arrival
             │                                                       ▼
             │                                  B1 Discover & Join   (always)
             │                                  B2 People & Invites  (participants always; invite beats need F4)
             │                                  B3 Challenges        (needs F3; points beat needs F2)
             │                                  B4 Memories          (always; upload beat needs F5 or the mock album)
             │                                  B5 Interests         (always; live reshape needs F1)
             │                                                       ▼
             └───────────────── sign out from Home ◀──── H Handoff (ready / not ready / unavailable)
```

### Route table

| Route | Session state | Bar | Secondary | Back | Skip |
|---|---|---|---|---|---|
| A0 Pending | `authenticationPending` | "Just a moment…" + progress | — | — | — |
| A1 Welcome | `signedOut` | "Continue with Google" | — | — | — |
| A2 Resolving | `resolvingCompany` | "Finding your company…" + progress | — | — | — |
| A3 No company | `noCompany(_, reason)` | the notice's primary action | the notice's secondary (text button) | — | — |
| A4 Problem | `recoverableError` | "Try again" | "Sign out" where the notice has one | — | — |
| B0–B5 | `member`, tour not complete | step CTA | B5: "Skip for now" | B1–B5 | B0–B4 |
| H | B5 CTA, Skip, or a returning member | dissolves to tabs, or fades out (§3 H) | — | — | — |

**Route split (NEW work).** Today `AccountsRoute.progress(String)` merges `authenticationPending` and `resolvingCompany`. Replace it with `.pending` and `.resolving` so A0 and A2 can look different. The copy moves into `AccountsStageView`. Update the existing `AccountsRoute` unit tests.

**Two retry paths, both animated.**
- On A3 "company not found", "Try again" calls `session.retryMembership()`, which sets `.resolvingCompany` directly: A3 → A2.
- On A4, "Try again" is `.restart`, which calls `session.start()`. That sets `.authenticationPending` first, then whatever the observer reports. So the path is A4 → A0 (shown in its retry look, §3) → A2, member or a notice.

### Persistence

- **Store.** `UserDefaults.standard`, key `dip.onboarding.v1.<uid>`, holding JSON `OnboardingRecord { version: 1, lastStep, outcome: nil | .finished | .skipped, updatedAt }`. Nothing is written to Firestore.
- **API (NEW).** `protocol OnboardingRecordStore { func record(for uid: String) -> OnboardingRecord?; func save(_: OnboardingRecord, for uid: String); func isComplete(uid: String) -> Bool }`. `isComplete` returns true when `outcome != nil`.
- **When records are written.**
  - `lastStep` when a step settles (its CTA was tapped and the next step began).
  - `outcome` the moment handoff *starts*, so a kill during the reveal never shows the tour again.
  - Skip writes `.skipped`.
- **Resume.** A relaunch with `outcome == nil` resumes at `lastStep`, clamped to the first step still available under the current feature flags. Demos restart at t = 0.
- **Kill during the B5 save.** The profile observation is the truth. B5 reopens with `editor.profile.interestTagIds` selected.
- **Accounts and devices.** Sign-out keeps records. Another uid on the same device gets its own tour. Reinstalling clears UserDefaults and shows the tour again (accepted, documented).
- **Replay.** Profile gets a new **"How DIP works"** row (NEW).
  - It presents the tour as a `fullScreenCover` with `.presentationBackground(.clear)` in `.replay` mode, starting at B1.
  - Skip reads "Done". B5 saves through the same path.
  - The end is the H window reveal, uncovering Profile instead of Home. The cover is then dismissed with animations disabled.
  - Replay never writes the record.

## 3. Step specs

### 3.0 Shared layout, motion vocabulary and entrance characters

**Tour layout.** Reference size is iPhone 17 Pro, 402 × 874 (safe-area top 62, bottom 34). On screens under 700 pt tall, the Stage shrinks to whatever height leaves 22 pt above the title, and the canvas scales to fit.

| Element | Geometry (402 × 874) |
|---|---|
| Header row | y 70–114. Back: 44 pt circle at x 20 (`surfaceMuted`, ink chevron). Step pill: x 72, height 44 (`actionPrimary`, Figtree 20, white, 20 pt horizontal padding). Crew stack: 28 pt faces overlapping −8, 10 pt after the pill. "Skip": trailing at x 382, Figtree 17, ink 70%, 44 × 44 hit area |
| Stage | x 20, y 134, 362 × 429, radius 20 |
| `EXAMPLE` chip | top-left inside the Stage at x 32, y 145, height 22. Inter Medium 11, tracking 0.6, ink on white 85% |
| Host face | 40 pt, x 322–362, y 114–154: centred on the Stage's top edge, drawn in front of it |
| Demo canvas | 390 × 540 logical, white, radius 23 (16 pt on screen). Scale 0.691 → 269.5 × 373 at x 66, y 174 (40 pt top gutter, 16 pt bottom gutter) |
| Replay button | 44 pt white circle, ink `arrow.counterclockwise`, at x 336, y 507, in the Stage's right gutter |
| Title | x 20, y 585, Fjalla One 34, uppercase, ink, at most 2 lines (585–669) |
| Body | Inter 16, ink, at most 2 lines, 10 pt below the title (≈ 679–719) |
| Secondary text action | Figtree 17, ink, centred, y 717–761 |
| Bar | x 20, y 773–853, 362 × 80 (centre y = H − 61) |

The page background is always `surfaceDefault`. Only the Stage changes colour.

**Motion tokens.** New `OnboardingMotion`, in the app target next to `DIPMotion`, which is unchanged. Settle times are approximate times for each spring to land within 1% of its target.

| Token | Value | Settles in | Use |
|---|---|---|---|
| `stage` | `.spring(response: 0.55, dampingFraction: 0.86)` | ≈ 0.9 s | Stage frame and fill, zooms, sheet moves |
| `expand` | `.spring(response: 0.50, dampingFraction: 0.86)` | ≈ 0.8 s | card → page expansions inside the canvas |
| `hop` | `.spring(response: 0.36, dampingFraction: 0.62)` | ≈ 0.7 s | faces joining, chips, pops |
| `copyOut` | `.easeIn(duration: 0.18)`, opacity → 0, y −6 | 0.18 s | every outgoing title and body (exits stay quick and uniform so they never compete with an entrance) |
| `bar` | `DIPMotion.navigation` (0.3 s easeOut) | 0.3 s | Bar title and fill changes (existing) |
| `affordance` | `DIPMotion.affordance` (0.45 / 0.68) | ≈ 0.8 s | Bar icon circle (existing) |
| `marker` | `DIPMotion.marker` (0.38 / 0.82) | ≈ 0.6 s | tab marker (existing) |
| `section` | `DIPMotion.section` (0.625 s smooth) | 0.625 s | My Events sections (existing) |
| `ghost` | 44 canvas-pt ink circle at 16%. Moves on a quad curve in 0.45 s easeInOut. Press is scale 1 → 0.86 → 1 over 0.22 s | — | the demo finger |
| `callout` | ink capsule, white Inter Medium 13, 6 pt tail. Scale 0.8 → 1 with `hop`, holds at least 1.4 s | — | labels for user-testing findings |

**Timing rule.** A beat that targets an element moved by an earlier beat (a ghost aiming at it, a zoom anchored to it) starts after that earlier spring's settle time. Beats that animate other properties may overlap, because springs retarget smoothly.

**Entrance characters.** Each step's title and body arrive in their own way.

| Step | Title entrance | Body |
|---|---|---|
| A1 Welcome | Rises from behind the Stage's bottom edge: clipped by a rectangle starting at the Stage bottom, offset −36 → 0 with `stage` | the same clip, 90 ms later |
| A2 Resolving | Title stays; body dims to 45% | — |
| A3 / A4 | "Drops" out of the Stage: the same edge clip, offset −24 → 0 with `.spring(0.4, 0.8)` (≈ 0.6 s), timed to the face's mood change | 120 ms later |
| B0 Arrival | Word by word: each word scales 0.7 → 1 with `hop`, 70 ms apart, in step with the Crew's cheer | fades in after the last word |
| B1 Discover | Left-to-right wipe: a mask with a 24 pt feathered edge grows 0 → 100% width over 0.45 s easeOut, in step with the canvas developing | the same wipe, 80 ms later |
| B2 People | Words gather: each word starts ±18 pt from its rest position (alternating sides) and converges with `hop`, like people arriving | opacity 0.25 s, 100 ms later |
| B3 Challenges | Stamped: scale 1.12 → 1, opacity 0 → 1, `.spring(0.3, 0.7)`, like an approval stamp | revealed line by line, 120 ms apart, matching the requirement lines |
| B4 Memories | Develops like a photo: blur 8 → 0 and opacity 0 → 1 over 0.5 s easeOut, timed with the album thumbnails | the same, 100 ms later |
| B5 Interests | Copy is pinned to the Stage's bottom edge and rides up with it as the Stage shrinks. The title is revealed from under that edge, and picker rows follow out from under it | moves with the title |

**Standard step change** (CTA tap at t = 0):

| t | Event |
|---|---|
| 0.00 | `.sensoryFeedback(.impact(weight: .light))`; outgoing copy `copyOut`; CTA disabled until 0.32 |
| 0.05 | the outgoing host face starts its flight to the Crew stack (§4.2) |
| 0.08 | Stage fill (and frame, where it changes) animates with `stage`, finishing ≈ 0.98 |
| 0.10 | Bar title crossfades to the next CTA (`bar`) |
| 0.20 | the incoming host face rises from behind the Stage's top edge (offset +24 → 0, masked by the Stage top, `hop`) |
| 0.32 | the incoming title starts its entrance character |
| 0.52 | the next demo starts at t = 0. Exception: B4 → B5 starts the strip at 0.95, after the Stage frame settles |

**Demo rules**

- Autoplay plays once, then rests on the final frame with the replay button showing.
- Tapping the Stage replays.
- Dragging horizontally scrubs (1 pt = 12 ms). Scrubbing applies `state(at:)` without animation; releasing resumes from that point.
- Demos fire no haptics.

### A0 Pending, A1 Welcome, A2 Resolving: one view

**Purpose.** One idea before sign-in: *DIP is for meeting coworkers through all kinds of activities.*

**Layout.** Welcome's existing geometry, measured from `WelcomeView`:

- Stage: x 20, y 60, 362 × 225 (60 pt top padding with the safe area ignored), `challengeAccent` pink.
- Crew of four, 88 pt, overlapping −19, centred at y 196.
- Activity pill: white capsule, height 32, Inter 15, ink, centred at y 98.
- Title at y 307. Body 10 pt below it.
- Footer: guidance note (Inter 13, centred, ≈ y 729–761) 12 pt above the Bar.
- Bar: y 773–853.

**Copy**

- Title: **MEET YOUR TEAM OUTSIDE WORK** (kept).
- Body: **"Board games, cooking nights, hikes and more. See which coworkers are going and join in one tap."**
- Footnote: **"Use your work Google account. We find your company from your email."**
- Bar: **"Continue with Google"** → "Connecting…" → "Finding your company…". A0 shows "Just a moment…".
- Pill (localized): **"Board game lunch" → "Pasta night" → "Trivia after work" → "Sunset hike" → "Coffee walk"**.

**Storyboard**

- **A0 cold launch.**
  - The Stage fades in (0.25 s easeOut).
  - The Bar shows "Just a moment…" with progress.
  - A restored member goes straight to H.
- **A0 → A1.**
  - Crew enter growing out of the Stage colour: each face starts as a pink disc (fill = Stage colour, scale 0.6), and its ink disc and character fade in as it scales to 1 with `hop`, 60 ms apart, left to right.
  - The title rises from behind the Stage edge.
  - The Bar crossfades to "Continue with Google".
- **The reel.**
  - Every 2.4 s the pill text changes with `.transition(.push(from: .bottom))` under `.spring(0.45, 0.85)`.
  - One face, in turn, hops 6 pt with `hop`. The third change also winks the square face.
  - After 3 cycles (36 s) the reel rests on "Board game lunch". Tapping the Stage restarts it.
  - Low Power Mode: no reel.
- **Sign-in tap.** `.impact(weight: .light)`. The Bar shows "Connecting…" (existing). The reel pauses.
- **A2 Resolving.**
  - Bar title → "Finding your company…" with the progress accessory (NEW, §5): a white 25% `LinearGradient` band 80 pt wide whose x offset animates −80 → bar width, `.linear(duration: 1.4).repeatForever(autoreverses: false)`. SwiftUI re-evaluates that offset every frame on the main thread; it is cheap (one layer) and runs only while A0 or A2 is visible.
  - The Crew look around: the rig's `gaze` goes −1 → +1 → 0, 1.2 s easeInOut, repeating only while A2 is visible. Each face's eye path is recomputed per frame during this loop.
  - The body dims to 45% (0.3 s).
  - The pill crossfades to **"Looking for your team…"**.
- **A0 retry look** (entered from A3 or A4).
  - The Stage fill goes back to pink and the formation regathers into the "looking" pose with `stage`.
  - The A2 pill shows and the body dims.
  - The Bar reads "Just a moment…" with progress.
  - When `.resolvingCompany` arrives, only the Bar title changes to "Finding your company…", so A0 → A2 is one continuous search.

**Interaction.** The Bar is the only control. A cancelled sheet (`AccountsFailure.cancelled`) restores A1 quietly: pill back, gaze 0, body at 100%.

**Reduce Motion.** Crew are already in place. The pill crossfades in 0.12 s at most every 4 s. No gaze, no band. The Bar's icon circle shows a static `ProgressView`.

**Accessibility**

- The Stage is `accessibilityHidden`.
- Focus order: title (header) → body → footnote → Bar.
- Entering A2 posts "Finding your company".
- Accessibility text sizes: no Stage, as today.

**Implementation.** `AccountsRootView` renders a single `AccountsStageView(route:previous:)` (NEW) for every non-member route, replacing `AccountsProgressView`, `WelcomeView` and `AccountsNoticeView`. Stage, Crew, copy and Bar are long-lived subviews. A `CrewFormation` value per route is animated with `stage`.

### A3 No company and A4 Problem

**Purpose.** Say plainly why you can't get in and what to do. Stay warm. Never guess a company.

**Copy.** Titles, messages and actions come from today's `AccountsNotice`, with two refinements:
- Personal email: "DIP finds your company from your work email, so personal Gmail and iCloud accounts can't join."
- Not found: "We couldn't find your company yet. Ask your organizer to add your email domain, then try again."

**Layout.** The A1 geometry. The notice's primary action moves into the Bar. The secondary action is a text button at y 717–761.

**Tone formations.** Stage colours are chosen so no notice shares pink with A2.

| Tone | Stage | Faces |
|---|---|---|
| blocked (personal, other company, unverified) | `actionPrimary` purple | yellow square face (`notificationAccent`) at 120 pt, centred at y 172, worried. The other three at 88 pt, stepped back 28 pt, 35% opacity |
| notFound | `notificationAccent` yellow | purple pill face (fill `actionPrimary`) at 120 pt, calm, alone |
| offline | `surfaceMuted` gray | white round face at 120 pt, calm; gray and purple faces at 64 pt left and right, 35% opacity, joined by a dashed 2 pt ink line |
| problem | `actionPrimary` purple | pink round face (`challengeAccent`) at 120 pt, worried, as `AccountsNoticeView` draws it today |

**Storyboard** (from A2; t = 0 when the state arrives)

| t | Event |
|---|---|
| 0.00 | gaze stops; Stage fill pink → tone colour with `stage` |
| 0.05 | A2 copy leaves (`copyOut`) |
| 0.10 | formation re-composes with `stage`. Blocked: `smile` 1 → −0.6 over 0.4 s easeInOut. Not found: gaze left/right twice (0.5 s each, easeInOut), then rest. Offline: the line's middle breaks (`trim` 1 → 0.4, 0.35 s easeOut, once). Problem: wobble ±2° twice over 0.6 s |
| 0.15 | Bar progress ends; title crossfades to the primary action |
| 0.32 | title "drops" out of the Stage; message follows 120 ms later |
| 0.45 | secondary fades in (0.2 s); blocked only: `.sensoryFeedback(.warning)` once per arrival |

**Retry and sign-out**

- **A3 not-found retry** (`retryMembership`): fill → pink, regather, gaze loop, and the Bar shows progress (back to A2). Copy swaps with the A2 pattern.
- **A4 retry** (`restart`): the A0 retry look, then whatever state follows.
- **Sign out / Use a different account:** goes to A1. Welcome copy rises from the Stage edge again.

**Reduce Motion.** Fill and copy crossfade over 0.25 s. The formation appears in its final pose. No wobble, gaze or trim; the dashed line is drawn already broken.

**Accessibility**

- Focus moves to the title (`@AccessibilityFocusState`) and posts `.screenChanged`.
- Order: title → message → secondary → Bar. Every action is at least 44 pt.
- **Accessibility text sizes:** the Stage is hidden (today's `OnboardingStatusView` already does this); title and message wrap and scroll; the secondary button and the Bar stay pinned.

**Edge cases.** A repeated failure replays the arrival without the haptic. While `isSubmitting`, both actions are disabled and the Bar shows progress.

### B0 Arrival

**Purpose.** "You're in, and this is about your coworkers."

**First frame.** Pixel-identical to A2's last frame: Stage at y 60 × 225 in pink, Crew formation, Bar in progress. `AccountsRootView` swaps in `DIPMemberHome` at this moment, so continuity comes from matching frames, not from a shared namespace.

**Copy**

- Header row: "Skip" only (no pill, no back, no stack yet).
- Title: **"YOU'RE IN, {FIRST NAME}"**, or "YOU'RE IN".
- Body: **"Here's how DIP gets your team together. It takes about a minute."**
- Bar: **"Show me around"**

**Storyboard**

| t | Event |
|---|---|
| 0.00 | Bar progress stops; title → "Show me around" (`bar`) |
| 0.05 | Stage morphs to tour geometry (y 60 → 134, height 225 → 429) and pink → `notificationAccent` yellow (`stage`, settles ≈ 0.95) |
| 0.10 | Crew cheer: y −12 → 0 with `hop`, 70 ms apart; moods → happy; square face winks at 0.60 (rig `eyeOpen` 1 → 0 → 1: 0.12 s close, 0.3 s hold, 0.16 s open) |
| 0.25 | Crew spread 24 pt; **You** (88 pt `DIPAvatar`, 3 pt white ring) grows out of the Stage colour: a yellow disc scales 0.4 → 1 with `hop`, and the avatar fades in over it |
| 0.40 | title word by word ("YOU'RE" · "IN," · "SAM"), in step with the cheer; body at 0.70 |
| 0.70 | "Skip" fades in (0.25 s). The Crew stack is not shown yet; it appears when You flies into it at B0 → B1 |

**Reduce Motion.** A 0.3 s crossfade into the final composition.

**Accessibility**

- Focus goes to the title. Stage description: "You and four coworkers, celebrating."
- **Accessibility text sizes:** no Stage. A 56 pt You avatar sits above the title, then title and body, with the Bar pinned.

**Implementation.** `OnboardingTourView` (NEW) is an opaque overlay added inside `DIPMemberHome.body`, in a `ZStack` above the existing content `Group`. The shell underneath keeps loading events during the tour, but gets `allowsHitTesting(false)` and `accessibilityHidden(true)` while the tour is up. No visibility change to `DIPMemberHome`'s private `prototype(...)` is needed. Arrival runs from `onAppear` by flipping `arrived = true` inside `withAnimation`.

### B1 Discover & Join

**Value.** Company events of every kind, and one tap to join.

**Copy.** Pill **"Find events"**. Title **"FIND SOMETHING FUN"**. Body **"Company events, from lunchtime board games to weekend hikes. Tap Join once and you're on the list."** Bar **"See who's going"**.

**Stage.** `actionPrimary`. Host face: purple round, carried over from B0.

**Canvas content (390 × 540)**

- **Feed:**
  - "Upcoming events" (Figtree 18) at y 70.
  - A non-scrolling `HStack` of `DIPPhotoEventCard` (163 × 205, radius 20, spacing 10) at y 102, moved only by an `offset`:
    1. Board Game Lunch (`cover_games`, avatars ×3, "5 Attending")
    2. Pasta Night (`cover_cooking`, "5 Attending")
    3. Saturday Hike (`cover_hiking`)
    4. Kayak Morning (`cover_outdoors`)
    5. Lunchtime Yoga (`cover_fitness`)
- **Event page** (composed from shared pieces, not `DIPEventDetailsScreen`, which adds a back header at 60 pt top padding). Content is offset y −90, so the hero's top 90 pt is cropped:
  - `DIPDetailHero` (height 264, radius 20 on all corners, x 20–370) at canvas y −80…184
  - title "PASTA NIGHT", Fjalla One 40, at 194–244 (the event screen's title style)
  - `DIPDetailPeopleRow(title: "Who's Attending", avatars: [P, Y, G], total: 5, capacity: 12)`: header "5 of 12", three 40 pt faces and a "+ 2 More" ink capsule, at 264–336
  - `DIPDetailActionRow(joinInRow: false, directionsURL: demo URL, shareTitle: "Share Event")`: Directions | Share Event, at 356–406
- **Mini bar:** the real `DIPFloatingNavigation` at canvas y 439–519 (centre = 540 − 61), the same rule as the app.
- **Avatars:** Crew faces are rendered once with `ImageRenderer` at @3x to PNG and passed as `MediaReference.data(_)`. `DIPDetailPeopleRow` and `DIPParticipant` take `MediaReference`, not `Image`.

**Storyboard**

| Beat | t | What happens |
|---|---|---|
| 1 develop | 0.00 | The canvas starts filled with Stage purple. A circular reveal mask, centred on the canvas, grows radius 0 → 340 with `stage`, uncovering the white canvas and feed. Cards scale 0.94 → 1 with `expand`, 50 ms apart, as the reveal passes them. Mask radius and card scale are functions of t, so this beat scrubs |
| 2 browse | 0.95 | `HStack` offset x 0 → −180 over 0.9 s easeInOut, then back to 0 over 0.6 s (ends 2.45). This is an offset, not a `ScrollView`, so the curve is exact |
| 3 choose | 2.45 | ghost appears over Pasta Night; press at 2.75 (card scale 0.97) |
| 4 event page | 2.90 | card → hero: `matchedGeometryEffect(id: "cover.pasta")` from 163 × 205 to 350 × 264, radius 20 throughout (`expand`, settles ≈ 3.70). Title, people row and action row grow out of the hero's bottom edge: each clipped by a rectangle starting at the hero's bottom, offset −16 → 0, 60 ms apart. Mini bar: tabs → **"Join the Activity"** (standard ink, `bar` crossfade) |
| 5 tap Join | 3.75 | ghost travels to the mini bar (0.45 s); press at 4.25 |
| 6 joined | 4.30 | Mirrors the app's `bottomAction`. The bar's title crossfades to **"Activity Chat"**, its fill ink → `actionPrimary` (0.3 s easeOut, `DIPFloatingNavigation`'s action animation), and a white 64 pt circle with `event_HeroiconsOutlineChatBubbleOvalLeft` springs in (scale 0.3 → 1, `affordance`). People row: avatars `[P, Y, G, You]`, total 6. The fourth slot fades in (the component's default insertion) under a demo-only white 2 pt ring that scales 1 → 1.5 and fades over 0.5 s at that slot (canvas x 170, y 300). The header "5 of 12" → "6 of 12" uses `.contentTransition(.numericText())` set from outside. "+ 2 More" stays. Action row: Directions → **"Leave Activity"** (crossfade 0.3 s) |
| 7 callout | 4.60 | callout **"Joined. That's it."** above the action row (canvas y 412), held 1.6 s |
| end | 6.40 | rest |

**Chat honesty.** Beat 6 draws the bar exactly as the shipping app does. `DIPPrototypeApp.bottomAction` returns title "Activity Chat", style `.accent`, icon `event_HeroiconsOutlineChatBubbleOvalLeft` for a joined event. The demo calls the same resolver, `EventBarAction.resolve(...)` (NEW extraction of that switch). It mirrors the current app; it is not a promise of a chat feature. The step copy never mentions chat (see open decision 1).

**Reduce Motion.** Three stills, 0.3 s crossfade, 1.6 s hold each: feed, event page (not joined), joined with callout. The title fades in with no wipe.

**Accessibility**

- VoiceOver description: "Example: a feed of company events, from board games to a hike. Opening Pasta Night and tapping Join the Activity once adds you to Who's Attending, and the bar changes to show you've joined."
- **Accessibility text sizes:** rows "calendar · Browse company events", "hand.tap · Join with one tap", "checkmark.circle · Joined events appear in My Events".

### B2 People & Invites

**Value.** See who's going before you decide, and bring a coworker.

**Copy.** Pill **"Who's going"**. Title **"GO WITH PEOPLE YOU KNOW"**. Body **"See who's going before you decide. Invite a coworker and they can join in one tap."** (without F4: **"See who's going before you decide, by name and team."**). Bar **"What are challenges?"**.

**Stage.** `surfaceMuted`. Host face: yellow square. The canvas opens on B1's final state.

**Storyboard**

| Beat | t | What happens |
|---|---|---|
| 1 zoom | 0.00 | canvas scale 1 → 1.35, anchored on the people row's centre (canvas 195, 300), `stage`, settles ≈ 0.9 |
| 2 participants | 1.00 | ghost presses "+ 2 More". At 1.20, the real `DIPParticipantsScreen(people:participantCount: 6, showsBottomBar: false)` grows out of the row: scale 0.3 → 1 anchored on the capsule, opacity 0 → 1, `expand`, while the zoom eases back to 1.0. Rows read **Maya · Design**, **Theo · Engineering**, **Jun · Finance**, **You**, … (Figtree Bold 18 / Regular 18, 50 pt avatars) |
| 3 back | 2.70 | the list shrinks back into the capsule (reverse, 0.5 s) |
| 4 invite sheet | 3.40 | ghost presses the invite control. **NEW and F4-owned:** no `InviteEntryPoint` exists. Until F4 ships one, the demo uses `DemoInviteChip`, a purple capsule (Inter 14, white, 50 pt) beneath the action row labelled "Invite a coworker". A sheet grows from the chip (top radius 20, scale-from-anchor, `stage`) with three `DIPParticipant` rows. The ghost selects "Priya · Design" at 4.50 (purple checkmark, `hop`) and presses **Send invite** at 5.00 |
| 5 invite sent | 5.10 | the sheet shrinks back into the chip; the chip morphs to "Invite sent" (`actionComplete` gray, `bar`); toast **"Invite sent to Priya"** held 1.0 s |
| 6 flip | 6.50 | canvas `rotation3DEffect` 0 → 90° about y (0.26 s easeIn), content swaps, −90 → 0° (0.30 s easeOut); `EXAMPLE` → `PRIYA'S VIEW` |
| 7 Priya's view | 7.10 | F4 placeholder card **"Theo invited you to Pasta Night"**, Thu · 6:30 PM, with `DIPButton("Accept")` (primary) and `DIPButton("Decline", emphasis: .secondary)`. Ghost presses Accept at 7.60; the card collapses (height → 0, `stage`) |
| 8 back to you | 8.60 | flip back; the people header rolls "6 of 12" → "7 of 12" and the capsule "+ 2 More" → "+ 3 More" (both numeric roll), with the demo ring pulsing on the capsule |
| end | 10.0 | rest |

Without F4, beats 4–8 are left out and the demo ends at 3.2 s.

**Reduce Motion.** Stills: zoomed row → participants list → invite sent → Priya's card → "7 of 12". No flips.

**Accessibility**

- VoiceOver description: "Example: Who's Attending opens a list of coworkers by name and team. Theo invites Priya; on her phone she accepts and the count goes up."
- **Accessibility text sizes:** rows "person.2 · See who's going before you join", "list.bullet · Open the list for names and teams", "envelope · Invite a coworker from your company" (that row only with F4).

### B3 Challenges & Points

**Value.** Challenges say exactly what to do and how to send it. The organizer approves it, then points arrive.

**Copy.** Pill **"Challenges"**. Title **"TAKE ON A CHALLENGE"**. Body **"Each challenge shows what to do and how to send it in. Once your organizer approves, the points are yours."** Bar **"And after the event?"**.

**Stage.** `challengeAccent`. Host face: white pill.

**Storyboard**

| Beat | t | What happens |
|---|---|---|
| 1 card | 0.00 | The canvas starts entirely pink, the Stage colour, so the `DIPChallengeCard` ("COFFEE WITH 3", "+ 12 others participating"), which is the same pink, is invisible. A white panel grows upward from the canvas bottom (height 0 → 315, `stage`), so the top 225 pt are revealed to have been the card all along. The card's text and mascot fade in (0.25 s) |
| 2 requirements | 1.00 | ghost presses the card; card → F3 details (matched frame → header band, `expand`). From 1.40, three lines appear 120 ms apart, each revealed by a left-to-right wipe: **"1 Have coffee with 3 coworkers you haven't met"**, **"2 Send your count, a caption and a photo if you like"**, **"3 Your organizer approves it"**. Reward **"+50 points"** at 1.76. Callout **"How to submit"** at 2.20 |
| 3 entry | 3.00 | mini bar shows the app's current challenge action, **"Add Your Entry"** (from `EventBarAction.resolve`, ink). Ghost presses at 3.30. The F3 form (placeholder until F3 ships) grows from the bar: progress 0 → 1 → 2 → 3 at 3.60 / 3.78 / 3.96 (numeric roll). Caption types by grapheme cluster, 35 ms each (4.10–4.77): "Met Jun from Design". Photo thumbnail grows from a pink square (scale 0.6 → 1, `hop`) at 4.90 |
| 4 waiting | 5.40 | ghost presses Send; yellow pill **"Waiting for approval"** grows from the Send button's frame |
| 5 later | 6.20 | content dims to 80%; chip **"Later"** (ink capsule, white Inter Medium 13) fades in, holds, and leaves by 6.80; dim lifts |
| 6 approved | 6.90 | the pill morphs yellow → purple, text → **"Approved"** (`bar`). At 7.30 a "+50" token follows a scrubbable arc into the points pill (0.55 s). At 7.90 the F2 balance rolls **120 → 170 points** over 0.4 s |
| end | 9.00 | rest |

Without F2, beat 6 ends on "Approved · +50 points" and there is no balance pill.

**Arc implementation.** A `KeyframeTimeline<CGPoint>`: out (+24, −12) at 0.20 s, apex (+60, −60) at 0.35 s, pill centre at 0.55 s, cubic. It is sampled with `value(time:)` from the demo's `t`, so it scrubs. `KeyframeAnimator` is not used inside demos.

**Reduce Motion.** Stills: requirements → filled entry → waiting → approved with points.

**Accessibility**

- VoiceOver description: "Example: a challenge lists its steps and reward before you start. You send your count, a caption and a photo; it waits for organizer approval, then 50 points are added."
- **Accessibility text sizes:** rows "list.number · Each challenge lists what to do", "square.and.arrow.up · Send progress, a caption and an optional photo", "checkmark.seal · Your organizer approves, then points are added".

**Honesty.** No client-side point award is shown. The "Later" chip makes the wait for the organizer explicit.

### B4 Memories

**Value.** My Events holds your upcoming and past events, and past events keep a shared album.

**Copy.** Pill **"Memories"**. Title **"KEEP THE MEMORIES"**. Body **"Your events live in My Events. Past events keep a shared photo album for everyone who went."** Bar **"Make it yours"**.

**Stage.** `notificationAccent` yellow. That is clearly different from B3's pink; B4's neighbours are pink and gray. Host face: gray round.

**Storyboard**

| Beat | t | What happens |
|---|---|---|
| 1 My Events | 0.00 | mini bar action dissolves → tabs; marker Home → My Events (`marker`, settles ≈ 0.6). Callout **"My Events"** above the icon at 0.50, held 1.8 s. My Events content develops in place (blur 6 → 0, opacity, 0.4 s) |
| 2 past | 2.40 | section marker → the past section (`section`, 0.625 s). Callout **"Past events"** at 2.60, held 1.6 s |
| 3 past event | 3.40 | ghost presses "Saturday Hike · Oct 18" (`events-past_EventCard*`) at 3.70. The past event page expands from the card (`expand`): `DIPDetailHero` and "Who Attended". The mini bar shows the app's past-event action, **"View Album"** |
| 4 album | 4.90 | ghost presses the bar; an album grid of six `album_Rectangle93x` thumbnails develops 40 ms apart (blur 6 → 0, scale 0.96 → 1). Bar → **"Add Photos"** |
| 5 upload | 6.00 | ghost presses the bar; a new thumbnail grows out of the bar's capsule with a white progress ring 0 → 1 (0.8 s linear), then settles into slot 1 (`stage`, ≈ 0.9 s), pushing the others along |
| end | 8.00 | rest |

**Dependency.** Tabs here need the Rewards tab hidden (F0) or a `tabs:` parameter (NEW). Without either, beat 1 starts on My Events with no marker move.

**Reduce Motion.** Stills: My Events with callout → past section → album with the new photo.

**Accessibility**

- VoiceOver description: "Example: the My Events tab holds your upcoming and past events. A past event opens its photo album, where you can add your own photos."
- **Accessibility text sizes:** rows "square.grid.2x2 · My Events holds upcoming and past events", "clock.arrow.circlepath · Past events keep their photo album", "photo.badge.plus · Add your own photos".

### B5 Interests

**Value.** Pick what you're into. DIP can filter events by it. This is the only real write in the tour.

**Copy.** Pill **"Your interests"**. Title **"WHAT ARE YOU INTO?"**. Body **"Pick a few. You can filter events by them anytime, and change them in Profile."** Bar **"Save and start"** (`.accent`) with at least one selected, otherwise **"Start exploring"**. Secondary **"Skip for now"**.

**Layout**

- Stage strip: y 134–330 (height 196), `surfaceMuted`, no host face.
- Title at y 352; body under it.
- Embedded picker from y 450 to 705.
- "Skip for now" at y 717–761; Bar at 773.

**Embedded picker API (NEW refactor of `DIPInterestPicker`; no fork).** Today the picker owns `selection`, `isSaving` and `saveError` as `@State`, wraps itself in `NavigationStack` with Save/Cancel toolbar items, shows its own inline "Try again", and calls `dismiss()` after saving. The refactor:

```swift
struct DIPInterestPicker: View {
    // Existing sheet use, unchanged behaviour (Profile).
    init(options: [DIPInterest], selection: Set<String>, onSave: @escaping ([String]) async throws -> Void)
    // Embedded use (onboarding).
    init(options: [DIPInterest], selection: Binding<Set<String>>, embedded: EmbeddedState)
    struct EmbeddedState { var isSaving: Bool; var errorMessage: String? }
}
```

- Both inits render one shared `InterestList` (search, count, rows, empty state, 10-item limit).
- The sheet init wraps it in today's `NavigationStack`, toolbar, inline retry and `dismiss()`.
- The embedded init has no `NavigationStack`, no toolbar, no inline retry button and never calls `dismiss`. It shows `errorMessage` as a non-interactive label at the top of the list and disables rows while `isSaving`. The host owns the selection binding, the save, and the single "Try again" in the Bar.

**Save.** The host builds the edit from the editor's acknowledged profile, because `ProfileEdit.department` and `.city` are non-optional and `MemberProfileBridge.edits` writes them as given:

```swift
let edit = ProfileEdit(department: editor.profile.department, city: editor.profile.city,
                       interestTagIDs: catalogOrdered(selection))   // jobTitle/availability/radius nil = unchanged
try await MemberProfileBridge.save(edit, editor: editor, uid: context.uid)
```

- **While saving:** the Bar reads "Saving…" with progress; the picker is embedded with `isSaving: true`.
- **Success:** `.sensoryFeedback(.success)`, then H.
- **Failure:** `errorMessage` = "Couldn't save your interests. Your choices are kept." The Bar reads **"Try again"** and retries the same edit. "Skip for now" stays available. The selection is kept.

**Live reshape** (with F1).
- The strip shows F1's chip row ("All events" plus the selected interests) above interest cards titled with the catalog's real names, each with a Crew face on a token fill and the locality "Example".
- Selecting an interest grows a chip out of the strip colour (a gray capsule fills white, or purple when selected, scaling 0.6 → 1 with `hop`) and a matching card the same way. `.sensoryFeedback(.selection)`.
- Deselecting collapses both (`stage`).
- "All events" always stays.
- Without F1, the strip shows only the chips.

**Catalog states**

- **Loading:** six `surfaceMuted` rows, 44 pt tall, with the shimmer band. Bar "Start exploring".
- **Failed:** the strip shows the gray-round face, calm. Message under the body: "Your interests couldn't load. You can add them in Profile anytime." Bar "Start exploring". No picker.
- **Empty catalog:** the step is skipped.

**Pre-selection.** `editor.profile.interestTagIds`. The picker enforces the 10-item maximum.

**Reduce Motion.** Chips and cards use 0.12 s opacity. The Stage height change is a crossfade.

**Accessibility**

- The picker keeps its labels, values and hints.
- After each toggle, the strip announces politely, e.g. "3 interests selected".
- **Accessibility text sizes:** no strip; title, body, then picker.

### H Handoff into Home

**What is underneath.** `DIPMemberHome` is the shell. In live mode its body shows `ProgressView("Loading your company events…")` until the live repository exists, `ContentUnavailableView("Events unavailable")` if configuration fails, and then `DIPPrototypeApp`, which shows its own "Loading…" until the first snapshot. So the handoff has three variants.

**Readiness signal (NEW).** An `onFirstContent` callback that `DIPPrototypeApp` fires when `loadedPages` first renders with a snapshot. It is passed through `DIPMemberHome` to the tour.

**H-ready: the window reveal** (t = 0 at the CTA tap or Skip)

| t | Event |
|---|---|
| 0.00 | header, copy and picker leave (`copyOut`). The shell gets `accessibilityHidden(false)` staged for 0.90. The tour's white background is now drawn by `WindowSheet` |
| 0.10 | the Stage's contents crossfade to clear (0.2 s), so the real Home shows through the window |
| 0.20 | the window animates to the full screen bounds and radius 0 with `.spring(response: 0.6, dampingFraction: 0.88)` (settles ≈ 1.0) |
| 0.20 | You (28 pt in the stack) flies to the Home header's profile button, growing to 40 pt (`stage`); the other stack faces fade (0.2 s) |
| 0.30 | Bar action dissolves (`action = nil`): tabs appear with the marker on Home (existing `bar` crossfade) |
| 1.00 | the tour layer is removed. The onboarding bar and the shell's bar share one centre (H − 61), one inset (20) and one state, so removing it changes no pixels |
| 1.00 | VoiceOver: `.screenChanged` focuses the Home header |

`WindowSheet` (NEW) is a custom `Shape`, not a mask:

```swift
struct WindowSheet: Shape {
    var window: CGRect; var radius: CGFloat
    var animatableData: AnimatablePair<AnimatablePair<CGFloat, CGFloat>,
                        AnimatablePair<AnimatablePair<CGFloat, CGFloat>, CGFloat>>  // (x, y), ((w, h), r)
    func path(in rect: CGRect) -> Path {
        var p = Path(rect)                                      // the white sheet
        p.addRoundedRect(in: window, cornerSize: .init(width: radius, height: radius), style: .continuous)
        return p
    }
}
// WindowSheet(window: stageFrame, radius: 20).fill(.white, style: FillStyle(eoFill: true))
```

Even-odd filling leaves the inner rounded rectangle as a hole. The sheet is a filled shape in its own layer above the shell. Nothing is masked; the tour's content sits in another layer above it and fades.

**Profile-button target (NEW constant).** `DIPHomeScreen.profileButtonFrame(width:)` = x `width − 65`, y 65, 40 × 40, derived from `DIPHomeScreen`'s 20 / 60 padding and `DIPHomeHeader`'s 5 pt capsule padding. `DIPHomeScreen` uses the same constant for that padding, so the two can't drift apart.

**H-not-ready.** If `onFirstContent` hasn't fired at t = 0:
- The Bar title → **"Getting your events…"** with progress, for up to 3.0 s, with copy already gone and the Stage showing its last frame.
- If content arrives, run H-ready.
- If not, reveal anyway onto the loading view. The loading views have no bar, so the onboarding Bar fades out (0.25 s) instead of dissolving into tabs. When the shell later renders, its own bar fades in (0.3 s, the shell's existing behaviour).

**H-unavailable** (`eventConfigurationError` or `loadError`):
- Reveal onto `ContentUnavailableView`.
- The Bar fades out (0.25 s); focus goes to that view's title.
- `outcome` is still written, because the tour itself is done.

**Reduce Motion.** Tour → Home crossfade (0.35 s); the Bar crossfades.

**Returning member.** A2 → H-ready in 0.6 s from the resolving composition. The Welcome Stage frame is the window.

**Replay end.** The same reveal, with Profile underneath (the cover uses `.presentationBackground(.clear)`). The window target is full screen; You flies to Profile's large photo. Then the cover is dismissed with `Transaction(animation: nil)`.

## 4. How the steps flow together

### 4.1 Adjacent pairs

| From → To | Shared or morphed | Exits | Overlap |
|---|---|---|---|
| A0 → A1 | Stage, Bar title | — | Crew grow from the Stage colour during the Bar crossfade |
| A1 → A2 | Stage, Crew (gaze), Bar (progress band) | pill text; body dims | simultaneous, 0.3 s |
| A2 → A3 / A4 | Stage fill (pink → tone), formation, rig mood, Bar → primary | A2 copy | formation starts 0.1 s after the fill |
| A3 → A2 (not-found retry) | reverse | notice copy, secondary | same |
| A4 → A0 retry look → A2 | fill → pink, looking pose, Bar progress | notice copy | A0 → A2 changes only the Bar title |
| A2 → B0 | identical frame across the view swap, then Stage geometry and fill, Bar title | — | cheer during the Stage morph |
| B0 → B1 | **You** (88 pt) → stack slot 0 (`matchedGeometryEffect` inside the tour host, `stage`). **Purple** face (88 pt) → host perch (40 pt) on the same namespace. Fill yellow → purple | white, yellow and gray faces shrink to 0.6 and fade into the Stage colour (0.25 s) | B1 develops from 0.52 s |
| B1 → B2 | B2 opens on B1's last frame; zoom; fill purple → gray | callout | purple host → stack; yellow face rises into the perch |
| B2 → B3 | the canvas's mini bar persists; fill gray → pink | the event page is overtaken: the canvas floods pink from the top (a rectangle height 0 → 540, `stage`) before beat 1's white panel rises | yellow host → stack; white pill rises into the perch |
| B3 → B4 | mini bar (action → tabs); fill pink → yellow | challenge content blurs 0 → 6 and fades (0.25 s) as My Events develops | white host → stack; gray face rises into the perch |
| B4 → B5 | Stage bottom edge rises 563 → 330 (`stage`); copy rides on the edge | album content stays anchored to the canvas top and is clipped away by the rising edge (no fade). At 0.40 the canvas swaps to the strip; its chips grow from Stage-coloured capsules | gray host → stack; picker rows come out from under the edge, 30 ms apart, from 0.45 |
| B5 → H | window reveal | copy, picker | — |
| Back (any B) | exact reverse; the previous host leaves the stack and returns to the perch | — | same timings |

Inside the canvas, the miniature follows the app's one-bar rule too: one mini `DIPFloatingNavigation` persists from B1 to B4, and only its action changes.

### 4.2 Progress: the Crew stack and host faces

- **Where faces rest.** Each B1–B4 step has a host face perched on the Stage's top edge: 40 pt, x 322–362, y 114–154, in front of the Stage, clear of the header row (which ends at 114) and of the `EXAMPLE` chip (top-left). Hosts: B1 purple round, B2 yellow square, B3 white pill, B4 gray round. B0's Crew are on the Stage itself; B5 has no host.
- **Entering.** The new host rises from behind the Stage edge (offset +24 → 0 under a mask clipped at the Stage top, `hop`) at 0.20 s into the step change.
- **Leaving.** At 0.05 s into the CTA, the host flies from the perch to the next stack slot. This uses `KeyframeAnimator`, which is fine in tour chrome because it is never scrubbed: up 30 pt at 0.18 s, into the slot at 0.50 s, scale 1 → 0.7 (40 → 28 pt). It lands with `hop`.
- **The stack.** Starts empty at B0. You arrives at B0 → B1, then one host per completed step. After a B5 save, You gains an 8 pt `actionPrimary` dot.
- **Back.** The host pops out of the stack and returns to the perch.
- **Dropped steps.** The stack length equals `1 + available B1–B4 steps`, so a dropped feature leaves no gap.
- **VoiceOver.** The stack is one element, e.g. "Step 2 of 5, Who's going".

### 4.3 Colour choreography

The background is always white. Only the Stage changes:

| Path | Stage fill |
|---|---|
| A0 | pink |
| A1 Welcome | pink |
| A2 Resolving | pink |
| A3 blocked | purple |
| A3 notFound | yellow |
| A4 offline | gray |
| A4 problem | purple |
| B0 Arrival | yellow |
| B1 Discover | purple |
| B2 People | gray |
| B3 Challenges | pink |
| B4 Memories | yellow |
| B5 Interests | gray strip |
| H | clear window |

- Every adjacent pair differs: pink → {purple, yellow, gray}, pink → yellow (B0), yellow → purple → gray → pink → yellow → gray.
- A0, A1 and A2 are deliberately one continuous pink. They are one view, and their changes are carried by the Bar and Crew.
- `eventsAccent` (#F054A5) isn't used; it is too close to `challengeAccent`.
- Text never sits on yellow or pink. Titles are below the Stage, and the chip, callouts and pills carry their own backgrounds.

## 5. Architecture and build plan

### Files

**`ui/Packages/DIPCore/Sources/DIPCore/Onboarding/`** (NEW, pure, measured by `swift test`)

- `OnboardingStep.swift`: the step enum; `OnboardingFeatures: OptionSet` (`.invites`, `.challenges`, `.points`, `.albums`, `.interestFilter`); `availableSteps(features:catalogEmpty:)`.
- `OnboardingFlow.swift`: a value-type machine with `next()`, `back()`, `skip()`, `beginHandoff()`, `resume(record:features:)` and modes `.firstRun` / `.replay`. Transitions return `(Flow, [Effect])`, where an effect is `.persist(record)` or `.announce(String)`.
- `OnboardingRecordStore.swift`: the protocol (`record(for:)`, `save(_:for:)`, `isComplete(uid:)`) and `UserDefaultsOnboardingRecordStore(defaults:)`.
- `DemoTimeline.swift`:
  - `DemoBeat<Action> { at: Duration; action: Action; animation: AnimationSpec }`
  - `DemoScript<State>`
  - `state(at:)`, a deterministic fold
  - `beats(between:and:)`
  - `stills: [Duration]`
  - `AnimationSpec` is a plain enum (spring response and damping, or easing and duration), so the core needs no SwiftUI.
  - Continuous parameters (reveal radius, scroll offset, ring progress, typed characters) are pure functions of `t` inside the state.

**`ui/DIP/Features/Onboarding/`** (NEW, app target)

- `Stage/DemoStage.swift`:
  - Renders `Scene.body(state)` on the 390 × 540 canvas with `.scaleEffect(0.691)` and `.compositingGroup()`.
  - Applies `.allowsHitTesting(false)` and `.environment(\.dynamicTypeSize, .large)`.
  - Exposes one accessibility element: `.accessibilityElement(children: .ignore)`, label "Example", value = description, identifier `onboarding.stage`, action "Replay".
  - **Playback:** a `Task` on `ContinuousClock` sleeps until each beat and applies its discrete state inside `withAnimation(spec)`. For continuous parameters inside a beat, a `TimelineView(.animation(paused: !playing))` exists only for that beat's duration and sets `t`, which `state(at:)` maps to values. Keyframed values use `KeyframeTimeline.value(time:)`.
  - **Scrubbing:** sets `t` and applies `state(at: t)` under `Transaction(animation: nil)`.
  - **Pausing:** on `onDisappear`, and whenever `scenePhase != .active`; it resumes from the start of the current beat.
- `Stage/DemoScene.swift`: the protocol (`State`, `script`, `finalState`, `description`, `reducedStills`, `host: CrewMember`).
- `Stage/GhostTouch.swift`, `Stage/DemoCallout.swift`, `Stage/DemoInviteChip.swift` (placeholder, deleted when F4 ships).
- `Scenes/DiscoverJoinScene.swift`, `PeopleInviteScene.swift`, `ChallengeScene.swift`, `MemoriesScene.swift`, `InterestStripScene.swift`: one file each, so a feature can be dropped by removing its scene and flag.
- `Fixtures/OnboardingDemoFixtures.swift`: fictional events, people and covers. Crew avatars are rendered once with `ImageRenderer(content:).uiImage?.pngData()` → `MediaReference.data`, cached in memory per scale.
- `Tour/OnboardingTourView.swift`: header (back, step pill, `CrewStack`, Skip), Stage, host perch, entrance characters, Bar, accessibility focus, accessibility-size layouts.
- `Tour/WindowSheet.swift`, `Tour/HandoffController.swift`: readiness wait, the three H variants, replay end.
- `Tour/OnboardingCopy.swift`: every string through the String Catalog, including the copy variants that depend on features.

**`ui/DIP/Features/Accounts/`**

- `AccountsOnboarding.swift`: split `AccountsRoute.progress(String)` into `.pending` and `.resolving`.
- `AccountsStageView.swift` (NEW): one view for A0–A4, driven by `AccountsNotice` copy.
- **Character rig** (move `OnboardingFaces.swift` to `Features/Shared/Characters/`). `FaceFeatures` gets three animatable values:

```swift
var smile: Double     // −1 worried … 0 calm … 1 happy (mouth control-point y: mouthY − 0.12h … +0.16h)
var eyeOpen: Double   // right eye only: 1 open … 0 wink
var gaze: Double      // −1 … 1: eyes x ± 0.06w, mouth x ± 0.03w
var animatableData: AnimatablePair<Double, AnimatablePair<Double, Double>> {
    get { .init(smile, .init(eyeOpen, gaze)) }
    set { smile = newValue.first; eyeOpen = newValue.second.first; gaze = newValue.second.second }
}
```

- **Wink path.** The right eye is one straight stroke through the eye centre `c`, at angle `θ = 90° · eyeOpen` and half-length `L = lerp(eye / 1.5, eye / 2, eyeOpen)`. That gives a vertical stroke of length `eye` when open and a horizontal stroke of length `1.33 · eye` when winking. At `eyeOpen = 0.5` it is a 45° stroke of half-length `0.58 · eye`. It is continuous because only angle and length interpolate. Because the wink runs 0.12 s closing, 0.3 s held and 0.16 s opening, the diagonal shows for about 4 frames and reads as a squint.
- The existing `Mood` enum maps to rig presets: happy (1, 1, 0), calm (0, 1, 0), worried (−0.6, 1, 0), wink (1, 0, 0). Current callers don't change.

**Integration points**

- `DIPMemberHome.body`: wrap in a `ZStack` and add `OnboardingTourView` when `!store.isComplete(uid: context.uid)`, passing `editor`, `catalog`, `context.profile.displayName`, `OnboardingFeatures` (static flags in `OnboardingFeatureFlags.swift`), and the `onFirstContent` signal. While the tour is up, the content underneath gets `allowsHitTesting(false)` and `accessibilityHidden(true)`.
- `DIPPrototypeApp`: add an `onFirstContent` callback (NEW).
- `DIPProfileScreen`: add a "How DIP works" row with an `onHowDIPWorks` callback (NEW).
- `DIPInterestPicker`: the embedded init described in B5 (NEW refactor).

**Shared choke points** (integrator PR, additive only)

- `DIPBottomBarAction.showsProgress: Bool = false` (NEW): the moving gradient band, or a static `ProgressView` in the icon circle under Reduce Motion.
- `DIPFloatingNavigation.barCenterInset = 61` and `horizontalInset = 20` (NEW constants), used by `DIPPrototypeApp`, `DIPEventDetailsScreen`, `DIPParticipantsScreen`, `WelcomeView` and the tour.
- `DIPFloatingNavigation` optional `tabs:` parameter (NEW, coordinated with F0).
- `EventBarAction.resolve(route:snapshot:pending:)` (NEW): extracted from `DIPPrototypeApp.bottomAction` without changing behaviour, used by the shell and the demos.
- `DIPHomeScreen.profileButtonFrame(width:)` (NEW constant).

### Demos reuse real components safely

- Demos receive only fixture values and no-op closures, and never touch a repository.
- The canvas has hit-testing off and is one accessibility element.
- Demos use the same public or internal inits the app uses, so component changes appear in the tour automatically.
- Where a full screen includes out-of-scope or layout-specific chrome (`DIPHomeHeader`'s bell, `DIPDetailHeader`'s 60 pt top padding), the demos compose the shared subcomponents instead.

### Tests

**DIPCore unit tests**

- **Flow:** every transition, back at the first step, skip from each step, handoff idempotency, resume clamping when a flag removes the stored step, replay never persisting, record version mismatch.
- **Store:** round trip on `UserDefaults(suiteName:)`, uid isolation, `isComplete`.
- **Timeline:**
  - `state(at:)` is deterministic.
  - Scrubbing forward and backward converges to the same state.
  - The final state equals the end of the fold.
  - `stills` are ordered and within the timeline.
  - Continuous parameters are monotone where specified (reveal radius, ring progress).

**App-level unit tests**

- `AccountsRoute` with the new `.pending` / `.resolving` split.
- `AccountsStageView` route → formation / colour / Bar mapping, including the A4 → A0 retry look.
- `EventBarAction.resolve` is identical to today's `bottomAction` for every route and state (a regression table).
- The B5 edit carries the editor's department and city.
- The embedded picker never calls dismiss and shows no inline retry.
- `WindowSheet` animatable data round trip.

**UI tests** (`DIPUITests`)

- Launch arguments (Debug only): `-onboarding.reset`, `-onboarding.timeScale 8`, `-onboarding.reduceMotion` (an environment override; Reduce Motion can't be toggled reliably from a test), and `-onboarding.freezeAt <scene>@<seconds>`, which renders `state(at:)` with animations off for the §7 screenshot comparison.
- Identifiers: `onboarding.next`, `.back`, `.skip`, `.stage`, `.replay`, `.interests.save`, `.crewStack`.
- Flows:
  - full first run to Home with `home.tab.home` selected
  - skip at B2
  - kill and relaunch at B3 resumes B3
  - the tour isn't shown on second launch
  - replay from Profile
  - interest save failure then Bar retry
  - H-not-ready (delayed mock) and H-unavailable
- **Accessibility audit.** `performAccessibilityAudit()` on every step, at default size and at `UICTContentSizeCategoryAccessibilityXXXL`. The issue handler ignores only:
  - `.dynamicType` and `.textClipped` issues whose element identifier is `onboarding.stage`. The canvas is one element with a fixed type size by design; its content is described in its value.
  - `.dynamicType` issues on the Bar's action identifiers. The Bar title is a fixed Figtree 24 with `minimumScaleFactor(0.4)` today. That is existing debt, tracked under F6.
  - Every other issue fails the test.
- **Figma comparison.** Each §7 frame names a `freezeAt` capture. A UI test saves iPhone 17 Pro screenshots for side-by-side review. This is a manual review, not a pixel-diff gate.

**Render checks.** `ImageRenderer` renders each scene's `finalState` and each reduced still: non-empty, no layout warnings. Standard and Reduce Motion GIFs go to `ui/ComponentPreview/Review/Motion/onboarding-*.gif`, following `docs/design/motion.md`.

**Manual.** VoiceOver walkthrough, Low Power Mode run, and iPhone SE / 12 / 17 Pro passes, recorded in the session log.

### Accessibility-size layouts (summary)

When `dynamicTypeSize.isAccessibilitySize`, every step scrolls with the Bar pinned, and the Stage is replaced:

| Step | Replacement |
|---|---|
| A1 / A2 | no Stage (as today) |
| A3 / A4 | no face card (as today); title, message, secondary, Bar |
| B0 | a 56 pt You avatar above the title |
| B1–B4 | three SF Symbol rows, as listed in each step |
| B5 | picker only |

The header pill and Skip wrap to two rows. Focus order per step: step pill (header, "Step n of m") → title (header) → body → Stage description → Bar → Skip → Back. Every step change moves `@AccessibilityFocusState` to the title and posts `.screenChanged`. Back is also available as `.accessibilityAction(named: "Previous step")`.

### Performance budget

- 60 fps on iPhone 12. Animation-hitch ratio under 5 ms/s in Instruments during every step change and every demo beat.
- At most 12 views animating at once.
- **Idle means no animations running.** Once a demo rests and no transition is in flight, nothing redraws.
- **Loops that do run while visible:**
  - the A0/A2 progress band (one gradient offset per frame, main thread)
  - the A2 gaze (4 face paths recomputed per frame)
  - the Welcome reel (a spring every 2.4 s, 3 cycles)
  - Each stops when its route is left, when `scenePhase != .active`, and (reel, gaze) in Low Power Mode.
- Per-beat `TimelineView`s exist only for the duration of their beat.
- No `Canvas`.
- Covers and album images are pre-decoded and downsampled to 2× canvas size in a `.task` one step ahead.
- Crew PNGs are rendered once.
- At most +30 MB memory during the tour.
- **Low Power Mode** (`ProcessInfo.isLowPowerModeEnabled` plus `NSProcessInfoPowerStateDidChange`): no reel or gaze, and demos open on their final frame unless Replay is pressed.

### Phased delivery (S ≈ 1 day, M ≈ 2–3, L ≈ 4–6)

| Phase | Scope | Size | Depends on |
|---|---|---|---|
| P0 | DIPCore flow, store and timeline with tests; route split; Profile row; skip/resume plumbing behind a flag | S–M | approval of O |
| P1 | `AccountsStageView` (A0–A4): rig, formations, colours, retry paths, Bar progress, Reduce Motion and accessibility sizes | M | integrator PR (`showsProgress`, bar constants) |
| P2 | Tour shell: layout, entrance characters, Stage colours, host perch and stack, back/skip, B0, `WindowSheet` reveal with all three H variants, `onFirstContent` | M–L | P0, P1 |
| P3 | DemoStage engine + B1 | M | P2, `EventBarAction` extraction |
| P4 | B5 with the embedded picker refactor; live reshape when F1 lands | M | P2; F1 |
| P5 | B4 | S–M | F0 tabs and labels, album mock or F5 |
| P6 | B2 | M | F4 UI, which replaces `DemoInviteChip` |
| P7 | B3 | M | F3 form, F2 balance |
| P8 | Polish: haptics, Instruments, GIFs, accessibility audits, Figma comparison | S | all |

P0–P4 is the realistic V2 target. P5–P7 switch on as their features land.

## 6. Risks, open decisions and inputs needed

### Risks and hard parts

- **No matched geometry across the account-to-member swap.** `AccountsRootView` replaces the view tree when the member route arrives. Continuity relies on identical first frames, guarded by a test that compares the A2 last-frame geometry constants with B0's first frame.
- **No anchor preferences through `UIPageViewController`.** `DIPSlidingPages` hosts Home in UIKit, so the handoff uses a window sheet and a shared profile-button constant instead of a matched card.
- **The shell may not be ready at handoff.** Live loading and configuration errors replace `DIPPrototypeApp`, along with its bar. That is why there are three H variants. The "no pixel change" guarantee holds only for H-ready.
- **Spring timing.** `stage` settles in about 0.9 s and `expand` in about 0.8 s. Every geometry-dependent beat waits that long. Shortening a spring means re-checking the beat table; a unit test asserts that each targeting beat's start ≥ the previous beat's start + its spring's settle time.
- **Scaled canvases.** `matchedGeometryEffect` ignores `scaleEffect`, so matching happens only inside the canvas (cover → hero) or only in tour chrome (You → stack, host flights). Never across the scale boundary.
- **Scrubbing.** Only `state(at:)`-driven values scrub. Any future beat built with `KeyframeAnimator` or a `ScrollView` scroll would break scrubbing and `freezeAt`. Code review checks for this.
- **Demos drifting from components.** Reusing components prevents visual drift, but ghost targets and zoom anchors are canvas coordinates. Mitigations: render checks, `freezeAt` captures, and GIF re-recording listed in the PR template for design-system changes.
- **Placeholders.** `DemoInviteChip`, the F3 entry form and the F2 balance are placeholders until those features exist. Their Figma frames are marked as such and must be redrawn.
- **Figma staleness.** The build wins. Frames are redrawn from `freezeAt` captures, not the other way round.
- **Schedule.** This is significant polish on an uncommitted item 24 days before release. Start P0–P3 only once F1–F4's core rows are on track.
- **Localization.** Captions type by grapheme cluster. Long German Bar titles rely on the existing 0.4 minimum scale. Callouts wrap to two lines.

### Open decisions

1. **The joined bar title.** The app ships "Activity Chat" (accent, chat icon) and the demo mirrors it through `EventBarAction.resolve`. Chat is stretch V2-S01, and testers expected a real conversation. If chat doesn't ship, should joined read **"You're going"** in `.complete` style? The app decides; the demo follows automatically.
2. **Filter preselection.** Does Home open filtered by saved interests (F1 decision 2)? B5's copy works either way.
3. **Re-showing the tour.** Should a future content version re-show it once (bump the key to `v2`), or never?
4. **Demo names and challenge example.** Are "Maya, Theo, Jun, Priya" and "Coffee with 3" approved?
5. **The invite control** (F4) replaces `DemoInviteChip`; its placement sets B2 beat 4's ghost target.

### Needed from others

- **Owner:** approve O (this tour replaces O1; O2 merges into B5).
- **Integrator:** `showsProgress`, the bar constants, `tabs:`, the `EventBarAction` extraction, `profileButtonFrame`, `onFirstContent`.
- **F0:** Rewards hidden and the past-events label.
- **F1 / F2 / F3 / F4:** chip row, balance, entry form, invite control and invitation card components.
- **Design review:** sign off the colour sequence, entrance characters and rig expressions on the §7 frames and GIFs.
- **Figma builder:** draws §7 on a new "Onboarding" page in `DCIagJo7uk5IOUGqlKzAjf`, reviewed before anything is published.
- **One copy pass** by a non-team reader on the challenge explanation (V2 handoff checklist).

## 7. Figma reference frames

These are static keyframes for visual reference and for later side-by-side comparison with `freezeAt` screenshots. All frames are **402 × 874** (iPhone 17 Pro points), named by the step IDs used above, in flow order. Only existing tokens, fonts, components and character art are used. Placeholder components are labelled.

### 7.1 Conventions

**Colours**

| Token | Hex |
|---|---|
| `surfaceDefault` | #FFFFFF |
| `surfaceMuted` | #ECECEC |
| ink (`textPrimary`, `navigationBackground`) | #1E212B |
| `actionPrimary` | #7B88FA |
| `challengeAccent` | #FB72E4 |
| `notificationAccent` | #FFCC3E |
| `actionComplete` | #CCCCCC |

**Fonts:** Fjalla One Regular (display, uppercase), Figtree Regular / Bold, Inter Regular / Medium / Light Italic. **Radii:** card 20, pill 25, bar = full capsule (80 pt).

**Characters.** `OnboardingFace`: an ink disc with a coloured figure offset down 16% of its size, and ink stroke features.
- **P** purple round
- **W** white pill
- **Y** yellow square
- **G** gray round
- **You** = `DIPAvatar` initials "S" (ink) on #ECECEC with a 3 pt white ring
- Moods: happy, calm, worried, wink.

**Sign-in geometry** (A frames)

- Status bar y 0–62.
- Stage x 20, y 60, 362 × 225, radius 20.
- Title x 20, y 307, Fjalla One 40.
- Body Inter 16, 10 pt below the title.
- Footnote (A1 / A2) Inter 13, centred, y ≈ 729–761.
- Secondary text action (A3 / A4) Figtree 17, centred, y 717–761.
- **Bar** x 20, **y 773–853**, ink, title Figtree 24 white, icon circle 64 pt with an 8 pt trailing inset.

**Tour geometry** (B frames)

- Header y 70–114: back circle (44, #ECECEC), step pill (x 72, #7B88FA, Figtree 20 white), stack (28 pt faces, −8 overlap), "Skip" (Figtree 17, ink 70%, trailing at 382).
- Stage x 20, y 134, 362 × 429, radius 20.
- `EXAMPLE` chip x 32, y 145, height 22, Inter Medium 11, ink on white 85%.
- Host face 40 pt at x 322, y 114.
- Canvas x 66, y 174, 269.5 × 373, white, radius 16. It is 390 × 540 at scale 0.691; draw its contents at that scale. The canvas mini bar is at canvas y 439–519.
- Replay button 44 pt at x 336, y 507.
- Title x 20, y 585, Fjalla One 34. Body Inter 16.
- **Bar** x 20, **y 773–853**.

**Callouts.** Put annotations to the right of the frame: Inter Medium 13, ink on #ECECEC, radius 8, with a 1 pt ink connector to the moving element. Copy the text exactly.

### 7.2 Frames

**1 · `Onboarding / A1 Welcome / rest`**

- **Capture:** `welcome@3.0`
- **On screen:**
  - Stage #FB72E4 with P, W, Y, G at 88 pt (overlap −19, centre y 196).
  - Pill "Board game lunch" (white, height 32, Inter 15) centred at y 98.
  - Title "MEET YOUR TEAM OUTSIDE WORK".
  - Body: "Board games, cooking nights, hikes and more. See which coworkers are going and join in one tap."
  - Footnote: "Use your work Google account. We find your company from your email."
  - Bar "Continue with Google".
- **Callouts:**
  - "Faces grow from Stage colour · scale 0.6 → 1 · spring 0.36 / 0.62 · 60 ms stagger"
  - "Title rises from behind Stage edge · offset −36 → 0 · spring 0.55 / 0.86"

**2 · `Onboarding / A1 Welcome / reel`**

- **Capture:** `welcome@2.6`
- **On screen:** as frame 1, except "Board game lunch" is leaving upward (y −10, 50%), "Pasta night" is entering from below (y +10, 50%), and Y is raised 6 pt.
- **Callouts:**
  - "Pill push from bottom · spring 0.45 / 0.85 · every 2.4 s · 3 cycles then rest"
  - "One face hops 6 pt · spring 0.36 / 0.62"

**3 · `Onboarding / A2 Resolving / looking`**

- **Capture:** `resolving@0.9`
- **On screen:**
  - Stage #FB72E4; faces' eyes shifted right (gaze +1).
  - Pill "Looking for your team…".
  - Body at 45%; footnote kept.
  - Bar "Finding your company…" with a white 25% band, 80 wide, at x ≈ 165.
- **Callouts:**
  - "Band offset sweep · linear 1.4 s · repeats while resolving"
  - "Gaze −1 → +1 → 0 · 1.2 s easeInOut · only while resolving"
  - "Body dims to 45% · 0.30 s"

**4 · `Onboarding / A2 Resolving / reduce motion`**

- **Capture:** `resolving@0.9`, reduce motion
- **On screen:** as frame 3, except gaze 0, no band, and a white 64 pt circle with an ink spinner at the Bar's trailing edge.
- **Callouts:**
  - "Reduce Motion: no band, gaze or hops"
  - "Progress circle fades in · 0.12 s"

**5 · `Onboarding / A3 No company / personal email`**

- **Capture:** `blocked@1.0`
- **On screen:**
  - Stage #7B88FA. Y at 120 pt, worried, centre y 172. P, W, G at 88 pt, 28 pt back, 35% opacity.
  - Title "USE YOUR WORK ACCOUNT".
  - Body: "DIP finds your company from your work email, so personal Gmail and iCloud accounts can't join."
  - Bar "Use a different account". No secondary.
  - Copy variants on the same frame:
    - "THIS ACCOUNT BELONGS TO ANOTHER COMPANY" / "Sign in with the Google account you use at that company."
    - "WE COULDN'T VERIFY THIS ACCOUNT" / "Sign in with a work Google account that has a verified email."
- **Callouts:**
  - "Stage pink → purple · spring 0.55 / 0.86"
  - "Mood happy → worried · smile 1 → −0.6 · 0.40 s · others back 28 pt, 35%"
  - "Title drops from Stage edge · spring 0.40 / 0.80 · haptic .warning once"

**6 · `Onboarding / A3 No company / company not found`**

- **Capture:** `notFound@1.4`
- **On screen:**
  - Stage #FFCC3E. A purple pill face (fill #7B88FA) at 120 pt, calm, eyes left.
  - Title "YOUR COMPANY ISN'T HERE YET".
  - Body: "We couldn't find your company yet. Ask your organizer to add your email domain, then try again."
  - Secondary "Use a different account". Bar "Try again".
- **Callouts:**
  - "Stage pink → yellow · spring 0.55 / 0.86"
  - "Gaze left / right twice · 0.5 s each · easeInOut"
  - "Try again → straight back to Resolving (retryMembership)"

**7 · `Onboarding / A4 Problem / offline`**

- **Capture:** `offline@1.0`
- **On screen:**
  - Stage #ECECEC. A white round face at 120 pt, calm. G and P at 64 pt at 35%, linked by a dashed 2 pt ink line broken in the middle.
  - Title "YOU'RE OFFLINE". Body "Check your connection, then try again."
  - Secondary "Sign out". Bar "Try again".
- **Callouts:**
  - "Dashed link breaks · trim 1 → 0.4 · 0.35 s easeOut · once"
  - "Try again → A0 retry look → Resolving (restart)"

**8 · `Onboarding / A4 Problem / something went wrong`**

- **Capture:** `problem@1.0`
- **On screen:**
  - Stage #7B88FA. A pink round face (#FB72E4) at 120 pt, worried, rotated 2°.
  - Title "SOMETHING WENT WRONG". Body "Please try again."
  - Secondary "Sign out". Bar "Try again".
  - The same frame covers "TOO MANY TRIES", "WE COULDN'T LOAD YOUR PROFILE" and "SIGN-IN ISN'T AVAILABLE" (no secondary on the last).
- **Callouts:**
  - "Wobble ±2° twice · 0.6 s · on arrival"
  - "Reduce Motion: fill + copy crossfade 0.25 s, no wobble"

**9 · `Onboarding / A3-A4 Notice / accessibility XXXL`**

- **Capture:** `blocked@final` at AX XXXL
- **On screen:** no Stage. Title "USE YOUR WORK ACCOUNT" at the largest size, wrapping to about 4 lines; body wrapping and scrolling; Bar "Use a different account" pinned at y 773.
- **Callouts:**
  - "AX sizes: face card hidden · content scrolls · Bar pinned"
  - "Focus moves to title on arrival"

**10 · `Onboarding / B0 Arrival / rest`**

- **Capture:** `arrival@1.4`
- **On screen:**
  - Header: "Skip" only.
  - Stage #FFCC3E at tour geometry. P, W, Y, G at 88 pt, spread 24 pt, with You at 88 pt in the centre. Y winks.
  - Title "YOU'RE IN, SAM".
  - Body: "Here's how DIP gets your team together. It takes about a minute."
  - Bar "Show me around".
- **Callouts:**
  - "Stage y 60 → 134, 225 → 429 pt, pink → yellow · spring 0.55 / 0.86 · from Resolving's last frame"
  - "You grows from Stage colour · scale 0.4 → 1 · spring 0.36 / 0.62 · at 0.25 s"
  - "Title word by word · 70 ms apart · with the cheer"

**11 · `Onboarding / B0 Arrival / accessibility XXXL`**

- **Capture:** `arrival@final` at AX XXXL
- **On screen:** "Skip" at the top; You at 56 pt; title "YOU'RE IN, SAM" wrapping; body; Bar "Show me around" pinned.
- **Callouts:**
  - "AX sizes: Stage replaced by You avatar · scrolls"

**12 · `Onboarding / B0→B1 Transition / You to stack`**

- **Capture:** `transition.arrival-discover@0.40`
- **On screen:**
  - Stage midway from #FFCC3E to #7B88FA.
  - You at about 50 pt in flight toward the stack slot after the pill.
  - P at about 60 pt moving toward the perch at x 322, y 114.
  - W, Y and G at 0.6 scale and 30% opacity.
  - Old copy gone. Pill "Find events" fading in. Bar "See who's going".
- **Callouts:**
  - "You 88 → 28 pt into stack · matched geometry · spring 0.55 / 0.86"
  - "Purple face 88 → 40 pt to perch · same spring"
  - "Other faces shrink into Stage colour · 0.25 s"

**13 · `Onboarding / B1 Discover & Join / beat 1 develop`**

- **Capture:** `discover@0.30`
- **On screen:**
  - Stack [You]; perch P.
  - Canvas mostly purple, with a circular white reveal (about 55% radius) showing "Upcoming events" and the first two `DIPPhotoEventCard`s ("BOARD GAME LUNCH" cover_games "5 Attending"; "PASTA NIGHT" cover_cooking) at scale 0.97.
  - Title "FIND SOMETHING FUN" half-wiped from the left.
  - Body: "Company events, from lunchtime board games to weekend hikes. Tap Join once and you're on the list."
  - Bar "See who's going".
- **Callouts:**
  - "Canvas develops from Stage purple · radial mask 0 → 340 · spring 0.55 / 0.86"
  - "Cards 0.94 → 1 · spring 0.50 / 0.86 · 50 ms stagger"
  - "Title wipe left → right · 24 pt feather · 0.45 s easeOut"

**14 · `Onboarding / B1 Discover & Join / beat 4 event page`**

- **Capture:** `discover@3.80`
- **On screen:**
  - Canvas: `DIPDetailHero` cover_cooking (350 × 264, radius 20, top 90 cropped).
  - "PASTA NIGHT" (Fjalla One 40).
  - `DIPDetailPeopleRow` "Who's Attending" with "5 of 12" and P, Y, G (40 pt), plus the "+ 2 More" ink capsule.
  - Action row "Directions" (purple) | "Share Event" (pink #F054A5, the component's own share colour).
  - Mini bar "Join the Activity" (ink); ghost on the mini bar.
- **Callouts:**
  - "Card → hero · matched geometry · radius 20 throughout · spring 0.50 / 0.86"
  - "Rows grow from hero's bottom edge · 60 ms stagger"
  - "Mini bar tabs → 'Join the Activity' · crossfade 0.30 s easeOut"

**15 · `Onboarding / B1 Discover & Join / beat 6 joined`**

- **Capture:** `discover@6.40`
- **On screen:** as frame 14, except:
  - Mini bar fill #7B88FA, "Activity Chat", white 64 pt circle with `event_HeroiconsOutlineChatBubbleOvalLeft`.
  - People row: P, Y, G, You; "6 of 12"; "+ 2 More".
  - Action row "Leave Activity" (ink) | "Share Event".
  - Callout "Joined. That's it."
  - No ghost; replay button visible.
- **Callouts:**
  - "Bar ink → purple, title crossfade · 0.30 s easeOut · mirrors app (EventBarAction.resolve)"
  - "Icon circle · scale 0.3 → 1 · spring 0.45 / 0.68"
  - "'5 of 12' → '6 of 12' numeric roll · ring pulse on 4th avatar 0.5 s"

**16 · `Onboarding / B1 Discover & Join / reduce motion`**

- **Capture:** `discover@final`, reduce motion
- **On screen:** frame 15 without the ghost, plus three 6 pt ink dots centred at y 571 with the third filled.
- **Callouts:**
  - "Reduce Motion: 3 stills · crossfade 0.30 s · hold 1.6 s"
  - "No reveal, wipe, flight or spring"

**17 · `Onboarding / B1 Discover & Join / accessibility XXXL`**

- **Capture:** `discover@final` at AX XXXL
- **On screen:**
  - The header wraps to two rows; no Stage.
  - Title, then body.
  - Rows: `calendar` "Browse company events", `hand.tap` "Join with one tap", `checkmark.circle` "Joined events appear in My Events".
  - Bar "See who's going".
- **Callouts:**
  - "AX sizes: Stage → 3 static rows · scrolls · Bar pinned"

**18 · `Onboarding / B1→B2 Transition / host face to stack`**

- **Capture:** `transition.discover-people@0.35`
- **On screen:**
  - Stage midway from #7B88FA to #ECECEC.
  - P at about 32 pt mid-arc toward the stack slot after You.
  - Y half-risen behind the Stage top edge at the perch.
  - Canvas at zoom 1.12 on the people row.
  - Title "GO WITH PEOPLE YOU KNOW" with its words still ±9 pt apart.
  - Pill "Who's going".
- **Callouts:**
  - "Host → stack · keyframes up 30 pt at 0.18 s, slot at 0.50 s · 40 → 28 pt"
  - "Next host rises from behind Stage edge · +24 → 0 · spring 0.36 / 0.62"
  - "Words gather · ±18 pt → 0 · spring 0.36 / 0.62"

**19 · `Onboarding / B2 People & Invites / beat 2 participants`**

- **Capture:** `people@2.20`
- **On screen:**
  - Stack [You, P]; perch Y.
  - Canvas: `DIPParticipantsScreen` header "6 Participants" (purple outline pill). Rows (50 pt avatar, Figtree Bold 18 name, Regular 18 department): Maya · Design, Theo · Engineering, Jun · Finance, You.
  - Title "GO WITH PEOPLE YOU KNOW".
  - Body: "See who's going before you decide. Invite a coworker and they can join in one tap."
  - Bar "What are challenges?".
- **Callouts:**
  - "List grows from '+ 2 More' · scale 0.3 → 1 · spring 0.50 / 0.86"
  - "Zoom 1.35 → 1 · spring 0.55 / 0.86"

**20 · `Onboarding / B2 People & Invites / beat 4 invite sheet`**

- **Capture:** `people@4.70`
- **On screen:**
  - Canvas: the joined event page behind. `DemoInviteChip` "Invite a coworker" (purple, Inter 14 white) **[placeholder until F4]**.
  - A sheet (white, top radius 20) with three participant-style rows. "Priya · Design" is checked with a purple `checkmark.circle.fill`.
  - `DIPButton` "Send invite" (primary).
- **Callouts:**
  - "Sheet grows from the chip · spring 0.55 / 0.86"
  - "Checkmark · spring 0.36 / 0.62"

**21 · `Onboarding / B2 People & Invites / beat 5 invite sent`**

- **Capture:** `people@5.60`
- **On screen:** the sheet is gone; the chip is now "Invite sent" (#CCCCCC); toast "Invite sent to Priya" (ink capsule, white Inter 14) above the mini bar.
- **Callouts:**
  - "Sheet shrinks into chip · chip → gray 'Invite sent' · 0.30 s"
  - "Toast holds 1.0 s"

**22 · `Onboarding / B2 People & Invites / beat 7 Priya's view`**

- **Capture:** `people@7.40`
- **On screen:**
  - Chip `PRIYA'S VIEW`.
  - Canvas card **[placeholder until F4]**: white, radius 20, 1 pt #ECECEC stroke. Avatar G (Theo), "Theo invited you to Pasta Night" (Figtree 18), "Thu · 6:30 PM · Office kitchen" (Inter 14), `DIPButton` "Accept" (#7B88FA) and "Decline" (#ECECEC).
  - Ghost on Accept.
- **Callouts:**
  - "Flip · rotate Y 0 → 90° 0.26 s easeIn, −90° → 0° 0.30 s easeOut"
  - "Accept → card collapses · spring 0.55 / 0.86 · back: '7 of 12', '+ 3 More'"

**23 · `Onboarding / B2 People & Invites / reduce motion`**

- **Capture:** `people@final`, reduce motion
- **On screen:** the joined event page with "7 of 12" and "+ 3 More", chip "Invite sent", and five still dots (fifth filled).
- **Callouts:**
  - "Reduce Motion: 5 stills · crossfade 0.30 s · no flip, zoom or growth"

**24 · `Onboarding / B3 Challenges & Points / beat 2 requirements`**

- **Capture:** `challenge@2.60`
- **On screen:**
  - Stack [You, P, Y]; perch W. Stage #FB72E4.
  - Canvas: pink header band "COFFEE WITH 3" (Fjalla One 40, white). Lines in Inter 16 ink: "1 Have coffee with 3 coworkers you haven't met", "2 Send your count, a caption and a photo if you like", "3 Your organizer approves it". "+50 points" (Figtree 18). Callout "How to submit".
  - Mini bar "Add Your Entry" (ink).
  - Title "TAKE ON A CHALLENGE".
  - Body: "Each challenge shows what to do and how to send it in. Once your organizer approves, the points are yours."
  - Bar "And after the event?".
- **Callouts:**
  - "Card revealed by white panel rising from canvas bottom · spring 0.55 / 0.86"
  - "Lines wipe in · 120 ms apart"
  - "Title stamped · scale 1.12 → 1 · spring 0.30 / 0.70"

**25 · `Onboarding / B3 Challenges & Points / beat 4 waiting for approval`**

- **Capture:** `challenge@5.90`
- **On screen:**
  - Canvas entry **[placeholder until F3]**: "3 coworkers", caption "Met Jun from Design", thumbnail album_Rectangle931.
  - Pill "Waiting for approval" (#FFCC3E, ink Inter 14).
- **Callouts:**
  - "Pill grows from Send button frame · spring 0.36 / 0.62"
  - "Progress 0 → 3 numeric roll · caption types 35 ms per character"

**26 · `Onboarding / B3 Challenges & Points / beat 5 later chip`**

- **Capture:** `challenge@6.50`
- **On screen:** as frame 25, with the canvas content dimmed to 80% and the "Later" chip (ink capsule, white Inter Medium 13) centred.
- **Callouts:**
  - "Dim to 80% · 'Later' chip 0.6 s · organizer approves offscreen"

**27 · `Onboarding / B3 Challenges & Points / beat 6 points`**

- **Capture:** `challenge@7.60`
- **On screen:**
  - Pill "Approved" (#7B88FA, white).
  - A "+50" token (Figtree 20, ink on #FFCC3E) at the arc's apex.
  - Points pill "120 points" (white capsule, Figtree 16) **[placeholder until F2]**.
- **Callouts:**
  - "Yellow → purple 'Approved' · 0.30 s"
  - "'+50' arc · KeyframeTimeline · 0.55 s · scrubbable"
  - "Balance 120 → 170 numeric roll · 0.40 s"

**28 · `Onboarding / B3 Challenges & Points / reduce motion`**

- **Capture:** `challenge@final`, reduce motion
- **On screen:** "Approved", "170 points", and four still dots (fourth filled).
- **Callouts:**
  - "Reduce Motion: 4 stills · crossfade 0.30 s · no arc, stamp or typing"

**29 · `Onboarding / B3 Challenges & Points / accessibility XXXL`**

- **Capture:** `challenge@final` at AX XXXL
- **On screen:** no Stage. Title. Body. Rows: `list.number` "Each challenge lists what to do", `square.and.arrow.up` "Send progress, a caption and an optional photo", `checkmark.seal` "Your organizer approves, then points are added". Bar "And after the event?".
- **Callouts:**
  - "AX sizes: Stage → 3 static rows · scrolls"

**30 · `Onboarding / B4 Memories / beat 1 My Events`**

- **Capture:** `memories@1.00`
- **On screen:**
  - Stack [You, P, Y, W]; perch G. Stage #FFCC3E.
  - Canvas: the My Events upcoming list (Pasta Night row). Mini bar tabs with the marker on My Events and the callout "My Events" above it.
  - Title "KEEP THE MEMORIES" developing (blur about 3).
  - Body: "Your events live in My Events. Past events keep a shared photo album for everyone who went."
  - Bar "Make it yours".
- **Callouts:**
  - "Action → tabs · 0.30 s · marker → My Events · spring 0.38 / 0.82"
  - "Callout · scale 0.8 → 1 · spring 0.36 / 0.62 · holds 1.8 s"
  - "Title develops · blur 8 → 0 · 0.5 s easeOut"

**31 · `Onboarding / B4 Memories / beat 5 album upload`**

- **Capture:** `memories@6.50`
- **On screen:** canvas header "SATURDAY HIKE · OCT 18"; a 3 × 2 grid (album_Rectangle931–936); a new thumbnail just above the mini bar with a white ring at 60%; mini bar "Add Photos".
- **Callouts:**
  - "Grid develops · 40 ms stagger · blur 6 → 0"
  - "New photo grows from bar · ring 0 → 1 · 0.8 s linear · settles to slot 1 · spring 0.55 / 0.86"

**32 · `Onboarding / B4 Memories / reduce motion`**

- **Capture:** `memories@final`, reduce motion
- **On screen:** the album with the new photo in slot 1, and three still dots (third filled).
- **Callouts:**
  - "Reduce Motion: 3 stills · crossfade 0.30 s"

**33 · `Onboarding / B4→B5 Transition / stage shrink`**

- **Capture:** `transition.memories-interests@0.35`
- **On screen:**
  - The Stage's bottom edge at y ≈ 420, moving up, with fill midway from #FFCC3E to #ECECEC.
  - The album content cropped by that edge.
  - The title "WHAT ARE YOU INTO?" riding just under the edge, half revealed.
  - The first picker row emerging under it.
  - G mid-flight to the stack.
- **Callouts:**
  - "Stage bottom 563 → 330 · spring 0.55 / 0.86 · content clipped, not faded"
  - "Copy rides the edge · rows emerge 30 ms apart from 0.45 s"

**34 · `Onboarding / B5 Interests / picking`**

- **Capture:** `interests@rest`, 2 selected
- **On screen:**
  - Stack [You, P, Y, W, G].
  - Strip y 134–330 #ECECEC with chips "All events" (white, ink Inter 14), "Food & Drink" and "Arts" (#7B88FA, white). Cards: "FOOD & DRINK" with Y on #FFCC3E, "ARTS" with P on #FB72E4, both "Example".
  - Title at y 352. Body: "Pick a few. You can filter events by them anytime, and change them in Profile."
  - Embedded picker y 450–705: search row, "2 of 10 selected", rows (Inter 16) with purple `checkmark.circle.fill` / gray `circle`.
  - "Skip for now" at y 717. Bar "Save and start" (#7B88FA).
- **Callouts:**
  - "Chip grows from strip colour · gray → purple · scale 0.6 → 1 · spring 0.36 / 0.62 · haptic .selection"
  - "Bar ink → purple 'Save and start' · 0.30 s · when ≥ 1 selected"

**35 · `Onboarding / B5 Interests / catalog loading`**

- **Capture:** `interests@loading`
- **On screen:** strip with the "All events" chip only; six #ECECEC rows (44 pt) carrying the shimmer band; Bar "Start exploring".
- **Callouts:**
  - "Shimmer band offset · linear 1.4 s · while loading only"

**36 · `Onboarding / B5 Interests / catalog failed`**

- **Capture:** `interests@failed`
- **On screen:** strip with G calm in the centre (64 pt); message "Your interests couldn't load. You can add them in Profile anytime." (Inter 16); no picker; Bar "Start exploring".
- **Callouts:**
  - "Message fades in · 0.25 s · no retry here; Profile has it"

**37 · `Onboarding / B5 Interests / save failed`**

- **Capture:** `interests@saveFailed`
- **On screen:** as frame 34, plus a non-interactive error label at the top of the picker (`exclamationmark.circle`, "Couldn't save your interests. Your choices are kept.", footnote red). Bar "Try again" (ink). "Skip for now" stays.
- **Callouts:**
  - "Bar 'Saving…' → 'Try again' · 0.30 s · one retry control only"
  - "Selection kept · rows re-enabled"

**38 · `Onboarding / B5 Interests / reduce motion`**

- **Capture:** `interests@rest`, reduce motion
- **On screen:** as frame 34.
- **Callouts:**
  - "Reduce Motion: chips and cards 0.12 s opacity · Stage height change crossfades"

**39 · `Onboarding / H Handoff / window 50%`**

- **Capture:** `handoff@0.45`
- **On screen:**
  - A white `WindowSheet` with a hole about 382 × 690, radius 10, centred. The real Home shows through it: `DIPHomeHeader` (purple "Home" pill, bell and count, profile avatar), "Upcoming events" and `DIPPhotoEventCard`s, drawn as built at the time.
  - You at about 34 pt in flight toward x 337, y 65.
  - The Bar at about 50% action fill with tabs visible and the marker on Home.
- **Callouts:**
  - "Window → full screen · radius 20 → 0 · spring 0.60 / 0.88 · even-odd sheet"
  - "You → profile button (x W−65, y 65) · 28 → 40 pt · spring 0.55 / 0.86"
  - "Bar action dissolves → tabs · 0.30 s · haptic .success if saved"

**40 · `Onboarding / H Handoff / Home`**

- **Capture:** Home, 1.0 s after the handoff
- **On screen:** the real Home as built, with the Bar's tabs and Home selected. This is the end-state baseline.
- **Callouts:**
  - "Tour layer removed at 1.00 s · bars share centre H−61 · no pixel change"
  - "Reduce Motion: tour → Home crossfade 0.35 s"

**41 · `Onboarding / H Handoff / Home not ready`**

- **Capture:** `handoff@notReady`
- **On screen:** as the end of B5 with the copy gone; the Stage on its last frame; Bar "Getting your events…" with the progress band.
- **Callouts:**
  - "Waits up to 3.0 s for onFirstContent"
  - "Then reveal onto loading view · Bar fades out 0.25 s"

**42 · `Onboarding / H Handoff / events unavailable`**

- **Capture:** `handoff@unavailable`
- **On screen:** the real `ContentUnavailableView` "Events unavailable" (`calendar.badge.exclamationmark`, "Please sign out and try again."); no Bar.
- **Callouts:**
  - "Window reveal as normal · Bar fades out 0.25 s · focus to title"

**43 · `Onboarding / Replay / reveal into Profile`**

- **Capture:** `replay.end@0.45`
- **On screen:** the `WindowSheet` hole at about 50% expansion showing the Profile screen; You at about 60 pt flying to the large profile photo; "Done" faded out.
- **Callouts:**
  - "Same window reveal over Profile (presentationBackground clear)"
  - "Cover dismissed without animation at 1.00 s · record untouched"
