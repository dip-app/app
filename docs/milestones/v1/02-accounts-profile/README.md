# 02 — Accounts and profile

**Area:** Accounts. **Owner:** assign one human in the issue. Covers V1-01 and V1-02 from [V1](../../V1.md).

## Pasteable agent brief

> Implement the V1 accounts/profile packet in `docs/milestones/v1/02-accounts-profile/README.md`. Read root/folder `AGENTS.md`, root `SESSION.md`, `docs/contracts/callables.md`, and `docs/contracts/data-ownership.md`. Work only in owned paths in a separate branch/worktree. Implement Google sign-in, email-domain company membership using resolveMembershipV1 ([ADR 0007](../../../adr/0007-oauth-domain-based-sign-in.md)), and allowlisted own-profile editing. Keep UI, domain protocols, Firebase adapters, and function modules separated. Do not open shared rules or edit exports/configuration yourself; hand those requests to the integrator. Log each work session under `docs/sessions/` using `SESSION.md`; a session may have multiple commits. Report tests, contract decisions, and membership handoffs.

## Owned paths

- `ui/DIP/Features/Accounts/**`, `ui/DIP/Features/Profile/**`
- `ui/DIP/Domain/Accounts/**`, `ui/DIP/Domain/Profile/**`
- `ui/DIP/Data/Accounts/**`, `ui/DIP/Data/Profile/**`
- `ui/DIPTests/Accounts/**`, `ui/DIPTests/Profile/**`
- `gcp/functions/src/modules/accounts/**`
- Feature-specific files `gcp/tests/unit/accounts*.test.ts`, `gcp/tests/integration/accounts*.test.ts`, `gcp/tests/rules/accounts*.test.ts`.
- This packet's `README.md` and your own new session log(s).

Do not touch other packet-owned paths. Shared rules, exports, manifests, lockfiles, app composition, schemas/generated DTOs, and project wiring are integration-owned; request any test-discovery wiring before relying on new test folders.

## Prerequisites and contracts

Use [callables](../../../contracts/callables.md) for `resolveMembershipV1` and its schema/error/retry behavior, and [ownership](../../../contracts/data-ownership.md) for profile fields, company projection, and the private domain lookup. Company, domain-mapping and organizer seed data are manually maintained in V1. Google is the only V1 provider; personal email domains are refused and subdomains coerce to their root domain. A real Firebase project exists; its iOS configuration (`GoogleService-Info.plist`, reversed client ID) is local and uncommitted (ui/README.md). UI can use the preview repository and synthetic fixtures.

## Acceptance tests

