# SwiftUI repository boundary

The running prototype uses DIPRepository through DIPAppViewModel. Its concrete adapter is DIPMockRepository, injected in DIPPrototypeApp. Feature files import DIPCore models and shared presentation components; they do not import DIPMockData or Firebase. To substitute another implementation, pass it to `DIPPrototypeApp(repository: adapter)` at the composition root.

## Reads and commands

| Interface | Current mock | Firebase implementation handoff |
| --- | --- | --- |
| observe() -> AsyncThrowingStream<DIPAppSnapshot, Error> | Immediately emits exact Figma fixtures, then committed updates; terminates subscribers on simulated failure | Merge authorized Firestore listeners into app read projections; unsubscribe on cancellation; surface permission/network/decode failures. Scope and paginate queries; this projection is not a request for the whole tenant. |
| setRSVP(eventID:going:) | Actor serializes and publishes idempotent membership/count changes | Call setRsvpV1 using generated SetRsvpRequest, contractVersion 1 and authenticated membership scope; map going/cancelled. The callable acknowledges; Firestore event/RSVP listeners render the result. |
| updateProfile(ProfileEdit) | Validates, commits and emits editable profile fields | Direct own-user allowed-field update under reviewed rules. Map department, city and interest IDs; displayName is OAuth/server-owned under ADR0007; do not submit full user DTO or any role/company/points fields. |
| sendMessage(eventID:messageID:text:) | Validates and publishes local messages | V2 preview seam. Finalize author, participation, length and timestamp rules before enabling actual chat writes. No callable is invented here. |
| addPhotoComment(eventID:photoID:commentID:text:) | Validates parent photo, commits attributed/timestamped comment, publishes event/photo-scoped thread | V2 seam. Finalize comment authorization, ownership, length, timestamp and idempotency policy before real writes. No new callable export. |
| addPhotos(eventID:photos:) | Accepts bounded local byte batches and caller-retained photo IDs, publishes album updates | V2 preview seam. Resolve upload/finalization policy, Storage authorization, durable retry IDs and cleanup first; expose finalized observed metadata. Not a deployed upload API. |

The mock retains data only for the life of its repository instance. Reopening a screen uses that same instance; restarting the app resets it. Its synthetic IDs, dates and mismatched reference-frame counts are fixture content. It does not simulate Firebase authorization, offline persistence, full capacity/time policy or cross-device synchronization.

## Ownership and errors

The view model renders only stream snapshots. Awaiting a command does not manufacture Joined, append a message, import a persisted photo or overwrite profile fields. Commands expose pending state and errors; forms retain drafts on failure. Reconnection retains the last snapshot, marks updates paused and offers Retry. Initial loading and unavailable resource states are explicit.

Photo selection/decoding is native UI work; persistence is an asynchronous repository command. MediaReference is presentation-independent: asset name, remote URL or local bytes. DIPMedia resolves bundle resources, AsyncImage and picker data. Firebase Storage paths/timestamps/document snapshots stay in the future data adapter; remote URL caching/authentication/retry policy can be specialized there or in a media loader without changing feature layout.

## Implementation locations

- ui/Packages/DIPCore/Sources/DIPCore: read models and protocol, no SwiftUI/Firebase.
- ui/Packages/DIPCore/Sources/DIPPresentation: observation, loading, command coordination and errors.
- ui/Packages/DIPCore/Sources/DIPMockData: fixture content and mock adapter.
- ui/DIP/Features/Prototype: composition root, routes and dependency injection.
- ui/DIP/Features/Shared: media presentation adapter.
- ui/DIP/Data: future Firebase adapter/mappers; [callable contract](callables.md) and [ADR](../adr/0005-observable-ui-repositories.md) guide integration.

Contract DTO generation is unchanged. Domain read models are UI-oriented projections and must not be written directly to Firestore as persistence structs.

Chat/comment command IDs are generated once for a send intent and retained on an unchanged retry. The mock rejects reused IDs with different payloads and scopes photo threads by both event and photo. It derives author identity/name/avatar and timestamps from its adapter context. UI cannot assign another author. A future adapter must implement the same retry guarantee within reviewed transport/rules; the mock does not establish production authorization.
