# iOS quality audit, November 2026

Date: November 17, 2026. Scope: the iOS work merged in the V2 stretch push: calendar conflicts and one-tap add (#231), Profile > Notifications with the Email section (#235, #242), push permission and registration, iPhone Duo (#226, #227), weekly themes on Home, onboarding, invitations, album, photo comments and chat. Bar: a Fortune 500 consumer app.

Method: five independent read-only reviews (calendar; push and security; Duo, Home and themes; onboarding, accounts, invitations and Profile; album, event page and design system), lead triage, fixes by area with targeted tests, pixel-diff screenshots against `main` on a regular iPhone (iPhone 17 Pro simulator, `--mock-member`), an AX3 Dynamic Type pass, a Duo smoke test and a design audit of every intended visual change. Evidence: test names below, the PR descriptions and the session log `docs/sessions/SESSION_sandervonk_2026-11-17_131.md`. Screenshots were captured into the session scratchpad and are not committed.

Severity: **P0** privacy, crash or data loss; **P1** wrong behavior users will hit; **P2** polish, accessibility or performance; **P3** nit. Status: **Fixed** (PR), **Owner** (needs a product or design decision), **Open** (not done, reason given), **Unverified** (needs a device).

## Summary

- 1 P0 privacy defect fixed: a phone signed out offline kept receiving the previous member's pushes.
- About 35 P1 defects fixed across calendar, push and session cleanup, offline writes, onboarding, Duo state loss and album memory.
- Regular iPhone looks are unchanged except the deliberate changes listed under "Visible changes" (each with before/after screenshots and a design-audit verdict).
- Open and owner items are at the end.

## P0

| ID | Finding | Evidence | Status |
| --- | --- | --- | --- |
| PUSH-Q1 | After an offline sign-out, the device registration and FCM token survived; the signed-out phone kept getting the previous member's pushes. A retry ran as the next user and silently did nothing. | `PushRegistration.swift` pending unregister held only a token; server unregister is caller-scoped | Fixed (#266): pending unregister bound to its uid, token deletion retried at launch and activation while signed out. Tests: `PushRegistrarTests.testTokenDeletionIsRetriedWhileSignedOutUntilItWorks`, pending-not-retried-as-other-uid |

## P1 (fixed in #266)

| ID | Finding | Fix and test |
| --- | --- | --- |
| PUSH-Q2 | A register in flight at sign-out re-registered the old uid | Serialized register/refresh/sign-out with uid check; `testSigningOutDuringAnInFlightRegisterDoesNotPersistTheRegistration` |
| PUSH-Q3 | Only the Profile sign-out path cleaned up; expired or revoked sessions skipped push, calendar and queue cleanup | One session-end hook in `DIPApp` (push, link inbox, calendar records, bug-report queue, cached home models, Debug tour record) |
| PUSH-Q4, ALB-Q3 | 15 s write timeouts reported queued Firestore writes as failed; edits then produced duplicate chat messages | Timeout means pending, real errors still fail; `ChatSourceTests` timeout cases |
| PUSH-Q5 | Reload overwrote an in-flight toggle | Guarded; `DIPNotificationSettingsModelTests` |
| PUSH-Q6 | Email preferences unreachable with push off (spec: independent) | Settings model built whenever a preferences repository exists; Profile shows a "Notifications" row |
| PUSH-Q7 | Deep-link ids accepted `.`, `..`, `__x__`, Unicode; pending link survived sign-out | `[A-Za-z0-9_-]{1,128}`, inbox cleared on session end; `DIPShareLinkTests` |
| PUSH-Q8 | No explicit APNs token forwarding in the SwiftUI lifecycle | Flag-gated `UIApplicationDelegateAdaptor` (Unverified on device) |
| PUSH-Q12 | Permission revoked in Settings left the device registered | Unregister on activation when denied |
| SEC-Q1/Q2 | Debug launch flags (`--push-enabled`, fixtures, failure injection) honored in Release | `MockLaunch.Flags` returns false in Release |
| CAL-Q1 | Entry deleted in Calendar left a disabled "Added" pill forever | Reconcile on store change and appear; `CalendarModelTests` |
| CAL-Q2 | Undo said "Removed" when nothing was removed | Retry by URL, honest failure copy |
| CAL-Q3 | "Add anyway" could present the editor over a dismissing alert and hang the pill | Stable presenter, swipe-dismiss resumes once, failure path |
| CAL-Q4 | Challenge pill double tap stacked two editors | In-flight guard |
| CAL-Q5 | Tap before conflicts loaded skipped the overlap alert | Awaits a fresh read |
| CAL-Q6 | Own entry counted as a conflict on calendars without URL | Excluded by `eventIdentifier` too |
| CAL-Q7 | All-day detection wrong on DST days (23 h day) | Calendar-day arithmetic; DST tests for 2026-03-08 and 2026-11-01 |
| CAL-Q9 | EventKit fetches on the main thread, refetch on every store change | Off-main reads, debounced observer |
| CAL-Q10, EVT-Q2 | "Leave and remove from calendar" removed the entry even when leave failed, or offered removal with nothing to remove | Removal only after a confirmed leave and a found entry |
| CAL-Q11 | Re-adding after sign-out or reinstall duplicated the entry | Adopts the existing DIP entry |
| ONB-Q1 | Failed "Try again" on the no-company notice stuck on "Finding your company" | `retryMembershipFailureLeavesResolvingInsteadOfSticking` |
| ONB-Q2 | Back during the interests save left the tour with no way forward | Back/skip disabled while saving; `OnboardingTourModelTests` |
| ONB-Q3 | Success haptic fired while the stage still showed the spinner | Fires when the hold ends |
| INV-Q1 | "Already answered" invite told the member they could decline | Neutral state, no buttons |
| DUO-Q1/Q2 | Hinge flag flips swapped the whole view tree (all state lost) | Process-wide latch; hysteresis 760/740 pt; `DuoLayoutTests` including regular-iPhone widths |
| HOME-Q1 | Rapid double tap pushed the same page twice | Route dedupe on all push sites; test |
| ALB-Q1 | Photo import loaded every original at once (memory pressure) | At most 2 concurrent; `AlbumUploadQueueTests` |
| EVT-Q1 | Chat Send enabled for 1001 to 2000 characters, then did nothing | Composer takes the channel's limit |
| EVT-Q3 | Back disabled during a pending RSVP (up to the callable timeout) | Only Join/Leave disabled |
| EVT-Q4/Q5 | Duplicate and false VoiceOver join announcements; double haptic | Announce after confirmation or rollback; one haptic |

## P2 and P3 fixed in #266

CAL-Q12 (pill label includes the visible date, hint), CAL-Q14 (toast 10 s under VoiceOver, Undo action), CAL-Q15 (conflict copy shows day and "All day"), CAL-Q16 (Profile toggle reflects real access; denied, restricted and write-only copy), CAL-Q17, CAL-Q20 to CAL-Q25; PUSH-Q11, PUSH-Q13 to PUSH-Q15; ONB-Q6/CAL-Q18 (models built once per scope instead of every parent re-init), ONB-Q9, ONB-Q13, ONB-Q14; INV-Q3, INV-Q6, INV-Q7; PRO-Q1, PRO-Q2; DUO-Q4, DUO-Q6 to DUO-Q9, DUO-Q11; HOME-Q2, HOME-Q14; ALB-Q2 (44 pt hit areas, same look), ALB-Q4 (decode once, off-main, cached), ALB-Q8 (share the event link), ALB-Q9, ALB-Q10, ALB-Q11; DS-Q2 (send haptics, no navigation haptics).

Lead review note: a fixer had changed `AccountsSession.signOut` to restore the session silently on a failed remote sign-out; that reverses a reviewed accounts contract and was reverted. Device-local wipes now run only when the session is really over, which removes the original risk.

## Phase 2 (accessibility, contrast, visible polish, launch)

Fixed in the phase 2 PR unless marked otherwise.

| ID | Sev | Finding | Status |
| --- | --- | --- | --- |
| HOME-Q10 | P1 | Fitness theme title was white on pink #FB72E4 (2.43:1, fails large-text 3:1); the luminance threshold picked the wrong color | Fixed: title picks the higher-contrast of white and ink (white kept on the locked purple); Fitness now ink (6.6:1). Test `testEveryCatalogAccentTitleReachesLargeTextContrast`. Visible change, design audit PASS |
| DS-Q4 | P2 | "Leave Activity" and composer errors in system red (~3.6:1); Share pill white 14 pt on pink (3.2:1) | Fixed: new `errorRed`/`textError` tokens (#C62828, 5.6:1); Share pill ink on pink (4.98:1). Visible, audit PASS WITH NITS. Owner sign-off requested |
| EVT-Q6 | P2 | Past event with no photos showed an empty "Photo Album" heading and blank scroll, and a "View Album" dead end | Fixed: compact "No photos yet" state with a photo glyph, neutral tiles while loading; bar shows "Add Photos" when the member can add, otherwise no album action. Test in `MemberAlbumTests`. Visible, audit nits applied |
| ALB-Q6, DS-Q5 | P2 | Failed photo looked like loading forever | Fixed: broken-photo icon, label "Photo couldn't load" (no mock fixture to capture) |
| HOME-Q13 | P2 | "Load more events" was an unstyled system-blue link under 44 pt | Fixed: design-system secondary button with spinner, 16 pt spacing; Debug flag `--home-load-more` to review |
| HOME-Q5 | P2 | Mascot art fixed 350x222 frame, overflow on narrow phones | Fixed: art scales with card width and is masked at sides and bottom; 402 pt rendering unchanged |
| HOME-Q6, HOME-Q7 | P2 | Mascot art upscaled on @3x (730 px); `EventCard1` 3612x2400 (2.6 MB) | Fixed: 8 mascots re-exported at 1460 px from the SVG sources (Fitness has no SVG, unchanged); EventCard1 downscaled to 1200 px (275 KB) |
| HOME-Q12, PRO-Q4, INV-Q4, ONB-Q8, CAL-Q13 | P2 | Fixed heights and one-line labels clip at accessibility text sizes (Home and My Events cards, Participants rows, invite controls, tour chips, date pill) | Partly fixed: AX-only relaxations (min heights, wrapping, one-column memories, stacked invite rows, date pill under Back). Default size pixel-identical (verified by diff). AX3 still has issues, see Open |
| DS-Q3 | P2 | Hit areas under 44 pt (bell, avatar, "+ N More", Done, Edit, Add, Retry interests) | Fixed: hit areas grown without visual change |
| VoiceOver structure | P2 | Missing header traits; "View all 12" button label | Fixed: header traits on section titles; "View all N attendees" |
| DS-Q7 | P2 | Custom fonts ignored Bold Text | Fixed: one face heavier when Bold Text is on; `DIPAdaptiveSizingTests` |
| ONB-Q12, DS-Q6 | P3 | Animations and toast transitions ignoring Reduce Motion | Fixed: opacity-only or no animation under Reduce Motion |
| ONB-Q4 | P2 | Failed interests catalog message hidden from VoiceOver and AX layout | Fixed (no fixture to capture) |
| PRO-Q6 | P3 | Offset-based identity in My Events memories and Participants | Fixed |
| Launch | P2 | Cold launch of the Debug simulator build shows white for 8 to 10 s | Investigated, not fixed: about 1.8 s dyld over the Debug dylib and Firebase/gRPC frameworks, about 2.2 s of SwiftUI type-descriptor work on a background thread, about 0.4 s protocol-conformance lookups; app code after `main` is about 0.7 s of main-thread work. Same on `main`. Needs a Release-build measurement on a device; flattening the largest view bodies is the likely lever |

## Open and owner items

### Needs the owner

- **Fitness title in ink** and **Share pill in ink on pink** (contrast fixes, design audit passed). Alternative for Share: a darker pink about #C04384 with white text.
- **New tokens** `errorRed` / `textError` (#C62828).
- **Profile > Notifications is now visible without the push flag** (Email section only). Email sending is still off server-side; decide whether members should see email switches before email launches.
- **Rewards tab shows fixture progress and offers** (INV-Q2) in every build; gate it or confirm it is intended for V2.
- **Purple on white small text** (outline chips such as "Showing N of M", 3.11:1) remains below 4.5:1; ACCESSIBILITY.md already lists the one-token fix if the owner reopens it.
- **Haptics setting**: `DIPHapticGate` reads `dip.haptics.enabled` but nothing writes it (DS-Q1). Either add a Profile switch or remove the key; iOS System Haptics already applies.

### Open

- **AX3 layout** (verified by screenshots after phase 2): the weekly-theme card (section title truncated, title over art, participants pill and arrow overlap), event card chips ("16 going" wraps per syllable), "See All" pill, card dates truncated, "Who's Attending" breaking mid-word, info-card icons overlapping text, My Events segmented control truncated. Needs a dedicated AX layout pass for those components (most are design-system components with fixed geometry).
- **CAL-Q8** Unverified: whether EventKit shows an all-day event whose end is the next midnight as one or two days. Check on a device; the challenge path already stores the last day inclusively.
- **CAL-Q19** Home cards reorder once calendar conflicts arrive, even while scrolling.
- **PUSH-Q9 / PUSH-Q10** Foreground banner for the chat the member is reading; app badge not managed. Push is device-unverified.
- **ALB-Q5, ALB-Q7** Album downloads every original at full size each launch (no disk cache or thumbnails); uploads cannot be cancelled and an iCloud-only original has no preparing timeout.
- **ALB-Q12** The photo viewer's "Allow saving photos" alert inherits the viewer's dark scheme (left as is).
- **DUO-Q3, DUO-Q5** Hinge window lookup by scene order; folding/unfolding still rebuilds page-local state (scroll, segment, drafts) though routes and tab survive.
- **HOME-Q3, HOME-Q17** Hidden tab pages re-render on every shell update; challenge page goes missing if the theme changes while open.
- **PRO-Q5** My Events and Participants have no loading state (show empty copy while loading).
- **ONB-Q5, ONB-Q7** Interests step not skipped for an empty catalog; keyboard covers the embedded picker's lower rows.
- **INV-Q5** Invite lists capped at 50 without ordering (may need an index).
- **SEC-Q3 to SEC-Q5** FCM token pair in UserDefaults (not Keychain); `dip://` scheme claimable by other apps (ids only); install id shared across accounts.
- **Device checks**: push registration and delivery, calendar permission prompts and revoke, Firestore offline write behavior, VoiceOver walk on hardware.
