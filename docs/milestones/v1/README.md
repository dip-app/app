# V1 teammate work packets

These packets turn the committed [V1 scope](../V1.md) into bounded implementation sessions. They are instructions for future feature work, not claims that the setup branch contains the features. The deadline remains **November 9, 2026**. Read root `AGENTS.md` and `SESSION.md` first, then the relevant nested instructions.

| Packet | Responsibility area | Human owner | Main handoff |
| --- | --- | --- | --- |
| [01 — UI foundations](01-ui-foundations/README.md) | Frontend | Assign in issue | Presentation components and feature-shell integration notes |
| [02 — Accounts and profile](02-accounts-profile/README.md) | Accounts | Assign in issue | Authenticated membership context and profile repositories |
| [03 — Events and participation](03-events-participation/README.md) | Discovery and participation | Assign in issue | Feed/details, RSVP, My Events, share-sheet flow |
| [04 — Organizer events](04-organizer-events/README.md) | Organizer features | Assign in issue | Validated event creation/editing and conflict handling |
| [05 — Integration](05-integration/README.md) | Integration/release coordinator | Assign in issue | Shared configuration, rule changes, CI and release evidence |

## Start in parallel without inventing interfaces

Claim and update the [status tracker](STATUS.md), assigning one person to each packet and one integrator for shared files. UI foundations can proceed against presentation fixtures. Accounts, discovery, and organizer work can proceed against the versioned contract fixtures after both provider and consumer owners agree on their interfaces. Live end-to-end integration depends on accounts/membership and the integrator's reviewed Firebase access rules.

The canonical boundaries are [callables](../../contracts/callables.md), [data ownership](../../contracts/data-ownership.md), `contracts/v1/models.schema.json`, and [component specifications](../../design/components.md). Future commands must preserve these schemas and semantics, or propose a reviewed contract change first. No packet may silently expand V1 to match later prototype content.

Each owner uses a separate branch and worktree. Own only the paths named by the packet. Root configuration, callable exports in `gcp/functions/src/index.ts`, `ui/project.yml`, lockfiles, rules/indexes, schemas/generated files, shared tokens, and app composition require coordination with the integration owner. Feature owners provide the smallest necessary patch or written request; the integrator owns the shared edit.

## Session logs and handoffs

Follow root `SESSION.md`. Create one new valid log under `docs/sessions/` for each work session, using its naming convention and required fields. A session can contain multiple commits; do not generate a log per commit. Keep that session log current with decisions, changes, tests, and handoffs. CI requires at least one new valid session log per PR; continue recording additional sessions when the PR spans them.

Before handing work over, list changed paths, exact checks/results, interfaces provided, pending dependencies, and unresolved decisions. Report mocks, TODO tests, and unrun checks explicitly. Include the relevant session log in the PR. The integrator's review does not replace the feature owner's tests.
