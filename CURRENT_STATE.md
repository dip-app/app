# Current development state

Last audited: October 29, 2026. This is a concise handoff, not a replacement for Git status, CI, scope documents or the task tracker. Update it when an integration changes shared boundaries or readiness; do not copy every session here.

## What exists

The setup is on main. `gcp/` has Firebase Functions scaffolding, deny-all rules/indexes, real emulator tests and a guarded synthetic seed. `ui/` has an XcodeGen bootstrap app plus independently tested contract and token packages. No product callable, repository adapter or feature screen is implemented. On feature/ui-foundations / PR #3, shared SwiftUI components and a development gallery exist. Native Home matches the original layout with identical mock content, bundled resources and custom navigation. The gallery remains optional; fresh Home visual comparison and simulator geometry/action checks are recorded under ui/ComponentPreview/Review. Native raster differences and manual accessibility review remain explicit. These fixtures do not implement data workflows. Shared schemas, V1 command semantics, design tokens/component specifications and the inspected Figma inventory are available for parallel work.

## Where to start

1. Check Git status and read the [context guide](docs/context/README.md).
2. Claim a work packet in the [V1 status tracker](docs/milestones/v1/STATUS.md); assign its human owner before starting. Use a separate branch/worktree.
3. Start a session log with `npm run session:new -- --user YOUR-USERNAME --workstream PACKET-ID`. Read the packet, relevant nested AGENTS.md and linked contracts before editing.
4. Work against fixtures while counterpart implementations are pending. Coordinate changes to contracts, tokens, rules, exports, project settings and lockfiles with the integrator.
5. Validate, complete the session handoff, update the tracker and open a PR against main.

## Decisions and external constraints

The V1 deadline is November 9; V2 is December 4. See [V1](docs/milestones/V1.md) and [V2](docs/milestones/V2.md); V2 stretch work stays separate. [ADRs 0001–0003](docs/adr/README.md) describe proposed cross-team decisions to confirm before dependent implementation. Session handoffs are an agreed workflow.

Named reviewers, Firebase projects/location and signing identity require human/team input. Home prototype assets are being bundled for fidelity review; their source does not establish third-party image redistribution rights. Font license notices accompany the Google Fonts resources. Release image rights still need confirmation. Local work against demo-dip and shared fixtures can proceed without those values. See [setup constraints](docs/setup-constraints.md) for owners, evidence and the point at which each decision is needed.

CI runs contract/seed checks, generated-file checks, documentation links, Functions builds, Swift package tests, emulator rules/seed tests and session-log validation. PRs require a new session log in their diff; pushes can update a current-session log. GitHub's current private-repository plan does not support main branch protection (API returned HTTP403), so CI failure is visible but cannot currently prevent a maintainer bypass. Do not claim protections are enforced.

## Verification boundaries

The published baseline passed all five CI jobs. This audit's final CI is recorded in its session/PR. Passing setup checks does not mean the V1 app is built: feature tests, measured product coverage, Firebase client initialization, full simulator/device flows, cloud deployments and the unimplemented V2 contracts are feature work. See the [readiness checklist](docs/repository-readiness.md) for setup evidence.
