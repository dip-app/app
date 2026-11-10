# V2 frontend plan (iOS app and admin portal)

Drafted November 10, 2026 for the frontend area. V2 is due **December 4, 2026** (24 days). Scope comes from [V2](../V2.md) and the [V2 planning handoff](README.md); user-testing guidance comes from [project context](../../project-context.md). This is a work list, not a claim that anything below exists. Named owners for V2 features are still TBD in the milestone, so cross-area items say what they need from others.

## How to work through this list

1. **Mock first, adapter second.** The V2 commands in [callables](../../contracts/callables.md) (`sendInviteV1`, `respondToInviteV1`, `submitChallengeV1`, `recordAttendanceV1`, `approveChallengeV1`, `finalizeEventPhotoV1`) are design handoffs, not exported functions. For each item: domain repository protocol plus a mock plus the UI plus tests first (the pattern in [ADR 0005](../../adr/0005-observable-ui-repositories.md)), then the Firebase adapter when the backend and rules land. Do not present mock behavior as a deployed workflow.
2. **One branch, one session log, one PR per item.** Shared files (`project.yml`, tokens, rules, indexes, contracts, app composition) go through the integrator.
3. **Done means:** acceptance rows below pass, new logic has unit tests, a Simulator walkthrough is recorded in the session log, and the [FRONTEND_STATUS](../v1/FRONTEND_STATUS.md)-style row says what is live vs mock.
4. Size key: **S** about a day, **M** two to three days, **L** four to six days.

## Summary

| # | Item | V2 ID | Can start now? | Needs from others | Size |
| --- | --- | --- | --- | --- | --- |
| F0 | Carry-over cleanup and dead ends | V1-10 / V2-07 | Yes | none | S–M |
| F1 | Interest filtering on Home | V2-06 | Yes (client-side) | none | M |
| F2 | Points balance display | V2-04 | Yes (reads `pointsBalance`) | server awards (organizer/backend) for real values | S |
| F3 | Challenges and submissions | V2-02 | UI + mock yes | challenge reads rules, `submitChallengeV1`, Storage rules for evidence | L |
| F4 | Coworker invitations | V2-01 | UI + mock yes | `sendInviteV1`/`respondToInviteV1`, invite read rules, coworker list approach | L |
| F5 | Event photo albums (live) | V2-05 | UI + upload states yes | Storage rules, limits, `finalizeEventPhotoV1` | L |
| F6 | Accessibility and usability pass | V2-07 | Yes | none | M |
| F7 | Tests, coverage, device flows | V2-07 | Ongoing | all features | M |
| F8 | Release build and TestFlight | V2-07 | Needs Apple team decisions | paid Apple Developer team | S–M |
| O | Onboarding (proposal, not committed; see [spec](ONBOARDING_SPEC.md)) | none | Needs your decision | design review, F0–F4 components | M–L (P0–P4) |
| A | Admin portal V2 screens | V2-03 / V2-04 | UI + mock yes | `recordAttendanceV1`, `approveChallengeV1`, submissions reads | M–L |

Suggested order is at the end.

---

## F0 — Carry-over cleanup and dead ends (S–M)

Remove or resolve everything a TestFlight tester can tap that goes nowhere or confuses, and apply the usability findings that are still open. Do this first because later items add to the same screens.

- **Dead-end prototype alerts.** Today the bell opens "Notifications is not connected yet", the Rewards tab opens a "Rewards" notice, the Home challenge card opens "Challenge entries", and "Completed list" is a notice (`ui/DIP/Features/Prototype/DIPPrototypeApp.swift`). For each: hide the entry point until its screen exists, or replace it in F2/F3/F4. Notifications and Rewards are stretch (V2-S05, V2-S03): hide unless selected.
- **Findings still open from testing:** My Events icon was not understood (show its title, or change the icon: needs a design call); "Memories" alone was not an obvious route to past events (label it plainly, e.g. "Past events"); testers read the app as fitness-focused (broader coworker-socializing copy on Home, empty states and the welcome screen).
- **Tag fallback bug.** `DIPEventCover`'s tag fallback keys on `tag-fitness`-style ids, but live tag ids are opaque, so tag-only events always fall back to the outdoors image. Resolve through the loaded tag catalog by name, or drop the fallback (events with a catalog cover are unaffected).
- **Known failing UI test:** `testProfileEditsAndMemoryNavigation` (department text assertion). Fix or retire so the suite is green before adding more.
- **Acceptance:** no tappable element shows "not connected yet"; copy and label changes covered by the existing UI tests; suite green.

