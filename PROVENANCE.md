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

- Initial contracts and architecture decisions are setup proposals requiring team review. Event.revision is added for edit conflicts; Company.joinCode is removed from the public DTO; company membership is resolved from the email domain through a private server lookup (ADR 0007). Root-domain coercion uses the `tldts` Public Suffix List library (7.4.16, MIT); iOS Google sign-in uses GoogleSignIn-iOS 10.0.0 (Apache-2.0). Source storage downloadURL is retained as reference, with media delivery policy pending.
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

## November 1 V1 account integration

PR #4 (ariaf7) was independently reviewed with 33 unit and 9 Firestore emulator tests before approval/merge at d131142. Its core is reused unchanged except documented integration hooks. The follow-up adds transactional throttling/App Check export, narrow self-profile rules, Swift account observations/lifecycle guards and CI discovery/full SDK compilation. A boundary-delay limiter bug found in independent review was reproduced, fixed and regression-tested. Profile list limits of10 are explicit persistence-policy proposals after real emulator expression-budget validation, not a claim that the source schedule specified them. No onboarding UI was invented and no cloud resources were deployed.

## UI foundations implementation evidence

On October28, Figma MCP session be39ee55-d9c7-4f0a-9060-c6a86dbffcc7 inspected nodes 46:276, 46:1162, 168:2951, 46:668 and 46:1397 for V1 component implementation. On October 29, the user required fidelity to the original prototype, superseding the earlier gallery adaptations. Home 35:147 was re-read in the same session. Original individual illustrations, avatars, photos and SVG icons are bundled for local presentation fixtures, with SHA-256 hashes in the package resource manifest. Figtree and Fjalla One come from Google Fonts; Inter 3.19 comes from its upstream release to match the prototype metrics. OFL licenses are bundled. Image rights are not established by the Figma export; see [asset provenance](docs/design/asset-provenance.md). Screenshot comparison evidence is under ui/ComponentPreview/Review. No screenshot is used as the screen implementation.


## Expanded native prototype evidence

On October 29, the human requested the other pages be built to the same original-design fidelity. Official Figma MCP session 0cf05e71-dfb2-4c4a-92f3-db6358767921 retrieved full design context and screenshots for Event Details 46:1397, Joined 76:1742, My Events 76:6032, Memories 76:6204, Profile 76:4016, Participants 76:4932 and Album 46:1995. The Resources/screen-assets.json manifest records their individual image/SVG exports and hashes. Original frame screenshots are review evidence only; native SwiftUI composes the implementation.

Inter Light and Italic were added from the same upstream 3.19 distribution, preserving its OFL notice. Seven bundled font files supply eight named reference faces including Figtree Bold. The pre-motion revision verified 113 image/SVG assets and seven font-file hashes, eight named font faces, eight same-viewport screen states and eight simulator tests. Those results are recorded in ui/ComponentPreview/Review; they do not verify later motion changes.

At the expanded-screen checkpoint, DIPPrototypeApp owned local navigation and joined state. The current repository refactor moves product read state and mutations into an injected DIPRepository observed by DIPAppViewModel; navigation remains at the root. Profile editing, chat and PhotosPicker imports use the mock adapter, while native sharing/photo viewing remain presentation interactions. These are not Firebase writes or persistent product flows. Only Puppy Yoga has original detailed/Joined frames; other event details are synthetic in the same template. The expanded-screen checkpoint reused the supplied reference album for every memory. The current adapter uses stable memory/event IDs while retaining synthetic reference content. Native edit/chat/picker/viewer screens have no supplied matching high-fidelity reference. Rights for source photography and illustrations remain unconfirmed; source export does not establish ownership.


## Motion correction evidence

The next human correction prioritizes shared motion over new pages: one persistent bottom component, a sliding white selection circle, crossfading icons, Action/Complete background/title fades, sliding Active Events/Memories states and pages entering from the side. That explicit fade requirement is authoritative where export data is incomplete.

Official Figma MCP session 3e1280af-413b-44c3-aa9f-76a159a5152c inspected Navigation Bar component 46:637 and variants Home 1228:1060, Rewards 46:633, Memories 46:634, Profile 46:635, Action 46:651 and Complete 46:1806. Interactive reaction data provides PUSH/EASE_OUT page transitions at 0.3 seconds and Active/Memory PUSH/SLOW transitions at 0.625061452 seconds. No spring coefficients were exported. get_motion_context returned an empty nodes list because these references use interactive prototype reactions rather than keyframe timeline tracks. See [motion contracts](docs/design/motion.md) for the source/approximation boundary.

