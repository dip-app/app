# Contributing

Read [AGENTS.md](AGENTS.md), [SESSION.md](SESSION.md), the [README](README.md), the relevant [V1](docs/milestones/V1.md) or [V2](docs/milestones/V2.md) feature, and the [contracts](contracts/README.md) before changing behavior. This branch establishes development foundations; it does not claim the listed product features are implemented.

## Start a change

1. Claim or create one bounded issue with a human owner, milestone, acceptance criteria, affected folders, and dependencies. Start from the [V1 work packets](docs/milestones/v1/README.md) or [V2 planning handoff](docs/milestones/v2/README.md). Names in the responsibility matrix are areas, not assigned people.
2. Use a contributor/feature branch and a separate checkout or Git worktree. Coordinate shared-file edits before beginning. See [agent workflow](docs/agent-workflow.md).
3. Resolve interface questions in the contracts before each side invents its own payloads. Develop consumers against the shared fixtures while providers are implemented.
4. Keep changes small enough to review and integrate together. Preserve unrelated edits in any shared workspace.

## Review boundaries

| Change | Required review perspective |
| --- | --- |
| Callable schema, Firestore shape, status, error, or retry behavior | Backend and iOS owners together |
| Semantic tokens or shared component API | Design-system owner and consuming frontend owner together |
| Authorization, membership, roles, rules, ledger, or counters | Backend/security owner plus affected feature owner |
| Milestone scope | Team release owner; preserve committed versus stretch distinctions |

Named owners and GitHub teams are TBD. These are team process expectations until maintainers configure enforceable GitHub review and branch-protection rules; files alone do not enforce them.

## Before opening a pull request

- Regenerate contracts/tokens from their canonical sources when changed; include generated outputs and fixtures in the same change. Do not hand-edit generated files.
- Run the relevant checks documented in README. Add meaningful tests for new logic and permissions; state what was not run and why.
- Add emulator tests when opening Firebase access or adding server workflows. Include unauthenticated, cross-company, and unauthorized-role cases where relevant.
- Use design-system semantics and shared component APIs; inspect the relevant Figma reference before implementing UI. Avoid one-off visual overrides without a documented reason.
- Keep service credentials, local Firebase configuration, signing files, and real user data out of commits. Use synthetic test fixtures.
- Explain migrations, compatibility, manual checks, and unresolved decisions. Do not report a mocked success path as completed end-to-end behavior.
- Follow `SESSION.md` and add one valid `docs/sessions/` log per work session. A session may include multiple commits. CI requires at least one new valid session log per PR, not one per commit; keep additional sessions represented when work continues.

## Repository boundaries

`ui/` contains the SwiftUI app and local packages; `gcp/` contains Firebase functions, tests, rules, and indexes. `contracts/` contains canonical schemas and fixtures. Interface behavior is specified in [callables](docs/contracts/callables.md) and [data ownership](docs/contracts/data-ownership.md). Semantic token source is `ui/DesignSystem/tokens.json`; component APIs and Figma references are in [component specifications](docs/design/components.md).

Use the assigned packet's feature paths under `ui/DIP/Features/`, `ui/DIP/Domain/`, and `ui/DIP/Data/`, and its server module under `gcp/functions/src/modules/`. The integration owner coordinates shared exports, rules/indexes, project/manifests, lockfiles, CI, and app composition. Do not edit another workstream's owned paths without agreement.

## Integration and release

Open a pull request against the team's integration branch and use the provided template. Reviewers should be able to understand the final change without reading a chat transcript. Resolve CI failures before merging. Deployment requires the configured project, credentials, and release workflow; running local tests does not authorize deploying changes.

V1 targets at least 70% unit test coverage of key logic; V2 requires greater than 90%. Report the measured denominator and exclusions. Empty scaffolds and generated models cannot establish those feature-coverage goals. Each developer tests their features; the team shares integration, review, another-laptop build verification, and physical-device checks.
