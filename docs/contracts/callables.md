# Callable endpoint contract

`joinCompanyV1` is implemented/exported and emulator-tested in the V1 account integration; it is not deployed. Other operations below remain **unimplemented**. V1 request/response types are executable schemas; V2 describes the next handoff and requires expansion before its implementation. Firebase v2 `onCall`, proposed region `us-central1`, Node 22. Swift uses `Functions.functions(region: "us-central1").httpsCallable("setRsvpV1")`; endpoints are named exports, not guessed REST URLs. Region needs the team's GCP/data-location decision before deployment.

Firebase Auth handles email/password signup/sign-in/reset directly. Every callable requires a valid Firebase user. Use the SDK's callable error mapping; no custom success/error envelope. Payloads and responses carry `contractVersion: 1`. Derive the caller UID from Auth. Look up the server-owned `users/{uid}` membership for every company operation; never trust client role, companyId, balance, counters, or a supplied userId as authorization. joinCompanyV1 enforces App Check outside the official Functions emulator. A deployed client must configure its provider/debug workflow before rollout; production is not bypassed.

## V1 operations

| Export | Request -> response schema | Permission | Atomic behavior and retry contract |
|---|---|---|---|
| `joinCompanyV1` | JoinCompanyRequest -> JoinCompanyResponse | Signed in; verified email before membership | Normalize code by trim + uppercase. Resolve server-only code lookup. Create users/{auth.uid} with role member and balance 0 from Auth email + displayName. Other required profile fields get documented empty defaults (strings empty, lists empty, radius 20, createdAt server time). Existing same-company member returns membership; different-company account fails. Never promote a user or auto-join by unverified email domain. The integration enforces five validated attempts per verified UID per fixed server-clock minute, including wrong codes and replays. |
| `setRsvpV1` | SetRsvpRequest -> SetRsvpResponse | Same-company member acting for self | Transaction reads event + own RSVP. `going` requires scheduled, future start and available capacity unless already going. `cancelled` may cancel before start; after start fails. Update RSVP and attendeeCount in the same transaction, retaining cancelled row. Repeating the same state is a no-op; no underflow. Rejoining sets going once. Concurrent last-seat attempts admit at most one user. |
| `createEventV1` | CreateEventRequest -> CreateEventResponse | Same-company admin (V1 organizer) | requestId is a UUID retained by the caller across retries. Store a private company+uid+requestId deduplication record and event in one transaction. Same request returns same event ID and revision; same key with different payload fails. Server assigns companyId, createdBy, createdAt, attendeeCount=0, pointsValue=0, status=scheduled, revision=1. |
| `updateEventV1` | UpdateEventRequest -> UpdateEventResponse | Same-company admin | Full draft replacement and scheduled/cancelled status; no hard deletion in V1. expectedRevision guards lost updates. Transaction increments revision; mismatch returns aborted and client reloads before retry. Capacity cannot be below active attendeeCount. Editing times propagates denormalized RSVP eventStartTime with an explicitly tested strategy before release. |

EventDraft is a full writable payload; startTime/endTime are RFC3339 UTC, end > start, start in future when creating. Capacity is 1..10000, costCents is a nonnegative integer, title 1..120 chars, description 1..5000. Schema validates syntax; application layer validates time ordering, tag existence, venue coordinate bounds (-90..90/-180..180), string trimming, same-company references, and URL policy. Server defaults V1 coverImageURL from the chosen category; incoming URL must match the approved default-image catalog. V1 does not upload user images. The catalog is pending design asset approval.

RSVP server snapshots userName/userAvatarId/userDepartment and eventStartTime from trusted records. companyId/eventId/userId match the path; checkedIn=false, checkedInAt=null on first creation, createdAt server timestamp. Cancellation does not award points or erase attendance. Response is an acknowledgement; Firestore listeners remain the source of rendered event/RSVP state. Disable duplicate UI submissions while in flight, but rely on server transactions for correctness.

## Errors

