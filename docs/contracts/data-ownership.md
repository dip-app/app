# Data and ownership contract

Firestore stores Timestamp values; JSON boundaries and fixtures use ISO 8601 UTC strings; Swift uses Date. Store money in integer cents, distances in miles (as supplied), coordinates in decimal degrees. Document `id` is snapshot metadata injected by an adapter, never a persisted field. Optional supplied Swift fields accept absent or null values; maintain this on decoding. Existing field names and collection paths are preserved unless an ADR explicitly changes them.

The schema currently includes all 18 supplied document structs plus embedded Venue, and request/response/draft types. Later-feature document types are reference scaffolding, not implemented features. Known enums are documented in operation specs; many source document status fields remain String until their feature defines the allowed values. Do not infer business semantics from the generated type alone.

| Data/path | Swift read contract | Planned client write boundary |
|---|---|---|
| Firebase Auth | current user and verified email | Google sign-in only in V1 (ADR 0007); no email/password. Apple later |
| users/{uid} | Self only in V1; no company-wide list of private profiles | Own allowlisted profile fields only (photoURL, avatarId, department, jobTitle, city, interestTagIds, travelRadiusMiles, availability). companyId, role, email, displayName (from OAuth, ADR 0007), pointsBalance, createdAt are server-owned. Other employees appear through minimal RSVP snapshots; public directory needs a separate projection. |
| companies/{companyId} | Own-company public metadata only | Server/admin tooling only. `emailDomain` is the authoritative sign-in lookup key (one lowercase registrable root domain, unique per company); `resolveMembershipV1` queries it with the Admin SDK. Never store secrets in this readable document. |
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

**The accounts integration opens only verified self-profile get/update, scoped public company get and shared tags reads. The organizer slice adds same-company reads of `companies/{c}/events/{eventId}`: members read scheduled events only (list queries must constrain companyId, filter `status == 'scheduled'` and specify a limit <=100), organizers (`role == 'admin'`) also read cancelled events. Events are written only by `createEventV1`/`updateEventV1`; `commandReceipts` is server-only. Other paths remain denied.** See [exact limits and integration status](accounts-integration.md); the remaining table is target access design, not an assertion that all access is enabled. Each feature PR must implement and test its permitted subset. Admin SDK bypasses Firestore rules, so every function must perform its own authorization.

## Queries and indexes

Feed: `companies/{c}/events` filtered companyId==c, status==scheduled and startTime>=the lower bound captured at refresh, ordered by startTime then document ID; paginate using both ordered values, default page 20 and maximum 100. The companyId constraint is required by event list rules; cursors are bound to the UID/company/query. The matching index source includes companyId, status and startTime with the implicit ascending document-ID suffix. Index deployment remains a separate release action; emulator success alone does not prove a production index is ready. My Events: collectionGroup `rsvps`, constrained companyId, userId, status==going, ordered eventStartTime; fetch corresponding events in bounded batches and split Upcoming/Past by current Event.endTime. Rules for collection-group access must explicitly constrain resource companyId and userId; nested path rules alone are insufficient. Attendees: event RSVP subcollection status==going, paginated; do not expose full AppUser profiles for it. A Firestore listener, not the command response, drives joined-state persistence.

Indexes are tracked in gcp/firestore.indexes.json. Timestamp edits require keeping RSVP.eventStartTime snapshots consistent; index/query release is blocked until the update strategy is tested. Denormalized display names/avatars may be snapshot-at-RSVP in V1; profile propagation is a separate decision.

## Storage

Planned V2 object path `companies/{c}/events/{eventId}/{photoId}.jpg` matches the source. Before enabling uploads, settle accepted image formats, size limit, uploader metadata, authorization on event participation, metadata finalization and orphan cleanup. Prefer authenticated SDK access; permanent download-token URLs are bearer URLs and weaken company isolation if shared. The source's downloadURL field is legacy/reference; settle delivery policy before implementing photos. V1 default event images are bundled or approved static assets, not Storage user uploads.

## Internal server data proposals

- `companies.emailDomain` maps a registrable root email domain to its company (ADR 0007). Clients cannot list or query `companies` or write `emailDomain` (rules deny both). Trusted seed/admin tooling must store a lowercase Public Suffix List root domain that is not a personal provider. Uniqueness is not enforceable by Firestore or rules, so it is enforced by process and fail-closed: the seed and `scripts/migrate-company-domains.mjs` refuse duplicates, and the resolver treats a domain claimed by two companies (or a non-root, non-string or differently cased value, which never matches) as NO_COMPANY_FOR_DOMAIN and logs an error. Every subdomain of a mapped root joins that company. The equality query uses the single-field index declared in `gcp/firestore.indexes.json`; no composite index is needed.
- `accountRateLimits/{uid}` holds the fixed-window membership-resolution budget; server-only.
- `companies/{c}/commandReceipts/{uid_requestId}` holds deduplication metadata/payload hash and created event ID; deny clients. Retain for at least the supported client retry lifetime; choose retention before implementation.
- Event.revision (integer >=1) is an intentional addition to the supplied model for concurrent organizer editing. Existing event seeds need revision=1. Never deploy a schema migration implicitly.
