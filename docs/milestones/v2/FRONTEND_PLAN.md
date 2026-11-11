# V2 frontend plan (iOS app and admin portal)

Drafted and last updated November 10, 2026 for the frontend area. V2 is due **December 4, 2026** (24 days). Scope comes from [V2](../V2.md) and the [V2 planning handoff](README.md); user-testing guidance comes from [project context](../../project-context.md). This is a work list, not a claim that anything below exists. Named owners for V2 features are still TBD in the milestone, so cross-area items say what they need from others.

## Status board

Updated November 10, 2026 (evening). "Merged" means merged to `main`. Deployed means deployed to the `team05-dip` Firebase project. Open and draft PRs below are unmerged and need review; a draft is not a claim that the feature works.

| Item | What | Status | PR / branch | Owner area |
| --- | --- | --- | --- | --- |
| Rewards icon | Rewards tab icon is a gift | Done, merged | PR #48 | iOS |
| Rewards page (V2-S03 stretch) | Rewards tab opens the Figma Rewards frame (raffle entry with built-in progress meter, Discounted Experiences with corner tags) with the ticket shape swapped for solid gift-box cards with a small bow. Mock-backed: local entries, no redemption, contract or backend | In PR | feature/rewards-gifts | iOS |
| Event Join | One clear Join action; Directions/Leave row; chat icon on the joined bar | Done, merged | PR #47 | iOS |
| V1-08 imagery | Event and catalog imagery | Done, merged | PR #44 | iOS |
| Frontend plan | This plan | Done, merged | PR #50 | Plan steward |
| Device build | App builds and runs on a phone with a personal bundle ID | Works (local only; paid-team bundle ID is F8) | none | iOS |
| Share link rich previews | Server-rendered Open Graph / Twitter preview page for `/e/<id>` (`eventSharePageV1`, `eventShares` index, per-category 1200x630 images, backfill script). Title, short description, coarse date and image only | In PR `feature/share-link-previews`; deploy approved by the owner, see docs/design/share-links.md | this PR | Backend |
| Weekly theme T1 | Contract (additive), `createChallengeV1`/`updateChallengeV1`, same-company read rules, seed script | Done, merged. Rules and both callables deployed to `team05-dip` | PR #53 | Backend |
| Weekly theme production | Seeded: Fitness theme documents `weekly-fitness-20261109` and `weekly-fitness-20261116` for Arianne AI (`pNVpp3OusRvgfUV8hv5R`) and Globex (`zFKQd6KU14LqKr4a7yTb`) | Done in production | none | Orchestrator |
| Weekly theme T2 | iOS Home card live and read-only detail | Draft. Its dependency (#53 deployed) is now met; needs simulator verification | PR #57 | iOS |
| Weekly theme T3 | Admin portal "Weekly themes" list/create/edit | Open. Mock mode verified; live emulator test was skipped until #53, which is now merged | PR #52 | Admin portal |
| Profile redesign | Periwinkle header holding avatar, name, About details and interests; flat brand shapes; memory grid opening the album; `DIPEmptyState` for no memories | In review on `feature/profile-redesign` (see PR) | feature/profile-redesign | iOS |
| App-assigned avatar | `DIPAvatarStyle.assigned(forUserID:)` and `DIPAssignedAvatar`, via `MediaReference.generatedAvatar`: Profile badge, the signed-in member's own photo fallback and header avatar, and live attendee stacks (Home cards, event page, participants). Bundled mock fixtures and the chat (not live yet) still use bundled faces | Done, merged | PR #69, #79, haptics PR | iOS / Design system |
| Haptics call sites | `DIPHaptics` wired: Profile save (commit, then success or failure), Sign out (commit), Album upload (success/failure), RSVP stored/failed (success/failure); interest picker, onboarding and My Events toggle already had it. Not wired: Rewards redeem (no real action yet, still a notice), chat send and optimistic join (Events agent) | Done, merged | haptics PR | iOS |
| F1 interest filter (Stream D) | Home "Matching your interests / All events" toggle over loaded events (any-match on tag ids, order kept), outlined count pill, read-only interest chips, shared empty state; default All events, scope saved per member on the device; control only for account-backed members with catalog-known interests | Built on `feature/v2-remaining`, quality rounds in the PR; filters loaded pages only | feature/v2-stream-d | iOS |
| F2 points balance (Stream D) | Rewards "Your points" row with the real `pointsBalance` (520 mock for fixture profiles); formatting in DIPCore; display only, no client write path | Built on `feature/v2-remaining`, quality rounds in the PR; Rewards entries stay mock | feature/v2-stream-d | iOS |
| Home filter polish + My Events pages (Stream D follow-up) | Home interest toggle is the My Events `DIPSegmentedToggle` (the `.soft` style is gone); filter switch animates (sliding thumb, 0.25 s cards drift/fade, container height animates, plain cross-fade with Reduce Motion); skeleton / failure / offline variants for the filtered list and the Rewards points pill; two matching cards in equal columns; zero-points nudge; VoiceOver announces the active filter. My Events: Active Events and Memories are two real horizontal pages (each with its own 20pt padding) under the pinned toggle, kept in sync both ways. Loading/failed/offline for Home are mapped from the existing load state; the points pill loading/unavailable variants are reachable by preview flags only | Built on `feat/home-filter-polish`, quality rounds in the PR | PR to `feature/v2-remaining` | iOS |
| Empty states T4 | Reusable `DIPEmptyState` and its uses | Draft; simulator tests pending | PR #51 | iOS |
| Chat/push/settings/history/reminders backend (C1) | Chat rules, push functions, subscription preferences, change log trigger, reminders | Open, nothing deployed. Needs APNs key and paid team for real pushes. Open questions: level semantics, chat closing 24 h after the event end, organizer chat access, trigger region check | PR #54 | Backend |
| Onboarding P0 + spec | Core logic and ONBOARDING_SPEC v4 | Merged | PR #49 | iOS / Design |
| Onboarding P1 | Sign-in stage | Merged | PR #55 | iOS |
| Onboarding P3 | DemoStage and scene B1 | Merged | PR #56 | iOS |
| Onboarding P4 | Embedded interest picker | Merged; build fixed by PR #60 | PR #58 | iOS |
| Onboarding P2, B2-B5 | Tour shell after member resolution (per-uid record, skip, resume, Profile replay, window handoff); scenes B2-B4 (placeholders for F2-F4 UI), B5 with the embedded picker | Built; unit and UI tests in the PR. Shipping flags drop B3 and B2's invite beats until F3/F4 land | `feature/onboarding-p2-tour` | iOS |
| C2 iOS slice | Activity chat live adapter (V2-S01, selected; record it in its own issue) and bell menu (items A, C) | Live adapter and bell menu built on `feature/live-activity-chat`; not tested against Firebase or on a device | `feature/live-activity-chat` | iOS |
| C3 iOS slice | Push registration, permission priming, settings UI, history UI, add to calendar (items B, C, D, E) | Not started | to be created | iOS |
| Add to calendar (E) | The outlined top-right header pill of the event page is the button: calendar icon + short date ("Monday, 11/23"; `--calendar-label=generic` shows "Add to Calendar"); system event editor (no permission needed); hidden for past/cancelled. Also: When/Where/Price labels removed, Directions fallback (title search) and a Directions pill on the Where row once joined | Done, merged (see PR) | `feature/add-to-calendar` | iOS |
| Event share text | Share sheet text rewritten as two natural-language paragraphs with fallbacks (pure tested function in DIPCore) | In review, same PR | `feature/add-to-calendar` | iOS |
| Event share link | Share Event shares text plus `https://team05-dip.web.app/e/<eventId>` (opaque id only); `DIPShareLink` build/parse in DIPCore with unit tests | In review | `feature/share-links` | iOS |
| Universal Links + landing | App root routes share links and `dip://events/<id>` to the event page after sign-in/onboarding; Associated Domains in a paid-team-only entitlements file; hosting AASA + `/e/**` landing page (App Store ID and Team ID are placeholders). Not deployed; see [share links](../../design/share-links.md) | In review; needs paid team, App Store ID, owner-approved hosting deploy | `feature/share-links` | iOS / Hosting |
| Event tag wrapping | Interest tags wrap onto several lines instead of truncating (hero overlay) | In review, same PR; verified in a many-tags fixture screenshot | `feature/add-to-calendar` | iOS |
| Event info rows actions | When row adds to calendar (same action and gate as the header pill; spent after adding) and Where row opens the same Directions link; Price, Points and past events stay informational; 44pt rows with chevron | Built on `feature/event-info-rows-actions`; 8 AddToCalendar UI tests and DIP build pass | PR to `feature/v2-remaining` | iOS |
| Event points reward display | Points row in the event info card (star in the accent colour; "Earn +50 points" before, "Earned 50 points" once attended, "Worth 50 points" for a past event you skipped) and the Home card chip | Built and merged (stream A PRs 2-3); Earned state on `feature/v2-hardening` | PR #102 and hardening PR | iOS |
| Push notifications (B) | FCM/APNs end to end | Not started; device test needs the paid Apple Developer team | see C1/C3 | Backend / iOS |
| Shake to report | Shake (and Profile "Report a problem") opens a report sheet: screenshot captured first, category, text, optional app details, offline queue; Firestore `bugReports` + Storage `bugReports/{uid}/…` create-only rules; Debug and TestFlight builds. Hardening branch `feature/v2-hardening` adds the screenshot markup editor (draw, undo, clear, burned into the JPEG under 400 KB), the "Report a problem?" question after a shake (Profile toggle turns it off), and VoiceOver direct-open (custom action and magic tap). Server-side rate limiting is not built: rules cannot count, so it needs a callable or a per-uid limits document written in the same batch (decision pending); the client outbox already caps 5 queued reports per uid | In review on `feature/v2-stream-c`; rules not deployed | `feature/v2-stream-c` | iOS / Rules |
| TestFlight | Release build | Not started; needs the paid team (F8) | none | All |
| F0-F5 | Cleanup, interest filter, points, challenges submissions, invitations, live albums | F0 cleanup and F1 interest filter (Home filter polish, PR #120) built; F2 points built (PRs #102, #103); F3 challenge theme page read-only built, submissions with another owner; F4 invitations with another owner; F5 live albums built (PRs #96, #127, not deployed). Event `completed` status now visible to members and accepted for uploads (`feature/v2-hardening`) | see rows above | iOS |
| F5 (Stream B) | Live event albums: storage rules, `finalizeEventPhotoV1`, comments, iOS upload/grid/viewer | Backend merged to `feature/v2-remaining` (#96, not deployed); iOS in review. Device upload not yet verified | #96 + iOS PR | Backend / iOS |
| F3 challenge submissions backend (V2-02) | `submitChallengeV1`, `approveChallengeV1` (atomic ledger award), `rejectChallengeV1`, `listChallengeSubmissionsV1` (organizer queue), Firestore + Storage rules, additive contract; see [challenge-submissions](../../contracts/challenge-submissions.md) | Built, unit/rules/emulator tests written, nothing deployed; checks run at integration | PR #128 | Backend |
| F3 challenge submissions iOS (V2-02) | Weekly-theme page "Your entry" section (not started, pending, approved with points, needs changes, closed, offline/loading/error), entry sheet (progress, note, optional photo with progress and retry, review summary), Firebase + in-memory sources, Preview review states. No Figma frame exists for the entry flow: composed from the event-page card, the bug-report sheet and shared patterns; needs design review | Built on `feature/challenge-submissions`; Preview UI tests, DIP build and the new DIPTests passed on the simulator; full suites at integration | feature/challenge-submissions | iOS |
| Album upload tile fix + follow-ups | A finished upload tile no longer lingers (success state about 1 s, then the real photo; leaves when the album lists it, at the latest 3 s later). Removing a failed upload whose bytes never landed frees its slot at once. Album load error wording shared with upload/comment failures and shown also while drafts are listed. Captions stay empty (no design for a caption field) | In review on `fix/album-finished-tile` | `fix/album-finished-tile` | iOS |
| F4 coworker invitations (V2-01) | Backend: `sendInviteV1`, `respondToInviteV1`, minimal directory `listCoworkersV1`, invite and notification rules, in-app notice + push through the existing pipeline; iOS: Invite a coworker on the event page, picker with search, Invitations inbox (received accept/decline, sent status), mock + Firebase adapter | Backend merged-ready in PR #129 (tests written, not run; not deployed). iOS built against the mock and a Firebase adapter: the pink "Invite a Coworker" pill on the event page (hidden for past, cancelled and started events; disabled with a reason when full), a picker sheet (debounced name search over `listCoworkersV1`, two-letter minimum, optional note, Invite / Invited / Going), and the Invitations sheet behind the bell (Received accept/decline with full/closed errors, Going, Sent statuses; loading, empty, error and offline states). Pure logic and models are in DIPCore/DIPPresentation with `swift test`; Preview UI tests in `InvitesTests`. Not run on a device or against Firebase | `feature/v2-coworker-invites` | Backend / iOS |
| A1-A3 | Admin attendance, review, points | Not started (A4 is covered by weekly themes) | to be created | Admin portal |
| F6 | Accessibility pass | First pass on `feature/v2-hardening`: spoken labels and hints for Home and My Events cards (date and place read as a phrase, reward included), join/leave announcements and a hint on Leave Activity, VoiceOver report action; Profile and Album keep their earlier labels; VoiceOver and Dynamic Type sweeps on a device are still to do | `feature/v2-hardening` | iOS |
| F7 | Repair older UI tests | Three stale expectations corrected by code reading (mock-member venue address, Home card id after the v1 fixtures, `home.event.event_Image`); not re-run yet, the owner runs them at integration. HomeThemeTests error retry test was reviewed and left unchanged | `feature/v2-hardening` | iOS |
| F8 | Release | Not started; needs the paid team | none | All |
| Hardening: completed status | Events with status `completed` appear in My Events and Memories for members who joined, accept album uploads (rules, `finalizeEventPhotoV1`), and are never joinable or cancellable; only `cancelled` is refused | Built with unit and rules tests; rules and function not deployed | `feature/v2-hardening` | Backend / iOS |
| Hardening: event covers | Memories and Home cards use the event first album photo (one limit-1 query and one download per past joined event, at most six per session) with the catalog cover as fallback | Built with unit tests | `feature/v2-hardening` | iOS |

**Design status.** Onboarding spec v4 passed audit (9.18). The Figma draft file "DIP - Onboarding motion reference" (key `nAcWMM3OBnEtrGQj5vCEtk`) has the complete v4 frame set (24 primary frames plus variants) and a "Shake to report" page of 10 frames. The owner will copy these into the main design file by hand.

**Infra lessons.** Simulator work must be serialized with the `/tmp/dip-sim-lock` mkdir lock so agents do not drive the same simulator at once. A full disk and Mac sleep interrupted agents (P4 was never built because the disk filled); check free disk before starting build-heavy work and keep the Mac awake during long runs.

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
| F3 | Challenges and submissions (Home card is now T2; submissions stay V2) | V2-02 | UI + mock yes | challenge reads rules, `submitChallengeV1`, Storage rules for evidence | L |
| F4 | Coworker invitations | V2-01 | UI + mock yes | `sendInviteV1`/`respondToInviteV1`, invite read rules, coworker list approach | L |
| F5 | Event photo albums (live) | V2-05 | UI + upload states yes | Storage rules, limits, `finalizeEventPhotoV1` | L |
| F6 | Accessibility and usability pass | V2-07 | Yes | none | M |
| F7 | Tests, coverage, device flows | V2-07 | Ongoing | all features | M |
| F8 | Release build and TestFlight | V2-07 | Needs Apple team decisions | paid Apple Developer team | S–M |
| O | Onboarding (proposal, not committed; spec: docs/milestones/v2/ONBOARDING_SPEC.md, PR #49, pending team approval) | none | Needs your decision; P0-P4 builds in progress | design review, F0–F4 components | M–L (P0–P4) |
| A | Admin portal V2 screens | V2-03 / V2-04 | UI + mock yes | `recordAttendanceV1`, `approveChallengeV1`, submissions reads | M–L |
| T1-T4 | Weekly theme (backend, iOS, admin) and designed empty states | none (supports Home design) | In progress | callables `createChallengeV1`/`updateChallengeV1` (T1) | M each |
| N1 | Activity chat live (item A) | V2-S01 (selected) | Backend rules first | own issue; rules for `events/{eventId}/messages` | M |
| N2 | Push notifications (item B) | V2-S05 (selected by owner request; record in an issue) | Functions and unit tests yes; no device test | paid Apple Developer team, APNs key | L |
| N3 | Notification settings (item C) | with N2 | UI yes | subscription store and validation (C1) | S–M |
| N4 | Event change history (item D) | none | Backend trigger yes | none | M |
| N5 | Add to calendar (item E) | none | Yes | none | S |
| B | Backlog (shake to report, stretch, TestFlight, Figma updates) | none | Not started | see Backlog | varies |

Suggested order is at the end.

---

## F0 — Carry-over cleanup and dead ends (S–M)

Remove or resolve everything a TestFlight tester can tap that goes nowhere or confuses, and apply the usability findings that are still open. Do this first because later items add to the same screens.

- **Remove or hide dead ends.** The notifications bell and the Rewards tab stay hidden or unconnected until their stretch features (V2-S05, V2-S03) are selected. The Rewards tab icon is already a gift (PR #48, merged).
- **Dead-end prototype alerts.** Today the bell opens "Notifications is not connected yet", the Rewards tab opened a "Rewards" notice (now a mock-backed Rewards page, see the status board), the Home challenge card opens "Challenge entries", and "Completed list" is a notice (`ui/DIP/Features/Prototype/DIPPrototypeApp.swift`). For each: hide the entry point until its screen exists, or replace it in F2/F3/F4. Notifications and Rewards are stretch (V2-S05, V2-S03): hide unless selected.
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

- **Reads:** the Home "This Week's Challenge" card going live with a read-only detail is now workstream T2 (see Weekly theme). What remains here is submissions. The challenge detail screen (the mock `DIPChallengeDetailsScreen` already exists, Figma 160:6357 for the page and 46:1017 for the card). Challenge read rules come with T1.
- **Explain before submit** (the testing finding): requirement, how to submit, deadline/window and reward points shown **above** the submit action, in plain language.
- **Submission form:** progress value with the challenge's goal unit, caption, optional photo (system photo picker, size/type limits shown), review-before-send summary. Disable duplicate taps while submitting; retain the draft on failure; a retry reuses the same submission identity (`{challengeId}_{uid}` per the contract) so it cannot double-submit.
- **States:** not started, draft, submitted (pending approval), approved (points awarded), rejected/needs changes, closed/expired, offline, upload failed. Approved state links to F2.
- **Photo evidence upload:** shares the upload pipeline with F5 (picker, compression, progress, retry). Build the pipeline once.
- **Acceptance:** all states render from fixtures; submit is idempotent under retries; nothing awards points client-side.
- **Tests:** submission state machine, validation (empty, over-goal, long caption), retry/idempotency with the mock, UI test for the full submit path.
- **Blocked on for live:** challenge read rules, `submitChallengeV1` exported and deployed, Storage rules for evidence.

## Weekly theme workstream (Home "This Week's Challenge" card)

A weekly theme is a Challenge document whose `coverImageURL` is `catalog://theme/<key>`. This supersedes the earlier A4 question: decided = portal form plus callables. Streams:

- **T1 Backend** (`feature/weekly-theme-backend`): contract change, seed script, Firestore rules and indexes, callables `createChallengeV1` and `updateChallengeV1`, emulator tests (auth denial, tenant isolation, window overlap, idempotency).
- **T2 iOS** (`feature/weekly-theme-ios`): Home card reads the live current theme; read-only detail screen; empty state when there is no theme this week. Submissions stay in F3.
- **T3 Admin portal** (`feature/weekly-theme-admin`): "Weekly themes" list, create and edit forms using the callables.
- **Production step** (done by the orchestrator, not by a feature branch): deploy rules, indexes and functions after review, then run the seed script for Arianne AI (`pNVpp3OusRvgfUV8hv5R`) and Globex (`zFKQd6KU14LqKr4a7yTb`).

### Weekly theme data model

The shared spec lives in the agents' scratchpad; this is its summary. If the shipped contract differs, the contract files win.

- **Document:** the existing Challenge document; no new collection. Existing Challenge fields are reused.
- **Catalog URL:** `coverImageURL = catalog://theme/<key>`. The key selects a bundled, designed illustration in the app (never a photo). First theme: `fitness`.
- **Window rules:** a theme runs Monday to Monday in Eastern Time, at most 14 days, and windows for one company must not overlap. The callables enforce this.
- **Server-owned fields:** counts (such as participant or submission counts) are written only by the server.
- **Optional additive fields:** `createdBy`, `createdAt`, `updatedAt`, `revision` (used for concurrent-edit checks).
- **Rules:** same-company members may read; clients have no writes. All writes go through `createChallengeV1`/`updateChallengeV1`.
- **Home query:** the current theme for the member's company whose window contains now.

## Designed empty states workstream (T4)

Branch `feature/empty-states-ios`. A reusable `DIPEmptyState` component, then use it in: Home attended-recents, upcoming events, event-page Who's Attending, Participants, My Events sections, and Album. Copy needs a review (see Decisions). The Album live states (F5) reuse it.

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

The design for this item is in [ONBOARDING_SPEC.md](ONBOARDING_SPEC.md) (PR #49, pending team approval): one Welcome screen before sign-in, a short tour after membership resolves (Discover & Join, People & Invites, Challenges, Memories, Interests) and a handoff into Home. It needs team approval because V2 does not list onboarding as committed or stretch scope, and it needs no contract, rules or backend change. The spec replaces **O1** (welcome tour) and folds **O2** (pick your interests) into its B5 step. **O3** (a one-line permission explainer before the first photo-picker use) stays with F3/F5 and is shown just in time.

**Design status.** Spec v4 passed audit (9.18; earlier rounds 7.5 and 8.7). The Figma draft file is "DIP - Onboarding motion reference" (key `nAcWMM3OBnEtrGQj5vCEtk`) with the complete v4 frame set (24 primary frames plus variants). The owner will copy the frames into the main design file by hand.

**Build phases** (names follow the spec, section 5; P0 is the pure DIPCore flow, later phases switch on as their features land):

| Phase | What | Status | PR / branch |
| --- | --- | --- | --- |
| P0 | Core logic: flow, record store, demo timeline | Open PR, not merged (waiting for team approval) | #49 |
| P1 | Sign-in stage | Draft; UI test run unfinished | #55 |
| P2 | Tour shell | Built (see status board) | `feature/onboarding-p2-tour` |
| P3 | Demo stage and scene B1 | Draft, stacked on #49 | #56 |
| P4 | Embedded interests (B5 step) | Draft; not built or tested | #58 |
| B2-B5 | Remaining demo scenes | Built; B3 hidden until F3 (`OnboardingFeatures.shipping`) | `feature/onboarding-p2-tour` |

## A — Admin portal V2 screens (web, `apps/admin`)

The organizer portal is also frontend work. V2-03 and V2-04 organizer actions need screens there.

- **A1 Attendance confirmation (V2-03):** per event, list members with a going RSVP and let an organizer confirm each (`recordAttendanceV1`); show confirmed vs unconfirmed, handle replays and conflicts gracefully; confirmed attendance is what awards points once.
- **A2 Challenge submission review (V2-03):** queue of pending submissions with progress, caption and evidence photo; Approve (and, if the policy allows, Reject/reverse) via `approveChallengeV1`; shows result and the points awarded.
- **A3 Points visibility (V2-04):** show points awarded per event/challenge so organizers can verify one award per completion (read-only).
- **A4 Challenge create/edit:** decided: the portal has a form backed by `createChallengeV1`/`updateChallengeV1`. The first version is the weekly themes list (T3 above); full challenge editing beyond themes is later.
- Same pattern as V1: mock adapter first, Firebase adapter plus an emulator test (`npm run test:admin:live` style) when the callables exist. Existing sign-in and organizer role gating are reused.

## Owner-approved additions: chat, push, settings, history, calendar

These five items were approved by the owner on November 10, 2026. They are stretch scope under [the V2 handoff](README.md): V2-S01 (chat) and V2-S05 (notifications) must each be recorded as selected in their own issue before work starts, with a separate packet and disjoint paths. Backend slice C1 starts first; iOS slices C2 and C3 follow (see the Status board). Nothing here exists yet.

### A. Activity chat, live (V2-S01, selected)

Decided: build live chat now (the earlier "hide the entry" option is dropped). Today the chat UI is mock-backed; in the live app the joined bar says "Activity Chat" and opens an empty chat whose send fails ("Chat isn't available yet"). The contract proposal is in [data ownership](../../contracts/data-ownership.md).

- **Rules** for `events/{eventId}/messages`: readable and appendable only by members who joined the event; own-author create only; length limit; server timestamp; no edits or deletes by clients; counters server-only. Emulator tests: auth denial, tenant isolation, non-participant denial, field ownership.
- **iOS:** real-time read and send in the adapter, replacing "Chat isn't available yet"; empty, failed and offline states; the joined bar keeps the label "Activity Chat".

### B. Push notifications (frontend + Firebase)

- **Firebase:** device token registry at `users/{uid}/devices/{token}`; per-event subscription level (item C); Cloud Functions that send pushes: chat message created goes to subscribers on "all"; event changed goes to subscribers on "all" or "changes"; reminders from a scheduled function before the event start (proposed 24 h and 1 h) go to subscribers on "all", "changes" or "reminders". Rate limiting and batching; invalid-token cleanup.
- **iOS:** permission priming just in time after the first join, never at launch; token registration and refresh; notification tap routes to the event or the chat; badge and unread basics.
- **Prerequisites (must be recorded and met first):** push needs the paid Apple Developer team (a free Personal Team cannot use push); an APNs auth key uploaded to the Firebase project; the `aps-environment` entitlement in `project.yml`; an App ID registered under the paid team with the Push capability. Therefore push cannot be device-tested with today's personal-bundle-ID builds. Plan emulator and unit tests for the functions now, and a TestFlight device check once the account is set up (ties to F8).

### C. Notification settings

- **UI:** a bell icon button at the top left of the Activity Chat screen opens a dropdown menu with the per-event setting All / Changes / Reminders / None (checkmark on the current one, a short description under each). The same setting is reachable from the event page (a small bell in the Who's Attending / actions area), and a global default lives in Profile settings.
- **Semantics (proposed; owner to confirm):** All = chat messages + event changes + reminders. Changes = event detail changes + reminders. Reminders = reminders only. None = nothing.
- **Default (proposed):** joining an activity subscribes the member to "changes" and not to chat; leaving unsubscribes.
- **Storage:** per user per event, for example `events/{eventId}/subscriptions/{uid}` with a `level`; server-validated; readable only by the owner.

### D. Event change history

- **Backend:** a Firestore onUpdate trigger on `companies/{c}/events/{id}` appends an entry to a bounded array `changeLog` on the event document: `{at, by (uid, server-derived), revision, changes: [{field, from, to}]}`, for user-visible fields only (title, description, time, venue, price, capacity, tags, cover, status including cancel/restore). Cap at the latest about 50 entries. Guard against self-trigger loops: ignore writes that only touch `changeLog`, `attendeeCount`, `updatedAt` or `revision` bookkeeping. The same trigger sends the "changes" push.
- **iOS:** a "Changes" (history) button on the event page opens a designed history list, most recent first, human-readable ("Time moved from 12:00 to 1:00 PM"); empty state "No changes since it was posted". The portal event edit screen can show the same history later.

### E. Add to calendar

- **UI:** an icon button to the left of the date pill at the top right of the event page header (the pill that shows, for example, "Nov 19 at 12:00"). The Figma header frames need the new icon.
- **Behavior:** adds the event through EventKit (iOS 17 write-only access, requested just in time): title, start/end, location from the venue, notes with a short description. Handle denied or limited access with a clear fallback; show a confirmation state; no duplicate adds for the same event. Also include it in the share/details where useful.

## Backlog (later tasks)

Not started and not scheduled.

- **Shake to report a bug.** A designed screen or sheet opened by shaking the device: category, description, an attached screenshot with simple markup, diagnostics (app version and build, iOS version, device; anonymous), a privacy note, and submit, success and failure states. Where reports go is undecided: a Firestore collection written by a callable, or a GitHub issue created by a backend function. The design exists as a "Shake to report" page of 10 frames in the onboarding Figma draft file; implementation is a later frontend task, not started.
- **Notifications, Rewards, raffle, venue/weather.** Stretch, not selected (see below).
- **TestFlight and release.** Needs the new paid Apple Developer team; steps are in F8.
- **Figma updates (design owner).** Update the main-file navigation bar and the onboarding frames to the gift Rewards icon.

## Stretch goals (not selected, do not start)

V2-S01 activity chat (now selected, item A above), V2-S02 raffle, V2-S03 rewards redemption (Rewards frame exists in Figma, tab is a dead end today), V2-S04 photo comments/favorites (mock-backed UI exists, placement redesign pending), V2-S05 notifications (push is in the owner-approved items above; the Home bell stays hidden until it is wired), V2-S06 venue/weather (Places provider unconfirmed). Each needs its own issue before work starts, per the [V2 handoff](README.md).

## Decisions needed

1. **Points placement:** Home header pill, Profile, or both?
2. **Filter control:** chip row on Home, or a sheet behind a filter button? Preselect profile interests, or default to all?
3. **Where invitations live:** Home "Invitations" entry (recommended) vs waiting for the notifications stretch.
4. **Coworker list for invitations:** how the app gets same-company coworkers without leaking cross-company data (a callable vs a narrowly scoped read rule): backend call.
5. **Photo limits:** types, max size, max count per upload, who may upload (participants only?), retention: needed before F5 ships.
6. **Onboarding:** team approval of PR #49 and the spec; approve all phases or only some.
7. **Activity chat:** decided, build live now. Remaining: record V2-S01 as selected in its own issue.
8. **Shake report destination:** Firestore collection written by a callable, or GitHub issue via a backend function.
9. **Empty-state copy:** review the T4 copy before it ships.
10. **Design:** no Figma exists for the filter, invitations, points or the admin V2 screens (onboarding has a draft file). Compose from the design system, or request frames?
11. **Notification settings semantics:** confirm All / Changes / Reminders / None as defined in item C, and the default (joining subscribes to "changes", not chat).
12. **Reminder times:** confirm 24 h and 1 h before the event start.
13. **Change log:** confirm the user-visible field list and the cap of about 50 entries.
14. **Push timing:** push needs the paid Apple Developer team, APNs key, entitlement and App ID; decide when the account is available (F8). Until then only function and unit tests are possible.
15. **Owners:** V2 owners are still TBD in the milestone; assign them before cross-area items start.

## Suggested order (Nov 10 – Dec 4)

| Window | Frontend work | In parallel (others) |
| --- | --- | --- |
| Nov 10–16 | Backend slice C1 starts (chat rules, push functions, preferences, change log, reminders); in parallel streams: onboarding builds P0/P1/P3/P4, weekly theme T1/T2/T3 and empty states T4 (all already running); F0 cleanup; F1 filtering (+ O2 if approved); F2 points display; settle the decisions above; start F8 account/bundle decisions | Backend/organizer: finalize schemas and fixtures for the V2 commands; review and production step for weekly themes |
| Nov 17–23 | C2 chat live + bell menu once current iOS agents finish; Onboarding P2 and scenes B2-B5; F3 submissions UI against mock; F4 invitations UI against mock; A1/A2 against mock | Backend: `submitChallengeV1`, `sendInviteV1`/`respondToInviteV1` with tests; rules |
| Nov 24–30 (Thanksgiving week, expect reduced capacity) | C3 history UI, add to calendar, settings UI, push registration (UI and tests; no device push yet); wire F3/F4 adapters as backends land; F5 upload pipeline (also used by F3) | Storage rules, `finalizeEventPhotoV1`, `recordAttendanceV1`/`approveChallengeV1` |
| Dec 1–4 | F5 live; A1/A2 live; F6 sweep; F7 coverage numbers and device flows; F8 TestFlight build; push device check only if the paid team is ready | Integration owner: full-flow verification, fixes |

If the backend lags, the mock-first approach means the UI and tests for F1–F5 are still done and reviewable; the adapter swap is the only remaining work. Items to drop first if time runs out: onboarding phases after P1, the Backlog items, push device verification, then the polish part of F5 (upload cancel/partial-retry UX), never F1/F2/F3/F4's core acceptance rows.

## Owner requirements ledger (Nov 10-11, 2026)

Every request the owner made while the V2 frontend was being built, with its state on `main` (checked against the code on Nov 11). Status values: **Done** (merged), **In progress** (an agent is on it), **Queued** (assigned, not started), **Held** (owner said not yet), **Not started**. Nothing leaves this list until it is Done and the owner has seen it. Update the row, do not delete it.

| # | Request | State | Where / PR |
| --- | --- | --- | --- |
| 1 | Onboarding demos use the real app screens in an iPhone frame (lower portion visible), no "Example" tag | Done | #63, #73 |
| 2 | Equal bottom gap and side gaps around the demo phone | Done (verify on device) | #63 |
| 3 | First tour step: Sign out icon button top-left, flat-left on replay | Done | #63 |
| 4 | Demo bars show all four tabs including Rewards | Done | #63 |
| 5 | Sign-in "Finding your company" without dots + faces animation in the circle (alternatives behind `--progress-style`) | Done | #63 |
| 6 | "Who's going" demo zoomed/cropped; My Events pointer at the tab's real position; no opacity snap at the end | Done (unverified on screen) | #73 |
| 7 | Consistent onboarding button copy | Done | #77 |
| 8 | Haptics: shared helper, actions vs navigation | Done for bottom bar, interest picker, onboarding, toggle, Profile save/sign out, album upload, RSVP stored/failed (#81). **Remaining: chat send and optimistic join/leave (Events agent), Rewards redeem (page is still a mock notice). None felt on a device yet.** | helper in #63; call sites #81 |
| 9 | Profile: About inside the coloured header, designed header, solid unioned shapes, no overline labels, empty state for memories | Done | #69 |
| 10 | Tapping a memory opens the gallery on that exact photo | Done | #69 |
| 11 | App-assigned avatar badge on the profile photo; shape + colour from a stable uid hash, used app-wide | Done: Profile badge, Home header, Home cards, event page and participants (#69, #79, #81). Not converted: mock fixtures, weekly-challenge avatar row (no uids), chat authors (no uid plumbing; chat not live yet) | #69, #79, #81 |
| 12 | Home recents empty state matches the memories format (all empty states consistent) | Done | #71 |
| 13 | Swipe from the left edge goes back everywhere | Done (album photo viewer and sheets excluded) | #74 |
| 14 | My Events Active/Memories toggle draggable and not clipped | Done | #78 |
| 15 | Home event cards: attendee avatars must load without opening the event; "N going" if tight | Done (background prefetch of 3 attendees per card; chip reads "N going") | #79 |
| 16 | Rewards: original raffle layout with solid gift-box cards and small bows; badge tab; progress inside the raffle card; no "Discounted Experiences" header | Done | #65 |
| 17 | Event page: calendar pill top-right of the PAGE (short date, solid); Directions pill left of Share; Leave Activity at the bottom once joined; no When/Where/Price labels | Done | #68, #70, #72 |
| 18 | Share text as flowing paragraphs; tags wrap; share link (universal link) | Done; rich preview card (title, description, image) built server-side, see docs/design/share-links.md. Team ID and App Store ID still placeholders | #68, #75, share-link-previews PR |
| 19 | Outline = not pressable, solid = pressable (Goal/Reward outline pills, header title outlined) | Done (white informational chips and disabled bar left as is) | #72 |
| 20 | Mock-data launch mode for the real app | Done | #67 |
| 21 | Optimistic join/leave with reasonableness checks; full event shows a disabled "Activity full" bar (wording kept per owner; disabled state verified in EventBarActionTests) | Built on `feature/optimistic-rsvp`; unit-tested rules and reducer, not device-tested | Events agent |
| 22 | Activity Chat live (Firestore adapter), fix "not working" on the phone build, bell menu in chat (All/Changes/Reminders/None) | In progress | Events agent |
| 23 | Event change-history button and sheet | Merged into `feature/v2-remaining` (PR #100); not merged to main | Events agent |
| 24 | Push registration, permission priming, deep links | Stream A PR 4 merged into `feature/v2-remaining` behind a flag (off by default); unit-tested with fakes, device-unverified: needs the paid team APNs key and aps-environment | Events agent |
| 25 | Weekly-theme page polish to match the event page | Stream A PR 3 merged into `feature/v2-remaining` (calendar window pill, info card, not-started/active/ended states) | Events agent |
| 26 | Reward points an event gives (show if it has them) | Stream A PR 2 on `feature/v2-remaining`: outline points pill on the event page and Home cards (hidden at 0); in quality rounds | Events agent |
| 27 | Shake-to-report bug screen (design exists) implementation | In review (`feature/v2-stream-c`); markup and shake prompt deferred | Backlog B |
| 28 | TestFlight release | Not started, needs the paid team | F8 |
| 29 | Known failing UI tests to repair after the owner's fix list (two demo-stage, interests search, chat/photo-comment retry, ScreenFlowTests join expectation) | Not started | F7 |
| 30 | Owner process rules: no large-text/accessibility work, no full test runs while landing, merge early, shared Claude-DIP simulator under the lock | Standing | all agents |
| 31 | Rich link previews (og/twitter metadata: title, short description, image; no address/PII) for event share links | In progress (agent building a public function behind the hosting rewrite; not deployed) | share-link previews agent |
| 32 | Apple Team ID for Universal Links (replace `TEAMID` in apps/admin/public/aasa/apple-app-site-association.json, build with the paid-team entitlements, set App Store ID, redeploy hosting) | **Blocked: waiting for Apple to approve the owner's developer account.** The association file is already served correctly on team05-dip.web.app (appAssociation NONE, PR #86); only the Team ID and App Store ID are missing | owner |