## F1 — Interest filtering (V2-06, frontend-led) (M)

> Filter upcoming events by interest tags. Make the filter state clear and preserve a way to browse all events.

- **UI:** a filter control on Home (chip row or a sheet with a count badge) listing the shared tag catalog by name; selected tags shown as removable chips; a persistent "All events" / "Clear" action; an explicit "No events match these interests" empty state with a one-tap "Show all events".
- **Logic:** client-side filter over loaded events by `tagIds` (any-match), applied in a pure function in `DIPCore` so it is unit-testable; keep working with pagination (filtering never hides "Load more"; show how many matched). Optionally preselect from the member's profile interests only if clearly shown as active (default is **no filter**, so "browse all" is never lost).
- **Data:** tag names come from the existing catalog (`InterestCatalog`, `tags/{tagId}`); no backend change. If client-side filtering over loaded pages proves too coarse, a server query (`array-contains-any`, max 10 tags) needs a rules/index change: decide later.
- **Acceptance:** filter state always visible; clearing restores the full list; empty state offers a way out; state survives pull-to-refresh and navigating into and out of an event; VoiceOver announces the active filter.
- **Tests:** filter function (empty, single, multi, unknown tag id, no matches), view-model state, UI test for filter → open event → back.

## F2 — Points balance (V2-04 display) (S)

- **UI:** show the signed-in member's balance (Home header pill and/or Profile). `AppUser.pointsBalance` is already read from the profile document, so this ships without a new contract. Zero state reads as "0 points", not hidden.
- **Rules:** display only. The client never writes points; once the server awards points (V2-03/04), the observed profile updates the number. Animate changes gently, respect Reduce Motion.
- **Acceptance:** balance matches the profile document and updates when it changes; no client write path exists.
- **Tests:** formatting (0, 1, 1,234), view-model observing profile updates.
- **Decision needed:** placement (see Decisions).

## F3 — Challenges and submissions (V2-02) (L)

> Show challenge requirements and allow progress, caption, and optional photo evidence. Explain the completion requirement, submission method, and reward before submission.

- **Reads:** replace the Home "This Week's Challenge" card's mock with the live current challenge for the member's company; challenge detail screen (the mock `DIPChallengeDetailsScreen` already exists, Figma 160:6357 for the page and 46:1017 for the card). Needs challenge read rules from the backend owner.
- **Explain before submit** (the testing finding): requirement, how to submit, deadline/window and reward points shown **above** the submit action, in plain language.
- **Submission form:** progress value with the challenge's goal unit, caption, optional photo (system photo picker, size/type limits shown), review-before-send summary. Disable duplicate taps while submitting; retain the draft on failure; a retry reuses the same submission identity (`{challengeId}_{uid}` per the contract) so it cannot double-submit.
- **States:** not started, draft, submitted (pending approval), approved (points awarded), rejected/needs changes, closed/expired, offline, upload failed. Approved state links to F2.
- **Photo evidence upload:** shares the upload pipeline with F5 (picker, compression, progress, retry). Build the pipeline once.
- **Acceptance:** all states render from fixtures; submit is idempotent under retries; nothing awards points client-side.
- **Tests:** submission state machine, validation (empty, over-goal, long caption), retry/idempotency with the mock, UI test for the full submit path.
- **Blocked on for live:** challenge read rules, `submitChallengeV1` exported and deployed, Storage rules for evidence.

## F4 — Coworker invitations (V2-01) (L)

> Invite a coworker within the same company; the recipient can view, accept, or decline. Acceptance joins the event under the same RSVP/capacity rules.

