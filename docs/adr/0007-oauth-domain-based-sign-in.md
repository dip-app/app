# 0007 — OAuth sign-in with email-domain company membership

Status: accepted (maintainer sandervonk confirmed the decisions below on 2026-11-01)
Date: 2026-11-01
Owners: sandervonk (maintainer, decision owner), ariaf7 (packet 02 accounts)

## Context

V1 accounts were first built as Firebase email/password sign-in plus a company join code (`joinCompanyV1`, PRs #4 and #6). The maintainer decided that sign-in is OAuth-based and a user's company is determined by their email domain. This removes password handling, verification-email screens and join-code distribution, and `Company.emailDomain` already exists in the supplied model.

Earlier text excluded this ("No Apple/Google sign-in or domain autojoin" in the packet 02 README, "not V1 commitments" in V1.md, "Auth SDK for V1 email/password" in data-ownership.md, "never … auto-join by unverified email domain" in callables.md). Those were planning notes, not a product design; this record replaces them. Tenant isolation, server-owned membership/roles and the callable/rules boundaries of ADRs 0002 and 0006 still apply.

## Decision

1. **Google sign-in only for V1**, through Firebase Auth. Email/password sign-up/sign-in, verification-email screens and join-code entry are removed from the product. Sign in with Apple is out of V1 (its relay addresses carry no company domain; App Store rules generally require it alongside Google before an App Store release, so revisit then).
2. **Company comes from the verified email domain, on the server only.** The callable `resolveMembershipV1` (request `{ contractVersion: 1 }`, response `{ contractVersion, companyId, role }`) reads everything from the Firebase ID token. It requires a signed-in user, `email_verified == true` and sign-in provider `google.com`. The client never sends a domain, company, role, name or balance.
3. **Subdomains are coerced to their root domain.** The email domain is lowercased and reduced to its registrable root using the Public Suffix List (`eng.acme.com` → `acme.com`; `team.acme.co.uk` → `acme.co.uk`). Matching is exact on that root.
4. **Personal email domains are blocked.** A server-side list of consumer providers (gmail.com, googlemail.com, outlook.com, hotmail.com, live.com, yahoo.com, icloud.com, me.com, aol.com, proton.me and similar) is rejected with `permission-denied` / `PERSONAL_EMAIL_DOMAIN` before any lookup. Such domains can never be mapped.
5. **Private domain lookup.** `companyDomains/{rootDomain}` → `{ companyId }` is the authoritative mapping, written only by trusted seed/admin tooling and denied to every client. Keys must already be root domains and must not be personal domains. `Company.emailDomain` is descriptive metadata.
6. **No match is an explicit state:** `not-found` / `NO_COMPANY_FOR_DOMAIN`; nothing is granted and the app shows "your company isn't on DIP yet" with sign-out.
7. **Membership semantics are unchanged:** first resolution creates `users/{uid}` as `member`, balance 0, documented defaults; an existing same-company member is returned; a member of a different company gets `failed-precondition` / `MEMBERSHIP_CONFLICT`; admins are assigned manually; the per-UID fixed-window budget from ADR 0006 applies.
8. **Display name comes from OAuth and is not user-editable.** It is the token's `name` (fallback: email local part, trimmed to 80 characters), written by the server on creation and refreshed when it changes on later resolutions. `displayName` leaves the client-editable profile allowlist and its rule.
9. **Email/password infrastructure is removed:** `joinCompanyV1` and its module code/tests/export, `companyAccess` lookups and seed records, the `JoinCompanyRequest`/`JoinCompanyResponse` schemas, and the Swift email/password, verification and join-code APIs. The email/password provider should be disabled in the Firebase console by its owner.
10. **Firebase configuration attaches later with minimal change.** The real project exists but is not yet configured for iOS. The app activates Firebase and Google sign-in only when a local, uncommitted `GoogleService-Info.plist` and the matching URL-scheme setting are present; otherwise it runs the preview repository in Debug and shows a "not configured" state. Adding those two local items must be the only step.

Alternatives considered: keep email/password + join codes (rejected by the maintainer as unnecessary work); OAuth plus join codes (keeps code distribution); client-side domain matching (rejected: authorization is server-side); Google Workspace `hd` claim only (excludes non-Workspace company domains; may be added as an extra check later).

## Consequences

- **Security:** anyone controlling an address at a mapped root domain joins that company, including every subdomain. Mapping a domain is a trust decision for the seed/admin owner. Revoking a former employee depends on the identity provider disabling the account.
- **Breaking contract change:** the V1 join schemas are removed rather than versioned because `joinCompanyV1` was never deployed or used by a released client.
- **Backend dependency:** root-domain coercion uses the `tldts` Public Suffix List library in the Functions workspace.
- **iOS:** adds the GoogleSignIn Swift package, a URL scheme supplied from an untracked config value, and Google/`resolveMembership` methods in `DIPAccounts`, replacing email/password methods. Onboarding becomes Continue with Google → finishing → member, or not-on-DIP / personal-account states; the earlier email/password screens are redesigned to match the app.
- **Configuration:** the project owner enables the Google provider, registers the iOS app and shares the `GoogleService-Info.plist` locally. Tests keep using the `demo-dip` emulators with the Auth emulator's synthetic Google credentials; nothing seeds or deploys to the real project from tests.
- **Seed:** the demo seed maps `example.invalid` → `company-demo` in `companyDomains` and drops the join code.

## Validation and references

Required tests: unauthenticated, unverified-email, non-Google provider and personal-domain rejection; root coercion (subdomains, multi-part suffixes, case); unmapped domain; first-join defaults with OAuth display name; replay and display-name refresh; cross-company conflict; concurrent first resolution; throttling; rules denying clients `companyDomains` and `displayName` writes. iOS: session and routing tests for the new states, previews, an audited onboarding design, and a device check once the project is configured.

Related: [ADR 0002](0002-firebase-callable-contracts.md), [ADR 0006](0006-account-session-and-profile-access.md), [callables](../contracts/callables.md), [data ownership](../contracts/data-ownership.md), [packet 02](../milestones/v1/02-accounts-profile/README.md), session `SESSION_ariaf7_2026-11-01_004.md`.
