# Firebase service setup

This directory is the backend boundary for DIP. It is ready for feature development; the account integration implements company membership and narrow profile access, but no cloud endpoint is deployed. Events, RSVPs, points and rewards remain pending.

## Layout

```text
functions/src/
  index.ts          Deliberate list of deployable exports; resolveMembershipV1
  transport/        Firebase v2 callable adapters and auth/error translation
  application/      Use cases and transaction orchestration
  domain/           Firebase-independent business rules
  infrastructure/   Firestore, Storage, and external-service adapters
  generated/        Generated shared contract types; root generator owns this
  modules/          Disjoint accounts/participation/organizer feature slices
functions/tests/unit/
tests/rules/        Firestore and Storage Emulator Suite tests
firestore.rules     Verified self-profile/company/tag subset; other paths denied
storage.rules       Deny-all client baseline
firestore.indexes.json
sample-data/        Synthetic V1 fixtures and local account details
scripts/seed.mjs    Guarded local Auth + Firestore seed
```

Node.js 22 is the Functions runtime. TypeScript compiles to CommonJS in `functions/lib`, with strict checks. Functions uses the v2 callable API when handlers are introduced. The Admin SDK and Functions SDK are declared now so contributors can add adapters without inventing a separate backend project.

## Local commands

Run from the repository root after `npm ci`:

```sh
npm run build --workspace @dip/functions
npm run test --workspace @dip/functions
npm run test:accounts:integration
npx firebase emulators:exec --project demo-dip --only firestore,storage "node --import tsx --test gcp/tests/rules/*.test.ts"
```

The rules suite requires Java supported by the installed Firebase CLI and free ports 8080 and 9199. Use the root CI workflow's Java version. For interactive development, build first and then run:

```sh
npx firebase emulators:start --project demo-dip --only auth,firestore,storage,functions
```

resolveMembershipV1 is exported and served by the Functions emulator; test it with synthetic Google credentials on the Auth emulator (see tests/integration). Production App Check is enforced; only the official emulator bypasses it. Copy `.firebaserc.example` to `.firebaserc` only if an alias file is useful locally. Keep `--project demo-dip` explicit in test commands. Choosing real development/staging/production projects and deployment credentials is separate work for a project administrator.

For a shared local starting dataset, follow [sample-data/README.md](sample-data/README.md). The seed script requires the exact local Auth and Firestore addresses and the `demo-dip` project. It restores reserved fixture IDs without clearing unrelated emulator data. Company membership is seeded through each company's `emailDomain`; the seed refuses subdomain, personal-domain or duplicate values.

## Test boundaries

- Unit harness: pending cases are recorded with `test.todo`; implement them with each corresponding feature. No feature coverage is claimed by this scaffold.
- Contract tests: the root contract suite validates shared examples and generated-type drift.
- Rules tests: real emulator requests establish that anonymous and signed-in clients cannot access Firestore or Storage before reviewed product rules exist.
- Integration tests: add Auth + Functions + Firestore tests for each callable; verify error codes, company isolation, retries, and transaction concurrency. Authenticated clients must call the callable through the client SDK so auth is exercised.

The initial rules intentionally prevent the future app from reading or writing data. Open only the paths required by an implemented feature, with explicit field allowlists and tests. Server authorization remains necessary because Admin SDK access bypasses these rules.

## Proposed indexes

The checked-in indexes support the planned queries; they are not proof that those features work:

| Collection / scope | Fields | Intended query |
| --- | --- | --- |
| `events` / collection | `status`, `startTime` ascending | Upcoming scheduled events under one company |
| `rsvps` / collection group | `companyId`, `userId`, `status`, `eventStartTime` ascending | A user's upcoming RSVPs across their company's events |
| `rsvps` / collection group | `companyId`, `userId`, `status`, `eventStartTime` descending | A user's past RSVPs |

Collection-group reads need a matching collection-group authorization rule and tenant predicates in the query; company-nested paths alone do not secure a collection-group query. Reconcile each actual query, its rules, and its index together in its feature PR. Firestore emulators do not validate production index availability; verify indexes in a dedicated development project before release.

## Before the first deployment

Review contract decisions with the iOS owner, select project IDs and region, configure billing and least-privilege deployment access, add feature-specific rules and handlers, and complete emulator integration tests. This setup does not create a GCP project, assign live organizer roles, seed live company join codes, or deploy infrastructure.

Each feature module owns its internal transport/application/domain/infrastructure layers. Use module-local implementations for parallel development; top-level layer folders are only for reviewed cross-cutting helpers. The integration owner wires named exports in index.ts.

The [account integration contract](../docs/contracts/accounts-integration.md) records throttling, narrow permissions, editable-profile limits and the native-client handoff. No product readiness is inferred from the still-pending workflow TODOs.
