# Architecture decision records

Use an ADR when choosing or changing cross-part contracts, data ownership, persistence layout, security policy, shared UI APIs, or build/deploy boundaries. Small local implementation choices do not need ADRs.

Copy TEMPLATE.md into NNNN-short-title.md. Assign the next number after checking open PRs; when parallel branches collide the integrator renumbers before merge. Status is proposed, accepted, superseded or rejected. Human maintainers accept cross-team decisions during review. Link affected contracts, feature workstreams, session log and the superseding record when relevant. Update an existing accepted decision only for clarification; a new decision supersedes it.

Initial decisions:

- 0001-monorepo-boundaries.md — folder ownership and independent build boundaries.
- 0002-firebase-callable-contracts.md — privileged commands, tenant checks and DTO generation.
- 0003-design-system-foundations.md — tokens, component contracts and Figma provenance.
- 0004-session-handoffs.md — one session log per work session and PR-level gate (user-requested process).

- 0005-observable-ui-repositories.md — injected mock/backend adapters and observed UI state (proposed).

The architecture overview in ../architecture.md is a navigation summary. These records carry decision status and tradeoffs.

- 0006-account-session-and-profile-access.md — V1 callable throttling, observed Swift sessions and narrow profile rules (proposed). Number 0005 is reserved by the UI repository-boundary PR.
- 0007-oauth-domain-based-sign-in.md — Google-only OAuth sign-in, server-side company membership from the root email domain, personal domains blocked, OAuth display names, email/password and join codes removed (accepted).
