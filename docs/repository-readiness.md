# Repository setup readiness

Scope: enable multiple contributors and agents to start V1 work. This checklist does not claim product implementation or release readiness. The setup/audit session logs and CI runs carry exact execution evidence.

| Requirement | Authoritative artifacts / check | Setup result |
| --- | --- | --- |
| Shared repository and integration branch | Git remote, clean checkout, main default, published commit | Established; check current Git/CI when starting |
| Backend boundary and sample data | gcp/, firebase.json, sample-data, guarded seed; test:rules and test:seed | Available; no product endpoints or live cloud configuration |
| Swift boundary/testing | ui/project.yml and two local packages; test:swift and ios:generate | Foundations available; full app integration/device verification is future feature work |
| Cross-part contracts | contracts/v1 schema/fixtures and docs/contracts; generation drift, DTO fixtures, build and Swift round-trip | V1 commands specified; implementation absent; V2 handoff explicitly provisional |
| Design foundations | Semantic token source, package, component APIs and Figma inventory/provenance; generated drift and token tests | V1 component candidates available for review; fonts/dark mode are pending |
| Scope and independent ownership | V1.md, V2.md, five V1 packets and STATUS.md | Ready to assign; named team owners remain unassigned |
| Context and task handoff | CURRENT_STATE.md, docs/context, scoped AGENTS.md and contributor/PR templates | Available; keep claims tied to current files/checks |
| Provenance and decisions | PROVENANCE.md, original model reference and numbered ADRs/template | Available; proposal versus accepted status is explicit |
| Session tracking gate | session:new/session:check, log examples and session-handoff CI | New PR log required; repeated pushes can update same session; exact metadata validated |
| Documentation navigation | test:docs checks repository-local Markdown file links | Checked by npm run check / CI; does not validate external URLs or anchors |
| Hosted enforcement constraints | docs/setup-constraints.md plus branch-protection API result | Plan limitation recorded; no false claim of enforced protections |

Before declaring a feature done, use its packet acceptance criteria and the integration/release checklist. Update the status tracker and log real results rather than inheriting the setup's green baseline as feature evidence.
