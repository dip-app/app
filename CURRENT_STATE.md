# Current development state

Last audited: November 1, 2026. Read Git/CI and the work tracker alongside this handoff.

PR #4's reviewed company-membership core is merged. This integration branch exports joinCompanyV1 with production App Check and transactional per-UID throttling, adds narrow verified self-profile/company/tag rules, and provides DIPAccounts plus a compiled Firebase Auth/Firestore/Functions adapter. It has not deployed cloud resources or configured a real Firebase project. Other product callables and data paths remain unimplemented/denied.

The app bootstrap on this branch is still a placeholder. Approved native onboarding views must connect to AccountsSession. The separate [UI PR #3](https://github.com/dip-app/app/pull/3) contains the matching prototype, observed mock repository, motion and human-defined photo bubbles; this account MR does not depend on or replace that unmerged branch.

[Account integration](docs/contracts/accounts-integration.md) defines read/write ownership, profile limits, lifecycle behavior, App Check prerequisites and repeatable tests. [ADR0006](docs/adr/0006-account-session-and-profile-access.md) is proposed for review. Existing schemas/generated DTOs are unchanged. The private project plan still does not enforce main branch protection; green CI is evidence, not a guarantee of protection.

Claim work in [V1 tracker](docs/milestones/v1/STATUS.md), read the relevant packet/nested AGENTS.md, and start a SESSION log. Event/RSVP/organizer owners can consume MembershipContext; only its observed member state carries tenant scope. Next integration work is approved onboarding views, configured Firebase/App Check startup, tenant-scoped event repositories, and physical-device verification. Do not mark all V1 accounts or coverage complete from backend/SDK tests alone.