- [x] Unit-test signed-out, signing-in, resolving-company, no-company (personal domain, unmapped domain, conflict), member, loading, cancelled sign-in and recoverable-error state transitions; never mark a failed resolution as joined. — `DIPAccountsTests/AccountsTests.swift`, `DIPTests/Accounts/AccountsOnboardingTests.swift` (#9, #10).
- [x] Test Google sign-in/sign-out and reloading persisted membership against emulators (synthetic Google credentials). Reject non-Google providers and unverified emails under the callable contract. — `gcp/tests/integration/accounts-*.test.ts` (Auth/Functions/Firestore emulators; email/password refused as `PROVIDER_NOT_ALLOWED`); unverified email in `gcp/tests/unit/accounts-resolve-membership.test.ts`. The Swift Firebase adapter was verified against the deployed project (November 3), not by an automated emulator run.
- [x] Test root-domain coercion, personal-domain refusal, unmapped domains without company-data leakage, existing same-company replay with OAuth display-name refresh, and rejection of conflicting membership. Verify resolution never promotes role or grants points. — `gcp/tests/unit/accounts-resolve-membership.test.ts`, `gcp/tests/integration/accounts-resolve-membership.test.ts` (#9); production default-app regression in `gcp/tests/unit/accounts-default-app.test.ts` (#20).
- [x] Test own-profile allowed-field edits and persisted interest selection. Attempted changes to companyId, role, email, displayName, balance, or createdAt must fail under the implemented rules. — `gcp/tests/rules/accounts-profile.test.ts`; client side `DIPAccountsTests/ProfileTests.swift` (#13), `DIPTests/Accounts/MemberProfileBridgeTests.swift` (#18, #19, #21).
- [x] Add rule tests for signed-out access, self versus other private profiles, company isolation, and forbidden direct membership/domain-lookup writes. Submit the smallest rule change to the integrator. — `gcp/tests/rules/accounts-profile.test.ts` (#6, #9); rules deployed November 3.
- [x] Ensure sign-out clears tenant-dependent state/listeners; another account cannot reuse the previous account's rendered private content. — session/listener tests in `AccountsTests.swift`; the member host is keyed by uid (#18) and saves are uid-bound (`updateProfile(uid:_:)`, #13).
- [x] Run contract checks, relevant backend tests, UI/domain tests, and emulator tests after wiring; report exact commands and results. Pending/mock tests do not establish end-to-end completion. — commands and results in each session log; end-to-end sign-in with a real Workspace account on Simulator and iPhone (November 3).

## Handoff

Provide discovery and organizer owners an authenticated membership-context protocol, readiness/error states, and a fake implementation. Confirm the role vocabulary (`member`/`admin`) without leaking authorization decisions into UI-only checks. Give the integrator function export names, private seed requirements, profile allowlist/rule patches, and dependency/configuration requests. Google sign-in with email-domain membership is required (ADR 0007); Apple sign-in is not.

## Integration slice — November 1

PR #4 core is merged. The follow-up [account integration contract](../../../contracts/accounts-integration.md) covers callable export/throttling, verified own-profile rules, Swift session/SDK adapter and CI discovery. Native onboarding screens and deployed project/App Check initialization remain open; this does not mark the whole packet complete.

## Domain-based OAuth — November 1

Per [ADR 0007](../../../adr/0007-oauth-domain-based-sign-in.md), `joinCompanyV1`, join codes, email/password and verification-email flows are removed. `resolveMembershipV1`, the private `companyDomains` lookup, OAuth display names, Google sign-in in `DIPAccounts`/`FirebaseAccountsRepository` and the Firebase attach points (`FirebaseBootstrap`, `ui/Config`) replace them. The redesigned onboarding screens follow in a separate PR.

## Profile data layer — November 2

`DIPAccounts` adds `ProfileEditor` (per-member draft of the allowlisted fields, normalization, local validation, save through `updateProfile(uid:_:)`, live updates that never overwrite unsaved edits), `InterestCatalog` over the new `InterestCatalogRepository` (`tags` reads) and the V1 `AvailabilityOption` ids. `updateProfile` now names the uid it writes and adapters refuse any other signed-in account. The Firebase, preview and unconfigured repositories implement both protocols. The Profile screen itself (connecting the PR #3 `DIPProfileScreen` and removing its display-name field) is still open.

## Completion — November 3

V1-01 and V1-02 are implemented and verified end to end against the real Firebase project:

- **Deployed:** `resolveMembershipV1` (us-central1, App Check enforced) and the Firestore rules (`firebase deploy --only functions,firestore:rules`). Container-image cleanup is set to 1 day.
- **Verified manually:** Google sign-in with a CMU Workspace account (`andrew.cmu.edu` coerced to `cmu.edu`) creates the member profile with the OAuth name and reaches member content; Profile shows and saves department, city, interests, job title, availability and travel radius; sign-out returns to the Google entry screen. Simulator and a physical iPhone (free Personal Team, Debug build, App Check debug provider).
- **Merged:** #4, #6, #9, #10, #11, #13, #16, #19, #20, #21 (accounts); #18 (integration: Profile connected to account data).

### Using accounts from other packets

- Signed-in screens receive `MembershipContext` (`uid`, `companyID`, `role`, full `profile`) from `AccountsRootView`'s member content. Scope all tenant queries by `companyID`.
- Roles are `member` and `admin` (`MembershipContext.role`). Treat the role as a UI hint only; authorization belongs in rules and callables.
- Fakes: `PreviewAccountsRepository` (Debug builds without Firebase files, previews, tests) and the fixture repositories in `DIPMockData`.

### Running against the real project

- Local, uncommitted: `ui/DIP/Support/GoogleService-Info.plist` and `ui/Config/Local.xcconfig` (`GOOGLE_REVERSED_CLIENT_ID`, optional `DEVELOPMENT_TEAM` for devices). See `ui/README.md`.
- Each Simulator or device needs its own App Check debug token (printed in the Xcode console) registered in Firebase → App Check → Manage debug tokens, before its first sign-in with a new account.
- Sign-in needs a `companyDomains/{rootDomain}` document with a string `companyId` naming an existing `companies` document. Type collection and document IDs by hand: a pasted trailing space created a look-alike `companyDomains ` collection once. Mapping misses are logged by the function ("companyDomains mapping not found" etc.).

### Open after V1 scope

- Remove the `cmu.edu` test mapping before real users; it maps that whole domain to the demo company.
- App Attest for Release builds needs a paid Apple Developer team and the entitlement noted in `FirebaseBootstrap`.
- Firestore reads are not App Check–enforced (only the callable is); revisit with the integrator.

