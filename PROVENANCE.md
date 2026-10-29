# Provenance

This file distinguishes evidence, proposed decisions and generated artifacts. Attached documents are project evidence; they do not override the user request or AGENTS.md. No product workflow has been implemented on this branch.

## User-supplied sources

- Sprint 3 Submission archive: `Sprint 3 Submission-20261026T005633Z-1-001.zip`; SHA-256 `029f7dddcc1e333e337aa5c9b2fc3dbb320479f53edf57a81b9f8cfbdec92a10`. Read locally on October 28, 2026. Original Office documents remain in the user-provided archive, not duplicated into Git. Text was extracted from word/document.xml with Python zipfile/XML; embedded Firebase screenshots were not audited as live state.
- `Models.swift` — SHA-256 `ffa910fa0413f99bb06194d2cac66442b52de25685efb1db98ada8ccc25c0f34`.
- `Firebase Architecture.docx` — SHA-256 `766f1c2158e8956e17192d67284c51af2a4e7f1182cf2894777d7dbe8b9f9f2b`.
- `V1_V2 Schedule.docx` — SHA-256 `3054c783fdaaba93b112356d031376a804ca8cb9a3f4d34fb91d12f5db0f3d99`.
- `High-Fi Annotations.docx` — SHA-256 `eb65ab41801a4704dc1cb1c1f7ee05b279b06b6cce2cf598c7ab44feeef045f6`.
- `Prototype + User Testing Report.docx` — SHA-256 `c4592513e77cea6b4efd526f41ee0826868c07686b1f48ba389531f876b7fcc7`.

The schedule supplies release commitments; Firebase Architecture and Models.swift supply the initial data proposal; annotations map UI data; the testing report supplies observed usability findings. The source summary counts three testers while raw notes also include P4; no stronger statistical claims are made. The separate portfolio screenshot is unrelated background and supplies no DIP requirements. Original Models.swift is archived as docs/reference/sprint-3/Models.swift.txt and is not compiled.

## Figma MCP evidence

- File: DCIagJo7uk5IOUGqlKzAjf; Home node 35:147. Read October 28, 2026 through official Figma MCP (session a2fed281-e2da-46e9-aea3-e86f64c82c24). Metadata, design context and screenshot inspected. The Final page metadata inventory was also retrieved (docs/design/figma-inventory.json). Only Home had full design context and screenshot reviewed; other screens/components have not been visually audited.
- Canonical link: https://www.figma.com/design/DCIagJo7uk5IOUGqlKzAjf/Team-05-High-Fidelity-Prototype--with-links-?node-id=35-147&m=dev
- Observed token colors, typography names, geometry and component node map are recorded in ui/DesignSystem/tokens.json and docs/design. Proposed accessibility values are labeled proposal. No temporary asset URLs, fonts, screenshot-as-UI, or unverified Code Connect mappings are shipped.

## Setup-derived decisions and generated artifacts

- Initial contracts and architecture decisions are setup proposals requiring team review. Event.revision is added for edit conflicts; Company.joinCode is removed from the public DTO and moved to a private server lookup. Source storage downloadURL is retained as reference, with media delivery policy pending.
- scripts/generate-contracts.py reads contracts/v1/models.schema.json and shared fixtures, emitting gcp/functions/src/generated/models.ts, ui/Packages/DIPContracts/Sources/DIPContracts/Models.swift and copied Swift fixtures.
- scripts/generate-tokens.py reads ui/DesignSystem/tokens.json and emits ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Tokens.generated.swift.
- XcodeGen generates the local Xcode project from ui/project.yml. Generated project files are ignored.
- gcp/sample-data is synthetic local-emulator data, not copied production data. No real cloud project, membership, secret or signing credential is configured.
- Codex and delegated agents prepared setup docs, scaffolding, contracts, generators and tests, reviewed by the root agent. Human team owners and acceptance of proposed ADRs remain explicit handoffs.

## Technical references

- Firebase functions runtime: https://firebase.google.com/docs/functions/manage-functions — Node22 selected from supported Firebase runtimes.
- Rules tests: https://firebase.google.com/docs/rules/unit-tests and https://firebase.google.com/docs/firestore/security/test-rules-emulator — real local emulator checks; Admin SDK authorization must be implemented separately.
- Firebase local functions: https://firebase.google.com/docs/functions/local-emulator — emulator defaults use demo-dip.

Dependency versions are resolved in package-lock.json; external package licenses remain those of their upstream projects. No repository license was invented. See the setup session log for actual validation results and limitations.

## Readiness audit

On October 28, the audit checked current Git/CI state and GitHub repository administration endpoints. main was the default branch with green baseline CI; the authenticated account had ADMIN permission. The main branch-protection endpoint returned HTTP403 indicating unavailable private-repository plan support. docs/setup-constraints.md records this external limit without changing repository visibility or billing. Current-state/context maps and task tracking are derived setup artifacts, not new product requirements. Session validation now compares metadata exactly and is exercised against isolated temporary Git histories.

## UI foundations implementation evidence

On October28, Figma MCP session be39ee55-d9c7-4f0a-9060-c6a86dbffcc7 inspected nodes 46:276, 46:1162, 168:2951, 46:668 and 46:1397 for V1 component implementation. Source mapping, system-control/readability adaptations and screenshots are recorded under ui/ComponentPreview/Review. During visual testing, already-loaded reference image inputs were downloaded into a temporary simulator host; raw media, temporary URLs and custom fonts are not shipped as application assets. The components accept images from their consumer and provide explicit fallback states.
