# V1 work tracker

Last updated: November 3, 2026. This is the starting assignment board. Once a packet has a GitHub issue/PR, link it here and use that issue for detailed task discussion; do not maintain contradictory status copies. The packet README defines scope and acceptance, not completion.

| Work packet | Status | Human owner | Issue / branch / PR | Dependency and next action |
| --- | --- | --- | --- | --- |
| [01 UI foundations](01-ui-foundations/README.md) | In review | sandervonk | [PR #18](https://github.com/dip-app/app/pull/18); #3 merged | Native prototype and repository boundary merged. Profile/social completion and reviewed captures are in PR #18; comment placement redesign is deferred. |
| [02 Accounts/profile](02-accounts-profile/README.md) | Done | ariaf7 (core); sandervonk (integration) | PRs #4, #6, #9, #10, #11, #13, #16, #18, #19, #20, #21 merged | V1-01/V1-02 verified end to end on the real project (Simulator and iPhone). `resolveMembershipV1` and rules deployed. See the packet README "Completion — November 3" for how other packets use `MembershipContext`, device/App Check setup and remaining follow-ups (remove the `cmu.edu` test mapping; App Attest needs a paid team). |
| [03 Events/participation](03-events-participation/README.md) | In progress | OmerGursoy04 (RSVP backend slice); sandervonk (frontend handoff) | `feature/omergursoy04-rsvp`; isolated checkout `app-omer-rsvp`; PR #25 merged frontend | RSVP backend slice implemented/tested locally; review and integration pending. Frontend remains fixture-backed. Shared rules/exports need an integrator; event-time synchronization needs organizer agreement before release. |
| [04 Organizer events](04-organizer-events/README.md) | Ready against fixtures | Unassigned | None yet | Confirm revision and retry contract; live flow needs admin membership plus reviewed rules/exports. |
| [05 Integration](05-integration/README.md) | Ready to claim | Unassigned | None yet | Name the integrator now; coordinate shared files and dependency order while feature owners work. |

## State and update rules

Use Ready to claim / Ready against fixtures / In progress / Blocked / In review / Done. A claim names the human owner, branch/worktree and issue; do not claim someone else's packet. Split a packet into smaller linked issues when needed. Shared-file ownership remains with the integrator even when two packets need changes there.

Before editing, update your row to In progress and name the owner/issue. When blocked, state the concrete missing dependency, responsible owner and next action in the issue and session handoff; continue independent work inside the packet. A PR enters In review with its session log and check evidence. Mark Done only after its acceptance criteria pass and the result is merged; setup fixtures, mock implementations and TODO tests do not count.

During parallel claims, preserve another contributor's row. Coordinate the small tracker edit or have the integrator record multiple claims in one change. Do not use the tracker as permission to overwrite a checkout. [V1 release criteria](../V1.md) and the integration packet govern release readiness.
