# Current development state

Last audited: October 29, 2026. This is a concise handoff, not a replacement for Git status, CI, scope documents or the task tracker. Update it when an integration changes shared boundaries or readiness; do not copy every session here.

## What exists

The setup is on main. gcp/ has Firebase Functions scaffolding, deny-all rules/indexes, real emulator tests and a guarded synthetic seed. No product callable, Firebase repository adapter, authentication or production data workflow is implemented.

On feature/ui-foundations / PR #3, DIPPrototypeApp connects native Home, Puppy Yoga Event Details/Joined, My Events/Memory grid, Profile, Participants and Album. Original Figma resources/fonts and the optional state/API gallery are bundled. The current refactor puts read data and commands behind DIPRepository, observed through DIPAppViewModel; DIPMockRepository owns the matching synthetic content and process-lifetime mutations. Feature screens receive model values and callbacks, and media resolve through DIPMedia. Other event detail data is synthetic in the same visual template; memory destinations use stable event/album IDs with reference album content. Rewards, notifications and challenge workflows remain explicit notices.

The pre-motion revision passed expanded screenshot comparisons, font/resource checks and eight simulator tests; nonzero raster differences remain documented under ui/ComponentPreview/Review/Screens. All five CI jobs passed at afa1470, before the current motion correction.

The latest human direction prioritizes motion over new pages. DIPPrototypeApp now owns one persistent bottom component outside page transitions; marker/icon/action states animate in place. Observed repository snapshots coordinate in-page and bottom Join actions; a root picker request opens the album picker. DIPSlidingPages caches tab hosts and uses native horizontal page transitions without an outer pan gesture; Active/Memory marker/content also slide, with a Reduced Motion fade path. Before the data-boundary refactor, the motion revision passed a full app build and nine simulator UI tests. Navigation, section and page clips are recorded under ui/ComponentPreview/Review/Motion; the adapter integration passed nine base UI tests, followed by seven final conversation/motion/connected-flow regressions and a full app build. See [motion architecture](docs/design/motion.md). The photo discussion overlay now supports comments and native keyboard handling; the Past Event detail page remains deferred.

A verified build with native chat, photo comments, repository-backed state and opaque bottom-button press feedback is installed on the review simulator. Tests use a separate simulator so review is not interrupted. Manual accessibility and physical-device review remain open. Shared schemas and command semantics remain available for production feature work. The [UI repository contract](docs/contracts/ui-repositories.md) and [ADR 0005](docs/adr/0005-observable-ui-repositories.md) define the swappable data boundary; the mock does not implement Firebase authorization, persistence or synchronization.

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

Activity chat and photo comments were flagged unfinished, then [unflagged for the mock-backed frontend](docs/milestones/v2/FEATURE_STATUS.md) after send/retry/reopen/isolation simulator tests passed. Their Firebase adapters, authorization and cloud persistence remain unimplemented.

November1: photo comments now follow the human-defined four compact edge pills with centered expansion/scrolling; the earlier thread panel is removed and the corrected UI tests pass. PR#4 accounts core was independently reviewed and merged. Its live integration is being developed separately from this UI branch.
