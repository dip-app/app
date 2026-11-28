# Work session

User: sandervonk
Date: 2026-11-28
Workstream: ios-polish-wave5
Agent: Claude (Opus)
Status: completed

## Summary

iOS polish program, wave 5, on main after #379: the wave 4 "Later" items that stayed in scope. ST-8 (the full-page load failure keeps its header and Profile), CHAT-1 (the chat sheet uses the shared sheet header) and ST-7 (next steps for "Nothing planned yet" and "Activity full", a product call the owner delegated if the evidence supports it). Mid-session the owner dropped A11Y-3 and TYPE-2: large Dynamic Type sizes are not a concern and are not tested, so no XXXL or AX3 work or captures were done. No AX-only code had been written, so nothing was reverted. iOS `ui/` only; no backend or contract changes.

## Changes

- `ui/DIP/Features/Prototype/DIPPrototypeApp.swift`: the shell failure keeps the fixed header (unread count from the notifications or invitations adapter, avatar from the account profile) and shows the member's Profile on the Profile tab; the Profile page builder is shared (`profilePage`); a route opened after a failed first load shows the failure card with Try again under Back instead of a skeleton; the avatar flight uses the account avatar when there is no snapshot; the activity page gets `onBrowseActivities` (Home) except on the open Duo.
- `ui/DIP/Features/Invites/InviteNotice.swift`: `InviteSheetHeader` gains an optional accessory before close and a shared muted circle.
- `ui/DIP/Features/Chat/DIPActivityChatScreen.swift`: the shared sheet header with the bell menu as its accessory and the grabber, replacing the system navigation bar and Done.
- `ui/DIP/Features/EventDetails/DIPEventDetailsScreen.swift`: the full-activity note under the title with "See other activities".
- `ui/DIP/Features/Home/DIPHomeScreen.swift`: the Home empty message points to the current weekly challenge.
- `ui/DIP/Features/Duo/DIPDuoShell.swift`: the Duo detail placeholder copy ("No activity open").
- `ui/DIP/Resources/Localizable.xcstrings`: new keys in en, es and tlh; two replaced Duo placeholder keys removed.
- `ui/ComponentPreview/UITests/EmptyStateFlowTests.swift`, `ConversationFlowTests.swift`, `ScreenFlowTests.swift`: the Home empty message expectation and the chat close button identifier.
- `docs/design/polish-2026-11/ios.md`: Wave 5 section with the ST-7 evidence and decision and the review record.

## Validation

- `xcodebuild build` DIP scheme, Debug, Claude-Base (scratch DerivedData), after each change: succeeded.
- `npm run ios:i18n-sync` equivalent (`python3 scripts/ios-i18n-sync.py --derived-data <scratch>`) then `npm run check:ios-i18n`: OK (1134 keys).
- ComponentPreview `Preview` scheme (`xcodebuild test`, Claude-Base): `ChatBellTests`, `EmptyStateFlowTests/testHomeShowsNoEventsInsteadOfAnEmptyCarousel` and `ConversationFlowTests` ran 12 tests with 1 failure (`testChatRetryAndReopeningKeepObservedMessages` tapped the old system "Done" button). That test and `ScreenFlowTests/testJoinAttendeesAndChatKeepLocalState` now tap `event.chat.done`; the rerun of both passed (2 tests, 0 failures).
- `python3 scripts/session-log.py check --base origin/main`: OK.
- Not run (targeted-tests rule): full suites, `npm run check`, rules tests, Release build.
- Manual: before (main at 77d1527f) and after captures in English and Spanish on Claude-Base; Claude-Duo folded and open (activity full, Home empty, chat). Design review with a fresh Opus reviewer per round: round 1 FAIL (four P2s, three fixed, one out of scope), round 2 PASS.

## Decisions

- ST-7: no waitlist or new-activity push exists, capacity is a live listener, and the weekly challenge is the one thing to do when nothing is planned. "Activity full" explains that Join returns if a spot opens and offers "See other activities"; "Nothing planned yet" points to the challenge card above in its message, because a second solid button duplicated that card (design review round 1).
- The yellow bell chip's contrast and the gray "Full" capacity note are older and unchanged; left for the owner.
- `--shell-state=failed` fails one observation, which the open Duo consumes while laying out; the failure was captured on the phone only.

## Handoff

- PR to main, not merged; nothing deployed or uploaded.
- Owner items: bell chip contrast in the Figma header; the generic "Couldn't load updates" text.
- Showcase pairs and captions: scratchpad `showcase/ios2/`.
- Simulators shut down, DerivedData deleted, lock released.
