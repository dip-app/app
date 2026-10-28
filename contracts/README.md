# Shared contracts

Status: **specified for implementation; no callable endpoints exist yet**. This is the initial team proposal on `setup`. Agree on the open decisions before the first consuming feature PR, then treat v1 as a compatibility boundary.

`v1/models.schema.json` is the canonical, machine-readable JSON Schema (2020-12) for document DTOs and command payloads. `v1/fixtures/happy-path.json` is shared test evidence. `npm run generate` produces TypeScript types in the Functions source tree and Swift types in DIPContracts, plus the Swift test fixture. `npm run check:generated` detects drift. Schemas validate wire shape, not authorization or business rules. Generated Swift Codable types use String for enum fields; callers must still enforce schema/domain constraints. Swift decoding intentionally tolerates extra response fields for additive compatibility; request schemas reject unknown fields.

Read [callables](../docs/contracts/callables.md), [data ownership](../docs/contracts/data-ownership.md), and [open decisions](../docs/architecture.md). Contracts include Firebase Auth, Firestore, Functions, Storage and design-system boundaries, not just HTTP endpoints.

## Review protocol

1. Propose a field/operation change in schema and docs in one PR, with a frontend and backend reviewer.
2. Add representative success/error fixtures and tests; generate both language models.
3. Implement server authorization and business invariants separately; schema validation alone is insufficient.
4. Keep additive response changes optional for old clients. Renames, removed fields, new required client fields, enum semantics changes, or changed permissions need a new contract version or explicit migration.

No network API server or OpenAPI REST layer is assumed. Firebase's native callable SDK supplies the envelope and auth token; the payload is the schema object, not a hand-built HTTP wrapper. If a REST client is later required, design that transport explicitly.
