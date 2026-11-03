# V1 work tracker

Last updated: November 3, 2026. This is the starting assignment board. Once a packet has a GitHub issue/PR, link it here and use that issue for detailed task discussion; do not maintain contradictory status copies. The packet README defines scope and acceptance, not completion.

| Work packet | Status | Human owner | Issue / branch / PR | Dependency and next action |
| --- | --- | --- | --- | --- |
| [01 UI foundations](01-ui-foundations/README.md) | In review | sandervonk | [PR #18](https://github.com/dip-app/app/pull/18); #3 merged | Native prototype and repository boundary merged. Profile/social completion and reviewed captures are in PR #18; comment placement redesign is deferred. |
| [02 Accounts/profile](02-accounts-profile/README.md) | In progress | ariaf7 (core); sandervonk (integration) | PRs #4, #6, #9, #10, #11, #13 merged; [#18](https://github.com/dip-app/app/pull/18) in review | Per ADR 0007: Google sign-in and email-domain membership (`resolveMembershipV1`), email/password and join codes removed, Google onboarding merged and connects to Home in PR #3. Profile/catalog/sign-out wiring and component polish are on `feature/profile-social-polish` (PR #18); App Check and account data layers are merged. Real-project configuration, session hardening and device checks remain open. |
| [03 Events/participation](03-events-participation/README.md) | In progress | sandervonk | [PR #12](https://github.com/dip-app/app/pull/12) merged | Past-event detail and memory navigation are fixture-backed; implement from event/RSVP contracts; live flow needs accounts plus reviewed rules/export integration. |
| [04 Organizer events](04-organizer-events/README.md) | Ready against fixtures | Unassigned | None yet | Confirm revision and retry contract; live flow needs admin membership plus reviewed rules/exports. |
| [05 Integration](05-integration/README.md) | Ready to claim | Unassigned | None yet | Name the integrator now; coordinate shared files and dependency order while feature owners work. |

## State and update rules

Use Ready to claim / Ready against fixtures / In progress / Blocked / In review / Done. A claim names the human owner, branch/worktree and issue; do not claim someone else's packet. Split a packet into smaller linked issues when needed. Shared-file ownership remains with the integrator even when two packets need changes there.

Before editing, update your row to In progress and name the owner/issue. When blocked, state the concrete missing dependency, responsible owner and next action in the issue and session handoff; continue independent work inside the packet. A PR enters In review with its session log and check evidence. Mark Done only after its acceptance criteria pass and the result is merged; setup fixtures, mock implementations and TODO tests do not count.

During parallel claims, preserve another contributor's row. Coordinate the small tracker edit or have the integrator record multiple claims in one change. Do not use the tracker as permission to overwrite a checkout. [V1 release criteria](../V1.md) and the integration packet govern release readiness.
