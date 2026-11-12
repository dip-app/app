# Work session

User: sandervonk
Date: 2026-11-11
Workstream: iOS notifications center
Agent: Claude Code
Status: completed

## Summary

The bell now opens a real Notifications center: a live, paged list grouped by day with type icons, unread dots, mark as read on open, Mark all as read, an Invitations entry, loading, empty, error and offline states, and a permission banner that only exists when the push client flag is on. The server now also creates in-app notices for event changes and cancellations and for challenge approval and requested changes. Nothing was deployed.

## Changes

- ui/Packages/DIPCore: DIPNotifications.swift (kinds, destinations, repository protocol, grouping, relative time, write batches), DIPPresentation/DIPNotificationsModel.swift, DIPMockData/DIPMockNotificationsRepository.swift; tests NotificationRulesTests and DIPNotificationsModelTests.
- ui/DIP: Features/Notifications/DIPNotificationsScreen.swift, Data/Notifications (Firestore adapter and mapper), Domain/Push/PushPermissionControl.swift and a permissionControl on PushCoordinator, wiring in DIPApp, DIPMemberHome, DIPPrototypeApp, FirebaseBootstrap; ui/ComponentPreview/project.yml includes the seam; DIPTests/Push/NotificationDocumentMapperTests; UITests/NotificationsTests and InvitesTests (bell now goes through the center).
- ui/Packages/DIPDesignSystem: DIPBadgeCount caps the bell badge at 9+ (home header and DIPHeader) with a test.
- gcp/functions: notifications handlers/ports/store/transport (InboxWriter, create-only event_updated and event_cancelled items, id event_{eventId}_{revision}, same recipients as the push); submissions ports/store/commands (createNotice: challenge_approved_{challengeId}, challenge_changes_{challengeId}_{attempt}); unit tests extended.

## Validation

- swift build --build-tests for DIPCore; xcodebuild build of the Preview app; screenshots of list, permission banner, empty, error, loading in the scratchpad shots/notifications folder. Per the speed rules no tsc, npm run check, emulator or whole-suite runs; the new unit, UI and function tests are written but not run.

## Decisions

- No rules change: the existing owner read (limit <= 50) and isRead-only update cover everything. Pages are cursor based; the unread listener is capped at 50 and the badge shows 9+.
- No local Cleared concept (no delete rule; skipped as not cheap).
- Reminders are not mirrored in-app (push only) to avoid noise. Event notices go to the same subscribers as the push (levels All and Changes).
- The permission banner uses the explicit tap as consent; the first-RSVP priming policy is unchanged.

## Handoff

Deploy (owner): functions onEventChanged and approveChallengeV1/rejectChallengeV1 (submissions callables) for the new in-app notices; no rules or index deploy. Unverified: real Firestore listeners and pagination, push permission flow on a device, the new function tests.
