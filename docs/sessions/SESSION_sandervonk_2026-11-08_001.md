# Work session

User: sandervonk
Date: 2026-11-08
Workstream: V1-08 default event imagery; #42 review
Agent: Claude Code
Status: handoff

## Summary

Reviewed Derek's PR #42 (member event reads): the rules are tenant-bound and payload-checked, member lists require scheduled status and a limit of 100 or less, organizer reads are preserved, and writes, RSVPs and receipts stay denied. The new companyId/status/startTime index matches the feed query. The cloud session could not merge or deploy (GitHub 403, no Firebase credentials). On the local Mac, with the owner's request, #42 was merged (7552050, head aa109b4, 5/5 checks green) and `firebase deploy --only firestore:rules,firestore:indexes --project team05-dip` was run from identical rules/index files; it reported success.

Started V1-08 on top of #42's branch: category-based default event images.

## Changes

- ui/Packages/DIPCore/Sources/DIPCore/EventCover.swift: `DIPEventCover` resolves an event image from the approved `catalog://default/<category>` URL (mirrors APPROVED_COVER_URLS in eventDraft.ts), then the first tag with a known category, then a fixed fallback (outdoors).
- ui/Packages/DIPCore/Tests/DIPCoreTests/EventCoverTests.swift: 5 tests covering catalog precedence, round-trip, parity with server URLs, tag fallback and the default.
- ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Resources/EventCovers.xcassets: cover_fitness/outdoors/hiking/games/cooking, the same prototype photos the admin portal uses (release rights still unconfirmed, docs/design/README.md).
- ui/DIP/Data/Events/MemberEventAppRepository.swift: live event details use the category image instead of the empty placeholder.

## Validation

- `npm run test:rules` on #42 head aa109b4: 96/96 pass (Node 22.23.4; AGENTS.md asks for 24.12+).
- `npm run test:swift` (Linux Swift 6.0.3 toolchain): all four packages pass, including EventCoverTests.
- `npm run check`: 78 pass, 0 fail, 6 todo.
- Local Mac: `npm run ios:generate` and `xcodebuild build -scheme DIP` (iPhone 17 Pro Simulator, CODE_SIGNING_ALLOWED=NO) succeeded with the V1-08 images.
- Not run: Simulator visual check of cards/details; Xcode app/UI tests.

## Decisions

- Tag-to-category mapping for tags without their own image: social/chill use games, food uses cooking, energetic/hype/wellness use fitness. The design owner should confirm.
- V1-08 was stacked on #42 and has been rebased onto main after the merge.

## Handoff

- Simulator check that category images appear on Home cards and event details; confirm the tag-to-category mapping.
- Open the V1-08 PR from `main-aaj4vf` when ready.
- Remaining: production organizer create/edit test, V1-09 sharing, V1-10 usability pass; RSVP end to end (Omer's backend branch).
