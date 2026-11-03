# Architecture decisions and team handoffs

Status: proposed setup baseline. No feature code or cloud deployment. Canonical project context is Sprint 3, with the approved V1/V2 schedule taking precedence over the broader prototype.

## ADR 001 — one monorepo, separate build boundaries

`ui` owns the SwiftUI app and local Swift packages. `gcp/functions` owns GCP Cloud Functions deployed via Firebase, using Node 22 and TypeScript. Firebase rules/indexes live alongside the service. `contracts` owns wire schema and fixtures. `design-system` owns token source and component specifications. `docs/milestones` owns scope. Each builds/tests independently; no server credentials or Firebase SDK types in shared contracts.

Use Firebase Auth for identity; Firestore for tenant-scoped live reads and reviewed direct profile writes; callable Functions for membership, event commands and privileged state transitions; Cloud Storage for V2 media. Avoid adding an independent REST server until a consumer needs it. Functions source exports nothing on this branch, so setup cannot masquerade as product behavior.

## ADR 002 — server owns transitions and counts

The source suggests direct RSVP writes with a counter trigger. Proposed change: setRsvpV1 performs capacity and RSVP/counter mutation in a transaction. It avoids eventual counter updates and last-seat races. Membership and organizer event creation/editing use callables too, making security/validation consistent. Ordinary read subscriptions remain native Firestore. Root contracts describe exact commands and errors. Backend owner implements thin transport + application service + domain rules + Firestore adapter; iOS owner implements repository adapter + ViewModel state handling against those contracts. Merge contracts before parallel implementations.

## ADR 003 — schemas and token sources generate language foundations

JSON Schema is the contract source; a small deterministic Python generator creates Swift/TypeScript DTOs. This setup avoids duplicated handwritten model definitions. Generated types are transport types, not complete domain validation or Firestore persistence adapters. Source Models.swift is archived as reference. Event.revision is a proposed addition; Company.joinCode moves to a private server lookup. Semantic tokens generate a separate Swift package. CI rejects drift; consumers never edit generated output.

## ADR 004 — local-first checks and deny-all policy

Only demo-dip emulators are the default. Rules deny all initially; feature PRs open reviewed access with adversarial emulator tests. CI runs schema/fixture checks, TypeScript build, test harness, security baseline, Swift package tests and project generation. Product coverage targets apply to implemented logic: >=70% V1; >90% V2. TODO/skipped tests and generated files cannot establish that target. Add measured coverage and thresholds when business modules arrive, rather than claiming coverage on empty scaffolding.

## Decisions to confirm before dependent work

| Decision | Proposed default / why | Required before |
|---|---|---|
| Firebase/GCP projects and location | Separate development/staging/production; us-central1 only as callable proposal | Any deployment or client config |
| iOS minimum / identifier | iOS17+, org.dip-app.DIP placeholders | Device signing/release |
| Membership | Google sign-in; server matches the verified email's root domain to a company by querying `companies.emailDomain`; personal domains refused ([ADR 0007](adr/0007-oauth-domain-based-sign-in.md)) | Accounts integration |
| Roles | Existing admin means V1 organizer; member is normal user | Event commands/rules |
| Public company projection | No secrets in the readable company document; domain mapping is server-only | Company reads |
| Private profiles | Self-only; RSVP snapshots show coworker name/avatar/department | Profile/attendee integration |
| Organizer edit conflict | revision with optimistic conflict handling; synchronize RSVP dates | Editing release |
| Date policy | UTC storage, localized UI; classify past by endTime | Feed/My Events |
| Design gaps | Font assets/license, dark mode and contrast; approve default image catalog | Design system components |
| V2 policies | Attendance window, challenge evidence, upload access/limits, approval reversal | V2 feature contracts |
| Team review enforcement | Real account owners and GitHub protections configured by maintainer | Merging feature branches |

No fake GitHub teams or project IDs are checked in. See CONTRIBUTING and docs/agent-workflow.md for multi-user integration.
