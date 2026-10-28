# 02 — Accounts and profile

**Area:** Accounts. **Owner:** assign one human in the issue. Covers V1-01 and V1-02 from [V1](../../V1.md).

## Pasteable agent brief

> Implement the V1 accounts/profile packet in `docs/milestones/v1/02-accounts-profile/README.md`. Read root/folder `AGENTS.md`, root `SESSION.md`, `docs/contracts/callables.md`, and `docs/contracts/data-ownership.md`. Work only in owned paths in a separate branch/worktree. Implement email/password Auth, code-based company membership using joinCompanyV1, and allowlisted own-profile editing. Keep UI, domain protocols, Firebase adapters, and function modules separated. Do not open shared rules or edit exports/configuration yourself; hand those requests to the integrator. Log each work session under `docs/sessions/` using `SESSION.md`; a session may have multiple commits. Report tests, contract decisions, and membership handoffs.

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

Use [callables](../../../contracts/callables.md) for `joinCompanyV1` and its schema/error/retry behavior, and [ownership](../../../contracts/data-ownership.md) for profile fields, company projection, and private code lookup. Company and organizer seed data are manually maintained in V1. Email verification is part of the proposed membership contract; test it rather than bypassing it. Real Firebase project/signing configuration remains an integrator dependency. UI can initially use synthetic fixtures.

## Acceptance tests

- [ ] Unit-test signed-out, signing-in, verification-required, no-membership, member, loading, and recoverable-error state transitions; never mark a failed join as joined.
- [ ] Test email/password registration/sign-in/sign-out and reloading persisted membership against emulators. Reject unverified membership requests under the callable contract.
- [ ] Test code normalization, invalid code without company-data leakage, existing same-company membership replay, and rejection of conflicting membership. Verify a join never promotes role or grants points.
- [ ] Test own-profile allowed-field edits and persisted interest selection. Attempted changes to companyId, role, email, balance, or createdAt must fail under the implemented rules.
- [ ] Add rule tests for signed-out access, self versus other private profiles, company isolation, and forbidden direct membership/code-lookup writes. Submit the smallest rule change to the integrator.
- [ ] Ensure sign-out clears tenant-dependent state/listeners; another account cannot reuse the previous account's rendered private content.
- [ ] Run contract checks, relevant backend tests, UI/domain tests, and emulator tests after wiring; report exact commands and results. Pending/mock tests do not establish end-to-end completion.

## Handoff

Provide discovery and organizer owners an authenticated membership-context protocol, readiness/error states, and a fake implementation. Confirm the role vocabulary (`member`/`admin`) without leaking authorization decisions into UI-only checks. Give the integrator function export names, private seed requirements, profile allowlist/rule patches, and dependency/configuration requests. No Apple/Google sign-in or domain autojoin is required by this packet.
