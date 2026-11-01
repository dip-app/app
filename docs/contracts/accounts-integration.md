# V1 account integration

This slice connects the reviewed company-membership core to a real callable, narrow Firestore access, and a Swift repository/session boundary. It does not add or redesign onboarding screens, configure a production Firebase project, deploy resources, or replace the mock app repository in PR #3.

## Backend and client ownership

`joinCompanyV1` is exported in Functions source in proposed region `us-central1`. Firebase Auth handles email/password registration/sign-in and email verification. The callable derives UID/email/verification from the Auth token, validates the request before looking up codes, and creates/replays membership transactionally. Generated V1 request/response schemas are unchanged. It never accepts a caller-assigned company, role or balance.

Production callable requests require App Check. Only the official Functions-emulator environment disables enforcement. Configure an approved App Check provider before Firebase initialization in a deployed client; debug-provider setup belongs to the team's untracked local configuration. No production credentials/configuration are supplied by this MR. Confirm the region/data-location decision before deployment.

A verified UID gets five validated attempts per server-clock minute, counting wrong codes, successful joins and replays. `accountRateLimits/{uid}` is server-only. The transaction evaluates the clock after its read on every retry, never overwriting a newer window with an older one. Future-window records fail closed. This is a fixed-window budget, not a sliding-window guarantee. `expiresAt` is a cleanup marker; no TTL policy was deployed. Invalid/unauthenticated/unverified input does not read a code or consume the budget. Errors map to the existing callable envelope with stable reasons including RATE_LIMITED, EMAIL_NOT_VERIFIED and INVALID_STORED_MEMBERSHIP.

## Firestore access and profile limits

Verified callers can get/listen to their own user document, including a missing document for company onboarding. Other users and profile collection listing remain denied. Clients cannot create/delete user membership documents. Own updates can change only displayName, photoURL, avatarId, department, jobTitle, city, interestTagIds, travelRadiusMiles and availability. Company, role, email, points, audit data and later-feature friend/favorite arrays remain immutable.

The direct-write policy bounds name to 80 characters with no surrounding whitespace, other profile text to 120, photoURL to 2048, radius to an integer0..500, and each interests/availability list to 10 nonempty strings of at most120 characters. Rules validate every list element; the 10-item bound keeps a maximal valid update within Firestore's expression budget. Swift EditableProfile mirrors these checks. These are editable-profile persistence constraints, not silent changes to the generated AppUser wire schema. Existing server defaults fit them.

A same-company public document can be fetched only through immutable membership, and only if it has no legacy joinCode field. The private hashed companyAccess lookup and limiter records are denied to every client, including company admins. Verified callers may read the shared tags catalog. Event, RSVP, organizer, photo/chat and other feature paths remain denied until their own reviewed tests/rules arrive.

## Swift composition

DIPAccounts is a Foundation/Observation package. AccountsRepository publishes identity/profile/error observations; AccountsSession exposes signed-out, authentication-pending, verification-required, needs-company, member and recoverable-error states. Command errors do not invent membership. Only an observed valid own-user profile publishes MembershipContext.

FirebaseAccountsRepository lives in ui/DIP/Data/Accounts and takes configured Auth, Firestore and Functions instances. Use Functions.functions(region: "us-central1"). Configure emulator routing before creating listeners; the local ports are Auth 9099, Firestore 8080 and Functions 5001 at127.0.0.1. Use demo-dip only. Start with `npm run build` followed by `npm run emulators`, then seed synthetic data with the guarded seed command in another terminal.

After creating the repository, create AccountsSession(repository:), call start(), and render only from its state. Call refreshIdentity() after email verification: it reloads Auth and forces an ID-token refresh before restarting the own-profile listener. joinCompany(code:displayName:) normalizes the code and awaits an acknowledgement; the user listener supplies membership. updateProfile accepts only EditableProfile. No Firebase SDK types escape into the package, and Firestore Timestamp/document IDs are mapped explicitly instead of JSON-encoding DTOs into persistence structs.

Call stop() when disposing the session; call signOut() for an explicit sign-out. Both clear private rendered state/listeners. Generation guards reject stale profile events, old stream completions and pending command completions after a restart. Unexpected stream termination fails closed. Auth callbacks read the current SDK identity on MainActor instead of enqueueing a stale user snapshot.

## Repeatable checks and next handoff

- `npm run check` now discovers the real accounts unit tests under gcp/tests/unit in both Node24 and the Node22 Functions-runtime CI job.
- `npm run test:rules` runs the 95 baseline/account rule tests.
- `npm run test:accounts:integration` builds exports and runs Auth+Functions+Firestore emulator tests, serializing files because the legacy adapter suite resets its database. It tests real callable transport, refreshed tokens, contract defaults/replay/conflicts, wrong-code responses and concurrent throttling.
- `npm run test:swift` includes DIPAccounts; the full generated app build compiles the actual SDK adapter in CI. Project generation excludes Markdown resources to prevent duplicate README build outputs.

SDK compilation and JavaScript-client emulator tests do not establish a native device onboarding flow. Next: connect approved account/onboarding views to AccountsSession, initialize the configured Firebase app/App Check provider, connect MembershipContext to tenant-scoped event repositories, and verify the complete flow on a physical device. Other-laptop validation, production deployment and the V1 overall coverage target remain open.
