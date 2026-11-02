# Shared application repository boundary

This package has three separately importable products:

- `DIPCore`: Foundation domain/read models and `DIPRepository`. Feature views and application state depend on these types rather than mock fixtures or Firebase.
- `DIPMockData`: deterministic reference fixtures and an actor implementing the repository protocol. Only the composition root, previews, and tests select this implementation.
- `DIPPresentation`: the observable application view model, owned by the presentation workstream, which turns repository observations and command failures into UI state.

The mock is runnable app data, not a production backend or a new wire contract. Repository models are UI-facing application projections, distinct from generated `DIPContracts` DTOs. Existing transport schemas and privileged operation semantics remain unchanged.

## Reads and writes

`observe()` asynchronously provides an `AsyncThrowingStream<DIPAppSnapshot, Error>`. Each subscription immediately receives current state; committed changes are published to all active subscriptions. Streams buffer the newest snapshot, so slow consumers see current state rather than treating this as an event log. Cancellation removes the subscriber. Listener failures terminate the affected observation; the caller can subscribe again.

`DIPAppSnapshot` carries Home/challenge/cards/recent-attendee content, active events, memories, profile/favorite memories, event details, participants, albums, messages, and photo comments. Photo comments are keyed by event ID and then photo ID, so identical photo IDs in different albums do not share a conversation. Stable IDs key all event-related projections and routes. Every memory/favorite points to an explicitly keyed album. A future Firebase implementation should merge authorized, scoped and paginated listeners into these projections; this aggregate does **not** instruct it to load a company's entire dataset, and no Firebase adapter is implemented here.

Commands are asynchronous and throwing: `setRSVP(eventID:going:)`, `updateProfile(_:)`, `sendMessage(eventID:messageID:text:)`, `addPhotos(eventID:photos:)`, and `addPhotoComment(eventID:photoID:commentID:text:)`. The actor owns mutation and publishes the resulting snapshot. A command acknowledgement is not an alternative source of read state: consumers observe snapshots instead of changing their own copy optimistically. A future adapter will translate these domain commands to approved versioned callables or authorized data writes; chat/photos remain later-version prototype interactions, not a claim of V1 backend support.

Chat and comments carry stable IDs, author ID/name/avatar, text, and a creation timestamp. The sender supplies one message/comment ID per send intent and retains it across retries. The mock validates the parent event or album/photo, trims text, and accepts 1–2,000 Swift characters. Reusing the same scoped identity with the same author and normalized text succeeds without adding a duplicate or changing its original timestamp; a different payload with that identity is rejected. Message IDs are scoped to an event; comment IDs are scoped to event and photo. Sender attribution comes from the mock's current profile, not caller-supplied author fields. Reference chat attribution/time is deterministic and reference comments start empty.

`DIPAppViewModel` forwards the same stable IDs and records pending keys as `message:<eventID>:<messageID>` and `comment:<eventID>:<photoID>:<commentID>`. Failures propagate to the caller and set a generic command error; the UI keeps its draft and ID until a successful acknowledgement. The view model does not invent a message/comment in its read state when a command acknowledges; only a repository observation updates the snapshot.

`MediaReference` represents a named bundled asset, a remote URL, or in-memory bytes. UI loaders resolve the correct resource bundle and decode/validate images; no UIKit or SwiftUI types cross this boundary. The mock validates nonempty photo payloads and the existing 25 MB selection limit; it cannot validate image file contents using Foundation alone. `PhotoUpload.id` is supplied once by the caller and preserved, preventing repeated imports of the same selected item from adding duplicates.

## Mock selection and controls

```swift
import DIPCore
import DIPMockData

let repository: any DIPRepository = DIPMockRepository()
// Reference joined-screen launch state:
let joinedRepository = DIPMockRepository(initiallyJoinedEventIDs: ["puppy-yoga"])
// One-shot failures for draft-retention/retry integration tests:
let failingRepository = DIPMockRepository(initialFailures: [.message: "offline", .comment: "offline"])
```

The default direct album route is `kayaking-memory`. Reference event IDs are `puppy-yoga`, `kayaking`, `hike`, `game-cafe`, `mount-diablo-hike`, and `cooking-class`. Memory event IDs are `kayaking-memory`, `hiking-memory`, `rug-tuft`, `boat-ride`, `rage-room`, `paint-sip`, `ceramics`, and `book-club`.

The reference frames contain intentionally inconsistent sample counts: Home Puppy Yoga has 7 attendees, its unjoined detail has 16, its joined detail has 17, and the participants reference lists 17 people including Elissa. The mock preserves those exact initial visuals instead of pretending they form authoritative server data. RSVP changes are idempotent and update the relevant projections once; joining switches the detail's avatar set and count to the joined reference. Profile updates, chat messages, photo comments, and photo imports remain shared for this repository instance across navigation, rather than local screen state. Albums reuse the same 12 reference images initially, but an import changes only its target album.

For integration tests, `failNext(_:message:)` injects a one-shot error for observation, RSVP, profile, message, photos, or comment; `failObservation(message:)` terminates current listeners. `replaceSnapshot(_:)` simulates an external update; `currentSnapshot()` supports assertions. None of these mock controls belong to `DIPRepository` or need to exist in a production implementation.

## Validation

From the repository root:

```sh
swift test --package-path ui/Packages/DIPCore
```

The latest full package run passed **15 tests**: 10 repository tests and 5 presentation tests, with no failures. Repository tests preserve fixture values and media identities, verify two-observer updates, concurrent RSVP idempotency, profile/message/photo mutation, chat/comment attribution and timestamps, stable retry identities, cross-event/photo isolation, parent and text validation, error preservation/retry, invalid batch atomicity, external changes, and joined launch state. Presentation tests use an independently controlled protocol implementation to verify observation ownership and command acknowledgement/error behavior separately from the mock, including chat/comments.

These are package checks, not simulator-flow verification. The repository holds state only for the lifetime of its actor instance. It does not persist across relaunch, authenticate users, enforce real tenant membership, synchronize between devices, moderate content, or connect to Firebase. Production listener scopes, authorization, persistence, and adapter behavior remain separate implementation and test work.
