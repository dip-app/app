# 0006 — Account sessions and narrow profile access

Status: proposed; superseded in part by [ADR 0007](0007-oauth-domain-based-sign-in.md) (joinCompanyV1, join codes, email/password and displayName editing replaced by Google sign-in, resolveMembershipV1 and OAuth display names)
Date: 2026-11-01

## Context

PR #4 supplies a reviewed, unexported membership core. V1 needs an authenticated company scope shared by the next event/profile workstreams. The integration must expose the callable without opening client membership writes or leaking private profiles/join codes. No new onboarding design is defined in this slice.

## Decision

Export joinCompanyV1 with production App Check and a transactional five-attempt fixed-minute budget per verified UID. Use only local demo emulators for tests. Keep companyAccess and accountRateLimits private. Open only verified own-user get/update, own-company public get excluding legacy joinCode documents, and verified shared-tag reads. Keep all unrelated paths denied.

Validate the editable-profile allowlist, immutable ownership fields and bounded types in rules and Swift. Bound the two string lists at 10, because validating 20 positions in both exceeded the Firestore expression budget in the emulator. Existing generated DTOs remain unchanged; document persistence constraints explicitly.

Publish identity/profile observations through DIPAccounts.AccountsRepository and a lifecycle-safe AccountsSession. SDK mappings/listener ownership remain in the app's Firebase adapter. Membership is observed state, not the callable acknowledgement. Clear old tenant state on identity/lifecycle changes and fail closed on malformed profiles or terminated observations.

## Consequences

The callable is deployable source but has not been deployed. UI auth/onboarding wiring, real project/signing/App Check configuration and physical-device verification remain separate. The fixed-window limiter allows boundary bursts and is not a global/IP abuse policy. The 10-item list policy is a visible restriction requiring an explicit reviewed change if product needs more choices.

See [integration contract](../contracts/accounts-integration.md), [packet 02](../milestones/v1/02-accounts-profile/README.md) and [session 005](../sessions/SESSION_sandervonk_2026-11-01_005.md). The human maintainer accepts this cross-team decision during MR review.
