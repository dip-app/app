# Data and ownership contract

Firestore stores Timestamp values; JSON boundaries and fixtures use ISO 8601 UTC strings; Swift uses Date. Store money in integer cents, distances in miles (as supplied), coordinates in decimal degrees. Document `id` is snapshot metadata injected by an adapter, never a persisted field. Optional supplied Swift fields accept absent or null values; maintain this on decoding. Existing field names and collection paths are preserved unless an ADR explicitly changes them.

The schema currently includes all 18 supplied document structs plus embedded Venue, and request/response/draft types. Later-feature document types are reference scaffolding, not implemented features. Known enums are documented in operation specs; many source document status fields remain String until their feature defines the allowed values. Do not infer business semantics from the generated type alone.

| Data/path | Swift read contract | Planned client write boundary |
|---|---|---|
| Firebase Auth | current user and verified email | Auth SDK for V1 email/password; Apple/Google later |
| users/{uid} | Self only in V1; no company-wide list of private profiles | Own allowlisted profile fields only after rules tests. companyId, role, email, pointsBalance, createdAt are server-owned. Other employees appear through minimal RSVP snapshots; public directory needs a separate projection. |
| companies/{companyId} | Own-company public metadata only | Server/admin tooling only. Existing joinCode must move to a private lookup before opening reads; rules cannot hide a single field in an otherwise readable document. |
| tags/{tagId}, partners/{partnerId} | Authenticated shared catalog; partners later | Trusted seed/admin tooling only |
| companies/{c}/events/{eventId} | Tenant-scoped feed and details | Create/update callable; counts, revision, author/audit and points server-owned |
| .../events/{eventId}/rsvps/{uid} | Same-company attendee list; own joined events | setRsvp callable only; attendance later admin callable |
| users/{uid}/notifications/{id} | Recipient only, later | Server creates; recipient may change isRead only |
| companies/{c}/challenges/{id}, submissions/{challengeId}_{uid} | Same-company challenges and completion summaries, V2 | Admin management and submission/approval commands; no client counters/status approval |
| .../pointTransactions/{id} | Own ledger, V2 | Server append-only, deterministic award IDs; balance and ledger updated atomically |
| .../rewards/{id}, .../raffles/{id} | Same-company catalogs, stretch | Admin commands; server-owned stock/counts |
| .../redemptions/{id}, .../raffles/{id}/entries/{uid} | Own private code/entry; no broad code list | Server only |
| .../photos/{photoId} | Same-company past-event albums, V2 | Finalization command after authorized Storage upload; comments/favorites stretch |
| .../events/{eventId}/messages/{id}, .../photos/{photoId}/comments/{id} | Authorized tenant/participants, stretch | Proposed own-author append with strict rules; counters server-only |
| .../invites/{id} | Sender/recipient only, V2 | Send/respond commands, server-owned acceptance and notifications |

**Current rules deny all reads/writes.** This table is the target access design, not an assertion that access is enabled. Each feature PR must implement and test its permitted subset. Admin SDK bypasses Firestore rules, so every function must perform its own authorization.

## Queries and indexes

Feed: `companies/{c}/events` filtered status==scheduled, startTime>=now, ordered startTime; paginate by cursor, default page 20 and maximum 100. My Events: collectionGroup `rsvps`, constrained companyId, userId, status==going, ordered eventStartTime; fetch corresponding events in bounded batches and split Upcoming/Past by current Event.endTime. Rules for collection-group access must explicitly constrain resource companyId and userId; nested path rules alone are insufficient. Attendees: event RSVP subcollection status==going, paginated; do not expose full AppUser profiles for it. A Firestore listener, not the command response, drives joined-state persistence.

Indexes are tracked in gcp/firestore.indexes.json. Timestamp edits require keeping RSVP.eventStartTime snapshots consistent; index/query release is blocked until the update strategy is tested. Denormalized display names/avatars may be snapshot-at-RSVP in V1; profile propagation is a separate decision.

## Storage

Planned V2 object path `companies/{c}/events/{eventId}/{photoId}.jpg` matches the source. Before enabling uploads, settle accepted image formats, size limit, uploader metadata, authorization on event participation, metadata finalization and orphan cleanup. Prefer authenticated SDK access; permanent download-token URLs are bearer URLs and weaken company isolation if shared. The source's downloadURL field is legacy/reference; settle delivery policy before implementing photos. V1 default event images are bundled or approved static assets, not Storage user uploads.

## Internal server data proposals

- `companyAccess/{sha256(normalizedJoinCode)}` resolves a code to companyId; deny client access. Hashing alone does not protect a low-entropy code: authenticated access plus server-side throttling is required. Seed lookup records with companies. Do not return join codes in company DTO responses.
- `companies/{c}/commandReceipts/{uid_requestId}` holds deduplication metadata/payload hash and created event ID; deny clients. Retain for at least the supported client retry lifetime; choose retention before implementation.
- Event.revision (integer >=1) is an intentional addition to the supplied model for concurrent organizer editing. Existing event seeds need revision=1. Never deploy a schema migration implicitly.