The selected ticket SVG brings the image/SVG resource total to 114. The Complete visual variant supplies #CCCCCC through the Figma-derived actionComplete token. Seven font files/eight named faces are unchanged. The motion revision subsequently passed a full app build and nine simulator UI tests; navigation, section and page GIFs are recorded under ui/ComponentPreview/Review/Motion. These results precede the current repository refactor; current integrated verification remains pending. Past Event and separate photo-selection references were inspected but their UI work is deferred; no implementation claim is made for them.

The earlier hosted-runner acquisition attempt was canceled. Commit afa1470 switched Swift CI to macos-15 on Intel, and all five jobs passed in [run 40911603057](https://github.com/dip-app/app/actions/runs/40911603057). That green run predates the current uncommitted motion correction. Later motion checks and clips are recorded separately in the review notes. The installed playable review build includes that motion revision; it does not establish verification of the current adapter refactor.


## Observable repository refactor

The next human request requires mock data to sit behind an interchangeable repository. DIPCore defines presentation-independent models and DIPRepository; DIPPresentation contains DIPAppViewModel; DIPMockData centralizes the original reference values and synthetic supporting data. DIPPrototypeApp injects the adapter and observes snapshots. Features render inputs and issue callbacks rather than manufacturing joined state, message lists, profile edits or persisted photos. DIPMedia resolves bundled assets, remote URLs and local bytes without putting transport objects into feature layout.

These are application architecture artifacts, not changes to the submitted Firebase model or generated wire contract. [The UI repository boundary](docs/contracts/ui-repositories.md) and [ADR 0005](docs/adr/0005-observable-ui-repositories.md) describe ownership, observation, errors and Firebase integration. The initial adapter retains data only for its instance lifetime and does not prove authorization, offline persistence or cloud synchronization. The refactor passed a full app build, nine base simulator tests and all package/repository/rules checks. Final native chat/comment, motion and connected-flow regressions passed seven tests; domain/presentation coverage now comprises15 tests.


## Native conversations and press correction

The human explicitly flagged the basic chat fixture and missing photo comments as unimplemented, requiring native SwiftUI quality and shared components. DIPMessageComposer, DIPConversationBubble, DIPPhotoAttributionTag and DIPPressFeedbackStyle now compose both features. Activity chat has no supplied exact Figma frame and is identified as a native design-system composition. Photo comments derive from previously inspected 76:1884/76:2021 context; original photo and 02874.svg send art are reused. Native material/close treatment is an explicit fidelity limitation; no fake OS keyboard was built.

A held-press recording confirms the persistent bottom action remains opaque instead of exposing tab icons. Photo comments initially failed the simulator retry test because the send target overlapped the software keyboard. Native focus reporting and one safe-area composer replaced manual keyboard-notification/scroll anchoring; the final test verifies its frame stays above the keyboard. Chat/comment failure, retry, observed delivery, close/reopen and thread isolation now pass. Both frontend flags are removed; backend implementation remains flagged separately. Evidence is recorded in the current review notes and session003.


## November1 human-defined photo bubbles

The human rejected the invented below-image thread and specified compact bubbles slightly overlapping image edges, avatar first, only a few preview words plus ellipsis, four visible at once, and tap-to-center full text with scrolling after about four lines. This direct instruction is the authority for the current interaction; it is not attributed to Figma. Native screenshots replace the rejected panel evidence. Three conversation tests plus a repeated visual/geometry capture test passed; full app build passed with a fresh package cache.


## November 2 profile/social completion

The expanded interest catalog in DIPMockFixtures is synthetic preview content with fixed IDs, not production seed data or a new taxonomy authority. Its projection follows the existing Tag/AppUser schemas; see docs/contracts/profile-interests.md. The user requested Add interests, profile improvements and sign-out. Account illustrations are preserved from the merged onboarding implementation; native picker/recovery UI is authored SwiftUI composition, not a new Figma export. Photo-comment edge/corner-placement redesign and the weekly challenge page are recorded as deferred user feedback, not implemented or visually approved by interaction tests.
