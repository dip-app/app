# DIP app

Shared repository setup for a company-based coworker events app: native SwiftUI + Firebase/GCP. The account integration adds a tested company-membership callable, narrow profile rules and a Swift session/adapter foundation. The native prototype and shared component library are integrated; the account entry gate and live tenant event adapters remain integration work. Source context: Sprint 3 submission, October 25, 2026; Figma Home node 35:147 inspected through MCP on October 28. V1 due November 9; V2 due December 4.

## Layout

```text
ui/                         Swift bootstrap, feature boundaries and local packages
  DesignSystem/             canonical semantic tokens
  Packages/DIPAccounts/     account state/repository foundation and lifecycle tests
  Packages/DIPContracts/    generated DTOs and shared-fixture tests
  Packages/DIPDesignSystem/ generated tokens and foundation tests
gcp/                        Functions, rules, indexes, emulators and sample data
contracts/                  canonical schemas, fixtures and boundary tests
docs/contracts/             endpoint semantics and data ownership
docs/design/                component specs and Figma inventory
docs/milestones/            V1/V2 scope, status tracker and executable work packets
docs/context/               context-loading map and agent task brief
docs/adr/                   proposed/accepted architecture decisions
docs/sessions/              one handoff log per work session
scripts/                    generation, documentation and session checks
.github/                    CI and issue/PR templates
```

## Start locally

Use Node 24.12+ (`nvm install && nvm use`), npm, Python 3, JDK21+ for Firebase emulators, Xcode supporting Swift6/iOS17, and XcodeGen (`brew install xcodegen`). No live Firebase account is needed for baseline tests. Package install uses the committed npm lockfile. Never paste cloud secrets into the repository.

```sh
npm ci
npm run check
npm run test:rules
npm run test:swift
npm run ios:generate
```

Open `ui/DIP.xcodeproj`, choose DIP. It's a development placeholder until feature work lands. Firebase SDK products are declared; SDK initialization and environment wiring are deliberately part of Accounts integration. Local Swift packages can be tested without downloading the iOS Firebase SDK. See ui/README.md for signing and simulator checks.

`npm run generate` updates both contracts and tokens after a source change. `npm run check:generated` verifies committed output. `npm run test:unit` runs the backend harness; TODOs are intentionally pending, not passing feature tests. `npm run test:rules` tests deny-all baseline rules against demo-dip. CI downloads emulator binaries the first time; cache is reused later. Rules currently allow no client access. Backend resources are deployed by hand (`firebase deploy` against project `team05-dip`; see [account integration](docs/contracts/accounts-integration.md)), and the admin portal is served by Firebase Hosting: see [apps/admin/README.md](apps/admin/README.md#deploy-firebase-hosting). Copy .firebaserc.example locally only when the team selects projects; routine tests always specify demo-dip explicitly.

## Team entry points

Read AGENTS.md and [CURRENT_STATE.md](CURRENT_STATE.md) before assigning agent work. Use the [V1 status tracker](docs/milestones/v1/STATUS.md) to claim a packet, and the [context guide](docs/context/README.md) to load only relevant references. [V1 scope](docs/milestones/V1.md), [V2 scope](docs/milestones/V2.md), [architecture](docs/architecture.md), [contracts](contracts/README.md), [design system](docs/design/README.md), and [contribution workflow](CONTRIBUTING.md) define the shared boundaries. [Agent workflow](docs/agent-workflow.md) explains isolated branches/worktrees and coordination on shared files.

The contract handoff includes typed V1 membership, RSVP, create-event and update-event commands, Firebase read/write ownership, stable error mapping, retry rules and proposed V2 command boundaries. These are specified, not implemented. Initial DTO fields preserve the submitted Models.swift except the proposed Event.revision field and private join-code relocation. Design tokens are grounded in the inspected Figma Home frame; component specs are future implementation targets, not a shipped library.

Assign real reviewers before feature review. Confirm contract decisions, cloud IDs/location, signing and design assets before work that depends on them; fixture-based work can proceed meanwhile. Use reviewed PRs and green CI now. Configure main branch protection when the GitHub plan supports it; the current plan limitation is recorded below. Nothing deploys cloud resources as part of setup.

Use [V1 workstreams](docs/milestones/v1/README.md) to assign independent agent tasks. Read [SESSION.md](SESSION.md) for required session handoffs, [PROVENANCE.md](PROVENANCE.md) for evidence and generated artifacts, and [ADRs](docs/adr/README.md) for decision records.

Local tooling/CI uses Node24.12+ because the current Firebase rules-testing SDK requires it. Deployed Functions remain pinned to Node22 in firebase.json; the workspace engine range supports both, and backend tests/build also run on Node22 in CI.

Backend sample data lives in gcp/sample-data. `npm run emulators` starts local services; in a second shell set the three documented demo/emulator environment values and run `npm run seed`. `npm run test:seed` runs the guarded seed twice in temporary Auth/Firestore emulators. It checks repeatability and then shuts them down; use the interactive command to keep data available while developing.

[Repository readiness](docs/repository-readiness.md) maps setup requirements to evidence. [Setup constraints](docs/setup-constraints.md) records the verified private-repository branch-protection plan limitation and remaining human decisions. CI checks are present; protected-branch enforcement is not available on the current GitHub plan.

See [V1 account integration](docs/contracts/accounts-integration.md) for current exports, permissions, native-client wiring and repeatable emulator checks. No cloud deployment is performed by repository checks.

The [native UI review](ui/ComponentPreview/Review/README.md) records original-frame comparisons, observable mock adapters and the human-defined photo bubbles. See [current state](CURRENT_STATE.md) before connecting configured account data.