- **Sender:** an "Invite a coworker" action on the event page (next to Directions/Share, or from the participants view) opening a coworker picker with search and an optional short message; clear sent / already invited / failed states. Do not call this Share: the iOS share sheet stays separate (V1-09).
- **Recipient:** needs a surface to find invitations. Minimum: an "Invitations" entry on Home (badge with count) opening a list; each row shows event, who invited, message, date/place; **Accept** and **Decline**. Accept goes through the same capacity transaction: show full/closed/already-joined outcomes with actionable text, and move into the joined state on success. (This is separate from the stretch notifications bell, V2-S05.)
- **Privacy:** same-company only; the picker must not reveal anyone outside the company or expose private profile fields beyond name/avatar/department. How the app gets the coworker list is an open backend decision (see Decisions).
- **Acceptance:** invite sent once under retries; recipient sees only their own invitations; accept respects capacity and shows the result; declined invitations disappear from the pending list.
- **Tests:** invitation state machine (pending/accepted/declined/expired/event-full), picker filtering, UI test for send → recipient accepts (mock two-user flow).
- **Blocked on for live:** `sendInviteV1`/`respondToInviteV1`, invite read rules (recipient only), the coworker list approach.

## F5 — Event photo albums, live (V2-05) (L)

The album screens and photo picker exist against mock data (`ui/DIP/Features/Album`). Make them real.

- **View:** album grid for a **past** company event from photo metadata + Storage download URLs; loading, empty ("No photos yet"), error, and access-denied states; efficient image loading and caching.
- **Upload:** pick up to a stated number of photos; validate type and size on device before upload (limits to be set by the team); per-photo progress, cancel, retry; metadata finalization via `finalizeEventPhotoV1`; partial failure shows which photos failed without losing the rest. Only offer upload where the backend allows it (participants of that event).
- **Routing:** make the way from My Events to past events and their albums obvious (testing finding).
- **Acceptance:** cross-company access is impossible from the UI's point of view (no leaked URLs); a failed upload never shows as uploaded; photos appear after finalization.
- **Tests:** upload state machine (all succeed, one fails, cancel, retry), size/type validation, metadata mapping; UI test for pick → upload → appears (mock).
- **Blocked on for live:** Storage rules, agreed limits/formats/retention, `finalizeEventPhotoV1`.

## F6 — Accessibility and usability pass (V2-07) (M)

Do this per screen as each item lands, and again as a sweep in the last week.

- Dynamic Type through the largest sizes on Home, event, challenge, invitation and album screens; no clipped or overlapping text.
- VoiceOver: labels, values and order for cards, the joined/leave states, filter chips, upload progress and challenge states; announce results of actions.
- Touch targets at least 44×44 pt; contrast fixes for the low-contrast accents already flagged in the [design guide](../../design/README.md); Reduce Motion alternatives for every new animation.
- Retest the challenge instructions with someone who has not seen them (V2 handoff checklist).
- **Acceptance:** a short checklist per screen recorded in the session log; no regressions in the existing UI tests.

## F7 — Tests, coverage and device flows (V2-07) (M, ongoing)

- **Coverage target:** more than 90% unit coverage for implemented V2 logic, with the measured scope written down (view models, domain rules, projections, mappers; not generated DTOs, previews or empty scaffolds). Keep frontend logic in `DIPCore` / `DIPPresentation` and view models so it is measurable by `swift test`.
- **Each item above lists its unit tests.** Add them as you go instead of at the end.
- **Flow tests:** UI tests per feature on the Simulator; a physical-device pass per feature (the share sheet, photo picker and upload need a real device).
- **Evidence:** record exact commands and results in each session log; keep pending tests out of the coverage claim.

## F8 — Release build and TestFlight (S–M)

Depends on the new paid Apple Developer account and a few decisions.

- Bundle ID under the paid team (`org.dip-app.DIP` is registered to another team), then update the Firebase iOS app, Google sign-in client and App Check registration if it changes.
- App Attest entitlement in `project.yml` and App Attest registered with the Team ID in the Firebase console; version/build bump.
- Invite teammates in App Store Connect (Users and Access); first internal TestFlight build, then optionally Xcode Cloud for builds on merge.
- **Acceptance:** a TestFlight build installs for an invited teammate, signs in, and reaches live events.

## O — Onboarding (not in the committed V2 scope)