| Callable error code | Meaning | Frontend action |
|---|---|---|
| unauthenticated | No valid Firebase Auth user | Sign in again |
| invalid-argument | Shape, version, IDs, fields or date validation failed | Show field errors; do not retry unchanged |
| permission-denied | Membership/admin/verified-email check failed | Explain access failure; never silently select another tenant |
| not-found | Authorized tenant resource absent, or generic invalid join code | Refresh or correct code; don't reveal other company data |
| failed-precondition | Closed/past event, conflicting membership, or reused requestId with changed payload | Show reason and reload relevant state |
| resource-exhausted | Event full or join-code rate limit | Show capacity/try-later message |
| aborted | Event revision conflict | Reload and ask user to reconcile edits |
| unavailable / deadline-exceeded | Transient service/network issue | Retry safely under operation's rule; preserve requestId |
| internal | Unexpected failure | Generic user message; log correlation ID without personal data or join codes |

Use HttpsError details `{ reason: <stable machine code>, fields?: [<field names>] }`; no secrets or internal stack traces. Proposed reason values include EVENT_FULL, EVENT_CLOSED, REVISION_CONFLICT, MEMBERSHIP_CONFLICT, INVALID_JOIN_CODE, VALIDATION_FAILED and RATE_LIMITED, EMAIL_NOT_VERIFIED and INVALID_STORED_MEMBERSHIP. Error details are advisory; unknown reasons fall back to the code. A timed-out update is ambiguous: reload event revision/content before issuing a new update. RSVP acknowledgements may show a newer global attendeeCount on a later retry.

## V2 committed command map

These operations are design contracts to finalize with schemas and feature tests before work begins, not callable stubs or exports.

| Proposed export | Payload -> response | Invariants |
|---|---|---|
| `recordAttendanceV1` | RecordAttendanceRequest -> RecordAttendanceResponse | Admin confirms same-company going RSVP. Transaction sets checkedIn + server time and appends deterministic ledger entry `attendance_{eventId}_{uid}` once. Reject no RSVP/cancelled or invalid event window. Repeated approval awards 0 new points. Policy for attendance window/reversal remains open. |
| `approveChallengeV1` | ApproveChallengeRequest -> ApproveChallengeResponse | Admin approves existing same-company pending submission. Deterministic ledger key `challenge_{challengeId}_{uid}` prevents repeat awards. Update balance, submission and counters atomically. Repeated approval awards 0 new points; no negative/reversal flow until specified. |
| `submitChallengeV1` | companyId, challengeId, progress, caption, optional photo path -> submissionId, status | Caller owns submission `{challengeId}_{uid}`. Validate goal units/window/evidence, require same-company Storage path; client never approves or awards points. Server owns status and counters. |
| `sendInviteV1` | companyId, eventId, toUserId, message, requestId -> inviteId, status | Same-company sender/recipient; no cross-company lookup or notification leak. Request replay returns same invite. |
| `respondToInviteV1` | companyId, inviteId, response accepted/declined -> inviteId, status, RSVP status | Recipient only; accept uses the same capacity transaction as RSVP; no partial accepted invite if event is full. Replay is safe. |
| `finalizeEventPhotoV1` | companyId, eventId, photoId, storagePath, caption -> photoId | Authenticated same-company participant; finalized upload metadata and file ownership validated server-side. Event must be past; retries by photoId don't duplicate metadata. Upload object ownership/MIME/size and orphan cleanup policy must be settled before uploads open. |

All carry contractVersion=1. Notifications are server-authored documents. Counts and points are server-owned. Private deduplication records, membership code lookup and ledger uniqueness are implementation collections outside public DTOs.

## V2 stretch boundaries

Chat/comments: direct client writes may be enabled with membership, event participation, author ownership, allowed-field, length and server timestamp rules. Favorites: own profile allowed-field update. Rewards redemption: a future `redeemRewardV1(companyId,rewardId,requestId)` transaction checks eligibility, stock and balance, appends a unique ledger deduction and returns a private code; payload/schema/code-use policy needs a separate ADR. Raffle entries are server-created once per user/raffle; no automated draw. Venue/weather integrations go through backend adapters with secrets and quota controls; never expose partner API secrets in Swift. In-app invite/approval notifications are recipient-only reads with isRead-only client edits. These are not V1 endpoints.

The [V1 account integration](accounts-integration.md) records limiter semantics, editable-profile rules, Swift session ownership and emulator commands. Generated schemas are unchanged.
