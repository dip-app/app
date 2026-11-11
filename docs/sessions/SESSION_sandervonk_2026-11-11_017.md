# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Stream B live albums iOS
Agent: Claude Code
Status: completed

## Summary

Stream B (F5, V2-05) iOS client on `feature/v2-stream-b-ios`, on top of the album backend merged in #96: live album grid, add flow with per-photo progress/retry, live viewer comments, shared empty states, listener disposal on sign-out. Fixtures, Preview and `--mock-member` keep the in-memory repository.

## Changes

- ui/DIP/Domain/Events/MemberAlbum.swift: `AlbumPolicy` (slots, limits), records, `AlbumFailure`, `PhotoAlbumSource`.
- ui/DIP/Data/Events/FirebasePhotoAlbumSource.swift: Storage slot upload with progress, cancellation and checksum-verified retry; `finalizeEventPhotoV1`; album, own-photo and comment reads; own-author comments.
- ui/DIP/Data/Events/MemberEventAppRepository.swift: album listener for the opened event, authenticated image downloads (display copies), upload rights, slot reservation per upload ID, viewed-photo comments, `updateAuthor`, disposal in `stop()`.
- ui/DIP/Support/AlbumImageProcessing.swift (JPEG <= 2048 px, <= 10 MB, metadata stripped, alpha flattened); FirebaseBootstrap Storage emulator + factory; DIPApp/DIPMemberHome wiring.
- ui/DIP/Features/Album/AlbumUploadQueue.swift, DIPAlbumScreen.swift, EventBarAction, DIPPrototypeApp (shell-owned queue, bar progress, haptics, Debug review args); MockLaunch album review args.
- DIPCore (additive): `DIPAlbum.canAddPhotos/remainingUploads/isLoaded/loadError`; `DIPRepository.uploadPhoto` (default over `addPhotos`); `DIPAppViewModel.uploadPhoto`.
- Tests: DIPTests/Events/MemberAlbumTests.swift (album repository, queue, bar), EventBarActionTests update, DIPUITests/AlbumFlowUITests.swift.
- Docs: FRONTEND_PLAN ledger row, PhotoComments README.

## Validation

- `xcodebuild build-for-testing` (DIP, iOS Simulator 27.0): succeeded.
- `swift test --package-path ui/Packages/DIPCore`: pass.
- Shared simulator (Claude-DIP, under /tmp/dip-sim-lock), final run 03:02: DIPTests 179 executed, 0 failures (2 skipped emulator-only); DIPUITests/AlbumFlowUITests 2/2. An order assumption in the queue test was flaky (preparation is concurrent) and now checks each draft is sent once. `MockMemberLaunchUITests.testEventOpensWithVenueAndDirections` fails on the base too (it looks for a "100 Example Street" fixture string that no longer exists; F7 item).
- Screenshots: grid, upload drafts, empty (can upload / read-only), read-only album.
- Not verified: a real device upload against production (needs #96 deployed), PhotosPicker selection inside UI tests (system picker is out of process).

## Decisions

- Quality rounds: R3 design audit REVISE 7.6 -> PASS ~8.2 (per-tile Retry/remove, explicit counts, Retry all, alignment, scrim); header link outline button flagged to the owner (pre-existing Figma asset). R4 review APPROVE WITH FIXES -> APPROVE (author refresh, cancellable uploads, checksum safety, worker generation, precise denials, alpha flattening).

- Two PRs for the stream (backend #96, iOS here); the viewer/comments/empty states share DIPAlbumScreen and the repository wiring, so a third PR would only split one file.
- Uploads run one at a time from a shell-owned queue (continue while navigating); bytes are never shown through URLs.
- The empty state invites "Be the first to add one." only when the member may upload; the bar pill is the single add action.

## Handoff

Follow-ups: release a reserved slot when a never-uploaded failed draft is removed; drop a finished draft if the album listener died; favorites and photo deletion; captions. Owner: deploy #96, then try Boat Ride on a device.