The design for this item is in [ONBOARDING_SPEC.md](ONBOARDING_SPEC.md): one Welcome screen before sign-in, a short tour after membership resolves (Discover & Join, People & Invites, Challenges, Memories, Interests) and a handoff into Home. It still needs team approval because V2 does not list onboarding as committed or stretch scope, and it needs no contract, rules or backend change. The spec replaces **O1** (welcome tour) and folds **O2** (pick your interests) into its B5 step. **O3** (a one-line permission explainer before the first photo-picker use) stays with F3/F5 and is shown just in time. Delivery is phased (spec §5): P0 is the pure DIPCore flow, record store and demo timeline; later phases switch on as their features land.

## A — Admin portal V2 screens (web, `apps/admin`)

The organizer portal is also frontend work. V2-03 and V2-04 organizer actions need screens there.

- **A1 Attendance confirmation (V2-03):** per event, list members with a going RSVP and let an organizer confirm each (`recordAttendanceV1`); show confirmed vs unconfirmed, handle replays and conflicts gracefully; confirmed attendance is what awards points once.
- **A2 Challenge submission review (V2-03):** queue of pending submissions with progress, caption and evidence photo; Approve (and, if the policy allows, Reject/reverse) via `approveChallengeV1`; shows result and the points awarded.
- **A3 Points visibility (V2-04):** show points awarded per event/challenge so organizers can verify one award per completion (read-only).
- **A4 Challenge create/edit:** the milestone does not say who creates challenges; decide whether the portal needs a form (like the event form) or whether challenges stay seeded.
- Same pattern as V1: mock adapter first, Firebase adapter plus an emulator test (`npm run test:admin:live` style) when the callables exist. Existing sign-in and organizer role gating are reused.

## Stretch goals (not selected, do not start)

V2-S01 activity chat (mock-backed UI exists, no backend), V2-S02 raffle, V2-S03 rewards redemption (Rewards frame exists in Figma, tab is a dead end today), V2-S04 photo comments/favorites (mock-backed UI exists, placement redesign pending), V2-S05 notifications (the bell is a dead end today), V2-S06 venue/weather (Places provider unconfirmed). Each needs its own issue before work starts, per the [V2 handoff](README.md).

## Decisions needed

1. **Points placement:** Home header pill, Profile, or both?
2. **Filter control:** chip row on Home, or a sheet behind a filter button? Preselect profile interests, or default to all?
3. **Where invitations live:** Home "Invitations" entry (recommended) vs waiting for the notifications stretch.
4. **Coworker list for invitations:** how the app gets same-company coworkers without leaking cross-company data (a callable vs a narrowly scoped read rule): backend call.
5. **Photo limits:** types, max size, max count per upload, who may upload (participants only?), retention: needed before F5 ships.
6. **Challenge creation:** portal form or seeded data (A4).
7. **Onboarding:** approve O1, O2, O3 or only some.
8. **Design:** no Figma exists for the filter, invitations, points, onboarding or the admin V2 screens. Compose from the design system, or request frames?
9. **Owners:** V2 owners are still TBD in the milestone; assign them before cross-area items start.

## Suggested order (Nov 10 – Dec 4)

| Window | Frontend work | In parallel (others) |
| --- | --- | --- |
| Nov 10–16 | F0 cleanup; F1 filtering (+ O2 if approved); F2 points display; settle decisions 1–9; start F8 account/bundle decisions | Backend/organizer: finalize schemas and fixtures for the V2 commands |
| Nov 17–23 | F3 challenges UI against mock; F4 invitations UI against mock; A1/A2 against mock | Backend: `submitChallengeV1`, `sendInviteV1`/`respondToInviteV1` with tests; rules |
| Nov 24–30 (Thanksgiving week, expect reduced capacity) | Wire F3/F4 adapters as backends land; F5 upload pipeline (also used by F3) | Storage rules, `finalizeEventPhotoV1`, `recordAttendanceV1`/`approveChallengeV1` |
| Dec 1–4 | F5 live; A1/A2 live; F6 sweep; F7 coverage numbers and device flows; F8 TestFlight build | Integration owner: full-flow verification, fixes |

If the backend lags, the mock-first approach means the UI and tests for F1–F5 are still done and reviewable; the adapter swap is the only remaining work. Items to drop first if time runs out: O1/O3, A4, then the polish part of F5 (upload cancel/partial-retry UX), never F1/F2/F3/F4's core acceptance rows.
