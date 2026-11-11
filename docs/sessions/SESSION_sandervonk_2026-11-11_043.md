# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Live Activity Chat
Agent: Claude Code
Status: active

## Summary

Live Activity Chat for the real app: Firestore adapter, error mapping, and the per-event notification bell menu. Root cause of "chat shows nothing": MemberEventAppRepository (the live repository) published `messages: [:]` and `sendMessage` threw "Chat isn't available yet", so a joined member could neither read nor send.

## Changes

- ui/DIP/Domain/Events/MemberChat.swift (ChatSource protocol, ChatFailure, validation), ui/DIP/Data/Events/FirebaseChatSource.swift (listener, idempotent send, subscription read/write; extends FirebaseParticipationSource), FirebaseParticipationSource.swift (shared state visibility, stop removes chat listeners), MemberEventAppRepository.swift (chat listener for the last opened joined event, send, notification level), DIPMemberHome.swift (chat author from the account profile).
- DIPCore: DIPNotificationLevel, DIPRepository requirements with defaults, mock in-memory level, DIPAppViewModel passthrough.
- Chat screen: bell menu top left, 1000 character limit, mapped error text.
- Tests: DIPTests/Events/ChatSourceTests.swift (written, not run), Preview ChatBellTests.

## Validation

- DIP scheme build succeeded. One Preview spot test (ChatBellTests) for the bell menu. No full suites, by owner request.
- Not verifiable without a device and a signed-in company account: live read and send, offline behaviour, rules enforcement.

## Decisions

- Messages ordered by createdAt descending with limit 100, reversed in memory: needs only the automatic single-field index; no new composite index.
- Offline send fails visibly after 15 seconds; the write stays queued and is idempotent on the message ID. A retry denied as an update is treated as success when the stored message matches.
- Chat listener is kept for the last opened joined event so the chat sheet opened from the participants page keeps working; it is disposed on another event, leaving the event, or repository stop (account switch).

## Handoff

Change history, push registration and the theme page are still on hold.
