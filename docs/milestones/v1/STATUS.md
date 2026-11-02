# V1 work tracker

Last updated: November 2, 2026. This is the starting assignment board. Once a packet has a GitHub issue/PR, link it here and use that issue for detailed task discussion; do not maintain contradictory status copies. The packet README defines scope and acceptance, not completion.

| Work packet | Status | Human owner | Issue / branch / PR | Dependency and next action |
| --- | --- | --- | --- | --- |
| [01 UI foundations](01-ui-foundations/README.md) | In review | sandervonk | [PR #3](https://github.com/dip-app/app/pull/3) | Native prototype, observable mock boundary and four photo-comment pills verified; reconciling current OAuth main before merge. |
| [02 Accounts/profile](02-accounts-profile/README.md) | In progress | ariaf7 (core); sandervonk (integration) | PRs #4, #6, #9, #10 merged | Per ADR 0007: Google sign-in and email-domain membership (`resolveMembershipV1`), email/password and join codes removed, Google onboarding merged and connects to Home in PR #3. Real-project configuration, App Check, session hardening and device checks remain open. |
| [03 Events/participation](03-events-participation/README.md) | Ready against fixtures | Unassigned | None yet | Implement from event/RSVP contracts; live flow needs accounts plus reviewed rules/export integration. |
| [04 Organizer events](04-organizer-events/README.md) | Ready against fixtures | Unassigned | None yet | Confirm revision and retry contract; live flow needs admin membership plus reviewed rules/exports. |
| [05 Integration](05-integration/README.md) | Ready to claim | Unassigned | None yet | Name the integrator now; coordinate shared files and dependency order while feature owners work. |

## State and update rules

Use Ready to claim / Ready against fixtures / In progress / Blocked / In review / Done. A claim names the human owner, branch/worktree and issue; do not claim someone else's packet. Split a packet into smaller linked issues when needed. Shared-file ownership remains with the integrator even when two packets need changes there.

Before editing, update your row to In progress and name the owner/issue. When blocked, state the concrete missing dependency, responsible owner and next action in the issue and session handoff; continue independent work inside the packet. A PR enters In review with its session log and check evidence. Mark Done only after its acceptance criteria pass and the result is merged; setup fixtures, mock implementations and TODO tests do not count.

During parallel claims, preserve another contributor's row. Coordinate the small tracker edit or have the integrator record multiple claims in one change. Do not use the tracker as permission to overwrite a checkout. [V1 release criteria](../V1.md) and the integration packet govern release readiness.
