# V1 account integration

This slice connects Google sign-in and email-domain company membership ([ADR 0007](../adr/0007-oauth-domain-based-sign-in.md)) to a real callable, narrow Firestore access, and a Swift repository/session boundary. It does not add the onboarding screens (separate PR), deploy resources, or commit project configuration.

## Backend and client ownership

`resolveMembershipV1` is exported in Functions source in proposed region `us-central1`. Firebase Auth handles Google sign-in; there is no email/password, verification-email or join-code flow. The callable derives UID, email, verification, sign-in provider and name from the Auth token and accepts only `{ contractVersion: 1 }`. It requires provider `google.com` and a verified email, reduces the email domain to its registrable root with the Public Suffix List (`tldts`), refuses personal email providers, resolves the private `companyDomains/{root}` lookup and creates/replays membership transactionally. It never accepts a caller-assigned company, role, name or balance.

Production callable requests require App Check. Only the official Functions-emulator environment disables enforcement. The app installs its provider in `FirebaseBootstrap` before `FirebaseApp.configure()`: the App Check debug provider in Debug and Simulator builds (register the debug token it prints in Firebase console -> App Check -> Manage debug tokens; tokens are local and never committed) and App Attest in Release device builds. The team has no paid Apple Developer Program membership yet, so the App Attest entitlement is not configured (free Personal Teams cannot sign it); Debug builds run from Xcode on a personal iPhone use the debug provider and their own registered debug token. Before TestFlight/App Store, add the App Attest entitlement (see `FirebaseBootstrap`) and register App Attest with the Team ID. Confirm the region/data-location decision before deployment.

An eligible UID gets five attempts per server-clock minute, counting successes, replays and unmapped domains. Invalid, unauthenticated, non-Google, unverified and personal-domain requests are rejected before any read and do not consume the budget. `accountRateLimits/{uid}` is server-only. The transaction evaluates the clock after its read on every retry, never overwriting a newer window with an older one. Future-window records fail closed. This is a fixed-window budget, not a sliding-window guarantee. `expiresAt` is a cleanup marker; no TTL policy was deployed. Errors map to the callable envelope with stable reasons including PERSONAL_EMAIL_DOMAIN, NO_COMPANY_FOR_DOMAIN, PROVIDER_NOT_ALLOWED, EMAIL_NOT_VERIFIED, MEMBERSHIP_CONFLICT, RATE_LIMITED and INVALID_STORED_MEMBERSHIP.

## Firestore access and profile limits

Verified callers can get/listen to their own user document, including a missing document during company resolution. Other users and profile collection listing remain denied. Clients cannot create/delete user membership documents. Own updates can change only photoURL, avatarId, department, jobTitle, city, interestTagIds, travelRadiusMiles and availability. displayName comes from OAuth and is written only by the callable; company, role, email, points, audit data and later-feature friend/favorite arrays are also immutable to clients.

The direct-write policy bounds profile text to 120 characters, photoURL to 2048, radius to an integer 0..500, and each interests/availability list to 10 nonempty strings of at most 120 characters. The stored displayName must still be a trimmed string of at most 80 characters, which the server guarantees. Rules validate every list element; the 10-item bound keeps a maximal valid update within Firestore's expression budget. Swift EditableProfile mirrors these checks.

A same-company public document can be fetched only through immutable membership. The private `companyDomains` lookup and limiter records are denied to every client, including company admins. Verified callers may read the shared tags catalog. Event, RSVP, organizer, photo/chat and other feature paths remain denied until their own reviewed tests/rules arrive.

## Swift composition

DIPAccounts is a Foundation/Observation package. AccountsRepository publishes identity/profile/error observations; AccountsSession exposes signed-out, authentication-pending, resolving-company, no-company (personal domain, unmapped domain, conflict, permission), member and recoverable-error states. When a verified identity has no profile, the session calls `resolveMembership()` once per identity; the profile listener, not the acknowledgement, publishes membership. `retryMembership()` re-runs it after a no-company or transient failure. A cancelled Google sheet is not an error.

FirebaseAccountsRepository lives in ui/DIP/Data/Accounts and takes configured Auth, Firestore and Functions instances. `signInWithGoogle()` reads the iOS client ID from the configured FirebaseApp, presents GoogleSignIn (10.0.0) and signs in to Firebase Auth with the Google credential. Callable `reason` details map to portable AccountsFailure values without exposing payloads or emails. No Firebase or Google SDK types escape into the package, and Firestore Timestamp/document IDs are mapped explicitly.

`FirebaseBootstrap` (ui/DIP/Support) is the single attach point. It configures Firebase only when a local `ui/DIP/Support/GoogleService-Info.plist` exists, routes Debug builds to the emulators when the scheme sets `DIP_USE_EMULATORS=1` (Auth 9099, Firestore 8080, Functions 5001 on 127.0.0.1), creates the repository, and forwards `onOpenURL` to GoogleSignIn. The URL scheme comes from `GOOGLE_REVERSED_CLIENT_ID` in an untracked `ui/Config/Local.xcconfig` (see `Local.example.xcconfig`). Connecting the real project therefore needs only those two local files and `npm run ios:generate`.

Call stop() when disposing the session; call signOut() for an explicit sign-out. Both clear private rendered state/listeners and sign out of GoogleSignIn. Generation guards reject stale profile events, old stream completions, pending command completions and stale resolution results after a restart or identity change. Unexpected stream termination fails closed.

## Repeatable checks and next handoff

- `npm run check` runs the accounts unit tests under gcp/tests/unit (root-domain coercion, personal domains, OAuth names, eligibility ordering, membership semantics, transport) in both Node 24 and the Node 22 Functions-runtime CI job.
- `npm run test:rules` runs the baseline/account rule tests, including client denial of displayName and `companyDomains`.
- `npm run test:accounts:integration` builds exports and runs Auth+Functions+Firestore emulator tests with synthetic Google credentials: real callable transport, provider/personal/unmapped rejection, subdomain coercion, defaults/replay/OAuth name, conflicts and concurrent throttling.
- `npm run test:swift` includes DIPAccounts; the full generated app build compiles the SDK adapter, GoogleSignIn and FirebaseBootstrap in CI.

SDK compilation and JavaScript-client emulator tests do not establish a native device onboarding flow. Next: onboarding screens on AccountsSession, the project owner enabling the Google provider and registering the iOS app, App Check provider setup, tenant-scoped event adapters and a physical-device check.
