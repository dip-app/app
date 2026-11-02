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

- [ ] Unit-test signed-out, signing-in, resolving-company, no-company (personal domain, unmapped domain, conflict), member, loading, cancelled sign-in and recoverable-error state transitions; never mark a failed resolution as joined.
- [ ] Test Google sign-in/sign-out and reloading persisted membership against emulators (synthetic Google credentials). Reject non-Google providers and unverified emails under the callable contract.
- [ ] Test root-domain coercion, personal-domain refusal, unmapped domains without company-data leakage, existing same-company replay with OAuth display-name refresh, and rejection of conflicting membership. Verify resolution never promotes role or grants points.
- [ ] Test own-profile allowed-field edits and persisted interest selection. Attempted changes to companyId, role, email, displayName, balance, or createdAt must fail under the implemented rules.
- [ ] Add rule tests for signed-out access, self versus other private profiles, company isolation, and forbidden direct membership/domain-lookup writes. Submit the smallest rule change to the integrator.
- [ ] Ensure sign-out clears tenant-dependent state/listeners; another account cannot reuse the previous account's rendered private content.
- [ ] Run contract checks, relevant backend tests, UI/domain tests, and emulator tests after wiring; report exact commands and results. Pending/mock tests do not establish end-to-end completion.

## Handoff

Provide discovery and organizer owners an authenticated membership-context protocol, readiness/error states, and a fake implementation. Confirm the role vocabulary (`member`/`admin`) without leaking authorization decisions into UI-only checks. Give the integrator function export names, private seed requirements, profile allowlist/rule patches, and dependency/configuration requests. Google sign-in with email-domain membership is required (ADR 0007); Apple sign-in is not.

## Integration slice — November 1

PR #4 core is merged. The follow-up [account integration contract](../../../contracts/accounts-integration.md) covers callable export/throttling, verified own-profile rules, Swift session/SDK adapter and CI discovery. Native onboarding screens and deployed project/App Check initialization remain open; this does not mark the whole packet complete.

## Domain-based OAuth — November 1

Per [ADR 0007](../../../adr/0007-oauth-domain-based-sign-in.md), `joinCompanyV1`, join codes, email/password and verification-email flows are removed. `resolveMembershipV1`, the private `companyDomains` lookup, OAuth display names, Google sign-in in `DIPAccounts`/`FirebaseAccountsRepository` and the Firebase attach points (`FirebaseBootstrap`, `ui/Config`) replace them. The redesigned onboarding screens follow in a separate PR.
