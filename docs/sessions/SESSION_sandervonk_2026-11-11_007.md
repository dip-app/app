# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Home attendee avatar previews
Agent: Claude Code
Status: completed

## Summary

Home event cards showed attendee avatars only for events that had been opened. Cause: MemberEventAppRepository filled `participants[eventID]` (the source of a card's avatar stack) only from `loadAttendees`, which ran in `selectDetail` (opening an event) and after an RSVP. The feed itself carries only `attendeeCount`. Fix: prefetch a bounded preview after every feed page.

## Changes

- ui/DIP/Data/Events/MemberEventAppRepository.swift: after refresh and loadMore, `prefetchPreviews` reads up to 3 going attendees for each loaded event that has attendees and no cached list (4 reads in flight, one pass per page, off the feed path, cached in a separate `previews` map so a preview is never shown as the full attendee list; a failed read is retried on the next refresh). Attendee avatars now use the app-assigned avatar.
- ui/DIP/Domain/Events/MemberParticipation.swift and FirebaseParticipationSource.swift: `previewAttendees(scope:eventID:limit:)` (one query, limit 3, default implementation for fakes).
- ui/Packages/DIPCore Models.swift: `MediaReference.generatedAvatar(userID:)`; ui/DIP/Features/Shared/DIPMedia.swift renders it with DIPAssignedAvatar (DIPAvatarStyle.assigned(forUserID:)).
- ui/Packages/DIPDesignSystem DIPHomeComponents.swift: card chip text "N Attending" becomes "N going" (still hidden at zero); MemberEventsFlowTests updated to "0 going".
- Test: MemberParticipationTests.testHomeCardsGetAvatarPreviewsWithoutOpeningTheEvent.

## Validation

- `xcodebuild test -only-testing:DIPTests/MemberParticipationTests` on the shared simulator: all passed, including the new test (3 previews, none for a zero-attendee event, never presented as the full list). No UI suite run, no capture (owner: one compile and one spot check).

## Decisions

- Reads are allowed: firestore.rules lets same-company members list "going" RSVP rows (limit up to 100, `status == 'going'`), so a limit-3 query per event is permitted. No backend change is required for correctness.
- Cost: up to one extra read-of-3 per visible event per feed refresh. If that proves too costly, a server-owned `attendeePreview` (up to 3 `{userId, avatarId}`) maintained by setRsvpV1 on the event document would remove those reads; that would be an additive contract and rules-neutral change.

## Handoff

The unchanged `.asset("AvatarTeal")` fallback is still used for the signed-in member's own profile avatar (MemberProfileBridgeTests); only attendee avatars moved to the generated one.
