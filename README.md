# DIP app

Shared repository setup for a company-based coworker events app: native SwiftUI + Firebase/GCP. This branch supplies development foundations, **not implemented app features**. Source context: Sprint 3 submission, October 25, 2026; Figma Home node 35:147 inspected through MCP on October 28. V1 due November 9; V2 due December 4.

## Layout

```text
ui/                    XcodeGen spec, bootstrap app, feature/data/domain boundaries
  Packages/DIPContracts/     generated Swift wire models + shared-fixture tests
  Packages/DIPDesignSystem/  generated design tokens + package tests
gcp/           emulator config, rules, indexes, tests
  functions/                 TypeScript Functions workspace (no exports/endpoints)
contracts/                   JSON Schema, fixtures, API/data ownership specifications
ui/DesignSystem/               token source, Figma mapping, component API specifications
docs/milestones/V1.md          committed V1 scope and acceptance checklists
docs/milestones/V2.md          committed V2 scope and separate stretch goals
scripts/                     deterministic contract/token generation
.github/                     CI, feature issue template, PR checklist
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

`npm run generate` updates both contracts and tokens after a source change. `npm run check:generated` verifies committed output. `npm run test:unit` runs the backend harness; TODOs are intentionally pending, not passing feature tests. `npm run test:rules` tests deny-all baseline rules against demo-dip. CI downloads emulator binaries the first time; cache is reused later. Rules currently allow no client access. No deploy script/production project is configured. Copy .firebaserc.example locally only when the team selects projects; routine tests always specify demo-dip explicitly.

## Team entry points

Read AGENTS.md before assigning agent work. [V1 scope](docs/milestones/V1.md), [V2 scope](docs/milestones/V2.md), [architecture](docs/architecture.md), [contracts](contracts/README.md), [design system](docs/design/README.md), and [contribution workflow](CONTRIBUTING.md) define the shared boundaries. [Agent workflow](docs/agent-workflow.md) explains isolated branches/worktrees and coordination on shared files.

The contract handoff includes typed V1 membership, RSVP, create-event and update-event commands, Firebase read/write ownership, stable error mapping, retry rules and proposed V2 command boundaries. These are specified, not implemented. Initial DTO fields preserve the submitted Models.swift except the proposed Event.revision field and private join-code relocation. Design tokens are grounded in the inspected Figma Home frame; component specs are future implementation targets, not a shipped library.

Before the first feature merges, maintainers must assign real reviewers, enable branch protections/checks for main, select Firebase environment IDs/location, confirm membership/security decisions, and approve design gaps. These GitHub/cloud settings cannot be established by checked-in documentation alone. Nothing deploys or publishes on this branch.

Use [V1 workstreams](docs/milestones/v1/README.md) to assign independent agent tasks. Read [SESSION.md](SESSION.md) for required session handoffs, [PROVENANCE.md](PROVENANCE.md) for evidence and generated artifacts, and [ADRs](docs/adr/README.md) for decision records.

Local tooling/CI uses Node24.12+ because the current Firebase rules-testing SDK requires it. Deployed Functions remain pinned to Node22 in firebase.json; the workspace engine range supports both, and backend tests/build also run on Node22 in CI.

Backend sample data lives in gcp/sample-data. `npm run emulators` starts local services; in a second shell set the three documented demo/emulator environment values and run `npm run seed`. `npm run test:seed` runs the guarded seed twice in temporary Auth/Firestore emulators. It checks repeatability and then shuts them down; use the interactive command to keep data available while developing.
