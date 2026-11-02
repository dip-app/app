# 0007 — OAuth sign-in with email-domain company membership

Status: proposed
Date: 2026-11-01
Owners: sandervonk (maintainer, decision owner), ariaf7 (packet 02 accounts)

## Context

V1 accounts were specified as Firebase email/password sign-in plus a company join code (`joinCompanyV1`, PRs #4 and #6). The maintainer has decided that sign-in is OAuth-based and that a company is determined by the user's email domain. This removes password handling, email-verification screens and join-code distribution from the product, and `Company.emailDomain` already exists in the supplied model.

This reverses written statements that were never a product design commitment: "No Apple/Google sign-in or domain autojoin" (packet 02 README), "Apple/Google sign-in and domain-based automatic company joining … are not V1 commitments" (V1.md), "Auth SDK for V1 email/password; Apple/Google later" (data-ownership.md) and "Never … auto-join by unverified email domain" (callables.md). Tenant isolation, server-owned membership/roles and the callable/rules boundaries from ADRs 0002 and 0006 still apply.

## Decision

1. **Sign-in is OAuth through Firebase Auth.** V1 supports Sign in with Google. The app no longer offers email/password sign-up/sign-in, verification-email screens or join-code entry. Sign in with Apple is deferred: Apple "Hide My Email" relay addresses carry no company domain, and the provider would need its own mapping decision. An App Store submission that offers Google sign-in generally also requires Sign in with Apple; revisit before any App Store release.
2. **Company is resolved from the verified email domain, on the server only.** A new versioned callable (proposed name `joinCompanyByDomainV1`) derives everything from the Firebase ID token: it requires a signed-in user, `email_verified == true` and an allowed OAuth sign-in provider (`google.com`). The domain is the lowercase text after the final `@`. Matching is exact: no subdomain or wildcard matching. The client never supplies a domain, company, role or balance.
3. **Private domain lookup.** `companyDomains/{domain}` → `{ companyId }` is the authoritative mapping, written only by trusted seed/admin tooling and denied to all clients (like `companyAccess`). One domain maps to at most one company. `Company.emailDomain` stays descriptive metadata; the lookup decides. Consumer email domains (gmail.com, outlook.com, icloud.com, yahoo.com and similar) are never mapped; seed validation rejects them.
4. **Membership semantics are unchanged.** First resolution creates `users/{uid}` as `member` with balance 0 and the documented defaults; `displayName` defaults to the token's name (fallback: email local part) and remains user-editable via the profile allowlist. A same-company replay returns the stored membership without rewriting it. An account already in a different company fails with `failed-precondition` / `MEMBERSHIP_CONFLICT`. Admin roles stay manually assigned. Per-UID throttling from ADR 0006 applies.
5. **No match is an explicit state.** An unmapped domain returns `not-found` with reason `NO_COMPANY_FOR_DOMAIN` and grants nothing. The app shows a "your company isn't on DIP yet" screen with sign-out; no company content is reachable.
6. **The join-code path is retired from the product.** The app stops calling `joinCompanyV1`. Its source, `companyAccess` lookups and tests remain until a follow-up PR removes the export and data; a breaking wire change is not made to `joinCompanyV1` itself.

Alternatives considered: keep email/password + join codes (more screens, password and code-distribution work the team wants to avoid); OAuth with join codes (keeps code distribution); domain matching on the client (rejected: authorization must be server-side); Google Workspace `hd` claim only (rejected for V1: excludes non-Workspace company domains; may be added as an extra check later).

## Consequences

- **Security:** anyone who controls an address at a mapped domain joins that company. Mapping a domain is a trust decision for the company/seed owner; shared domains (e.g. a whole university) mean the whole domain is one tenant. Revoking access to a former employee depends on the identity provider disabling the account.
- **Contracts:** new request/response schemas and generated DTOs for the domain callable; callables.md, data-ownership.md, V1.md (V1-01 wording), packet 02 README and ADR 0006's email/password session wording must be updated by the implementing PRs, which reference this ADR.
- **iOS:** adds the GoogleSignIn Swift package (`ui/project.yml`, integrator-owned), URL scheme / client ID configuration, and OAuth methods in `DIPAccounts.AccountsRepository`/`AccountsSession`, replacing the email/password and verification methods. Onboarding becomes: Continue with Google → resolving company → member, or not-on-DIP. The onboarding screens from the open PR are reworked accordingly (routing, problem screen and styling carry over).
- **Configuration:** requires a real Firebase project with the Google provider enabled and an iOS OAuth client ID (see setup-constraints.md: cloud project and signing are still unassigned). Until then, backend tests use the Auth emulator's synthetic Google credentials; the native Google sign-in sheet cannot be exercised end to end.
- **Seed/migration:** the demo seed gains a `companyDomains/example.invalid` record for `company-demo` (synthetic). Existing `companyAccess` seeds remain until the join-code removal PR.

## Validation and references

Before acceptance of the implementation: emulator tests for unauthenticated, unverified-email, disallowed-provider (e.g. password) and unmapped/consumer-domain rejection; case normalization and exact matching (subdomain does not match); first join defaults; no-write replay; cross-company conflict; concurrent first resolution; throttling; rules denying all client access to `companyDomains`. iOS: session/route tests for the new states and previews; device check once a project exists.

Supersedes the email/password and join-code portions of V1-01 as written and the domain-autojoin exclusions quoted above. Related: [ADR 0002](0002-firebase-callable-contracts.md), [ADR 0006](0006-account-session-and-profile-access.md), [callables](../contracts/callables.md), [data ownership](../contracts/data-ownership.md), [packet 02](../milestones/v1/02-accounts-profile/README.md), session `SESSION_ariaf7_2026-11-01_004.md`.
