# Current development state

Last audited: October 29, 2026. This is a concise handoff, not a replacement for Git status, CI, scope documents or the task tracker. Update it when an integration changes shared boundaries or readiness; do not copy every session here.

## What exists

The setup is on main. gcp/ has Firebase Functions scaffolding, deny-all rules/indexes, real emulator tests and a guarded synthetic seed. No product callable, repository adapter, authentication or production data workflow is implemented.

On feature/ui-foundations / PR #3, DIPPrototypeApp connects native Home, Puppy Yoga Event Details/Joined, My Events/Memory grid, Profile, Participants and Album. Original Figma resources/fonts and the optional state/API gallery are bundled. Join state survives navigation locally; Profile edits, chat messages and photo imports/viewing/sharing are local presentation interactions. Other event detail data is synthetic in the same visual template, and all memory entries open the reference album. Rewards, notifications and challenge workflows remain explicit notices.

Expanded screenshot comparison, font/resource validation and all eight simulator tests have passed; measured nonzero raster differences are documented. Prior Home evidence is under ui/ComponentPreview/Review; new states belong under Review/Screens. Do not infer current expanded verification from old Home checks. Manual accessibility and device review remain open. Shared schemas and command semantics remain available for production feature work.

## Where to start

1. Check Git status and read the [context guide](docs/context/README.md).
2. Claim a work packet in the [V1 status tracker](docs/milestones/v1/STATUS.md); assign its human owner before starting. Use a separate branch/worktree.
3. Start a session log with `npm run session:new -- --user YOUR-USERNAME --workstream PACKET-ID`. Read the packet, relevant nested AGENTS.md and linked contracts before editing.
4. Work against fixtures while counterpart implementations are pending. Coordinate changes to contracts, tokens, rules, exports, project settings and lockfiles with the integrator.
5. Validate, complete the session handoff, update the tracker and open a PR against main.

## Decisions and external constraints

The V1 deadline is November 9; V2 is December 4. See [V1](docs/milestones/V1.md) and [V2](docs/milestones/V2.md); V2 stretch work stays separate. [ADRs 0001–0003](docs/adr/README.md) describe proposed cross-team decisions to confirm before dependent implementation. Session handoffs are an agreed workflow.

Named reviewers, Firebase projects/location and signing identity require human/team input. Prototype assets are bundled for fidelity review; their source does not establish third-party image redistribution rights. OFL notices accompany Google Fonts Figtree/Fjalla One and upstream Inter 3.19 resources. Release image rights still need confirmation. Local work against demo-dip and shared fixtures can proceed without those values. See [setup constraints](docs/setup-constraints.md) for owners, evidence and the point at which each decision is needed.

CI runs contract/seed checks, generated-file checks, documentation links, Functions builds, Swift package tests, emulator rules/seed tests and session-log validation. PRs require a new session log in their diff; pushes can update a current-session log. GitHub's current private-repository plan does not support main branch protection (API returned HTTP403), so CI failure is visible but cannot currently prevent a maintainer bypass. Do not claim protections are enforced.

## Verification boundaries

The published baseline passed all five CI jobs. This audit's final CI is recorded in its session/PR. Passing setup checks does not mean the V1 app is built: feature tests, measured product coverage, Firebase client initialization, full simulator/device flows, cloud deployments and the unimplemented V2 contracts are feature work. See the [readiness checklist](docs/repository-readiness.md) for setup evidence.
