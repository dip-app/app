# 01 — UI foundations

**Area:** Frontend. **Owner:** assign one human in the issue. This packet implements reusable UI foundations for future V1 screens. Milestone scope is [V1](../../V1.md); it does not include challenge/rewards screens.

## Pasteable agent brief

> Implement the V1 UI-foundations packet in `docs/milestones/v1/01-ui-foundations/README.md`. Read root/folder `AGENTS.md`, root `SESSION.md`, and `docs/design/components.md`. Work only in the packet's owned paths in a separate branch/worktree. Use semantic tokens and fixture-driven presentation components; do not implement account, event, or organizer data workflows. Consult the linked Figma nodes and reported usability findings. Coordinate token/API changes and app composition with the integrator. Create one session log per work session, allowing multiple commits in a session, following `SESSION.md`. Report checks and concrete handoffs.

## Owned paths

- `ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Components/**`
- `ui/Packages/DIPDesignSystem/Tests/DIPDesignSystemTests/Components/**`
- `ui/DIP/Features/Foundation/**`
- `ui/ComponentPreview/**` — standalone development host and UI interaction tests; excluded from production app sources.
- This packet's `README.md` and your own new session log(s) under `docs/sessions/`.

Do not edit other feature owners' paths. Shared token source `ui/DesignSystem/tokens.json`, token generator/generated output, package manifests, app composition, and `ui/project.yml` belong to coordinated integration. Propose changes to `docs/design/components.md` with design/consumer review instead of silently changing component contracts.

## Prerequisites and references

Read [component contracts and Figma map](../../../design/components.md), `docs/design/README.md`, `ui/Packages/DIPDesignSystem/README.md`, and the UI instructions. Confirm image/font licensing and default-image catalog with the team; do not substitute unapproved assets or claim custom fonts are bundled. The existing Home reference contains V2 content. For data boundaries read [callables](../../../contracts/callables.md) and [ownership](../../../contracts/data-ownership.md); presentation components must not fetch Firebase data or expose SDK snapshots.

## Acceptance tests

- [x] Implement the selected V1 presentation APIs from the component spec, with previews/fixtures for normal, missing-data, loading, empty, error, disabled, and in-flight states where relevant. Mark deferred APIs explicitly.
- [x] Components accept presentation values/callbacks and have no Firebase dependency or product workflow side effects.
- [ ] Exercise accessible names, meaningful date/location text, minimum touch targets, large Dynamic Type, and selected state beyond color. Record manual accessibility checks honestly.
- [x] Event-card and tab-bar consumers can show one clear Join action, recognizable My Events navigation, and visible joined/active state without one-off styling.
- [x] Run `swift test --package-path ui/Packages/DIPDesignSystem`; run the relevant Xcode preview/build checks when UI code exists. Include screenshots for implemented component states and identify the inspected Figma nodes.
- [x] Compare requested components with their Figma references while applying the testing report's label/readability corrections. Record font, contrast, dark-mode, or asset gaps without declaring them resolved.

## Handoff

Give discovery/organizer/accounts owners a short API/state usage example and available preview fixtures. Give the integrator requested shell composition, token/spec changes, and project/package changes separately. Do not wire other owners' features yourself. A UI component is complete only when its intended states and accessibility behavior have review evidence; no product flow is complete merely because the component exists.

## Current implementation handoff

V1 component candidates, fixture gallery and standalone preview host are implemented on feature/ui-foundations, tracked in issue #2. See [review notes](../../../../ui/ComponentPreview/Review/README.md) for exact reference nodes, screenshots, adaptations and remaining manual accessibility/design checks. Challenge card remains V2 and is deferred. The accessibility checkbox stays open until manual VoiceOver/device review is recorded; automated labels/values, navigation, width and reachability checks pass. Shared integration patches in this PR exclude Markdown from app resources and add the preview UI tests to the existing Swift CI job. No production startup/data workflows are wired.
