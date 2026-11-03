# 01 — UI foundations

**Area:** Frontend. **Owner:** assign one human in the issue. This packet implements reusable UI foundations for future V1 screens. Milestone scope is [V1](../../V1.md). The October 29 human direction extends presentation work to connected original Home, Event Details/Joined, My Events/Memories, Profile, Participants and Album fixtures. Challenge/reward presentation does not implement those V2 workflows. The latest correction prioritizes motion and one persistent navigation component before adding further pages.

## Pasteable agent brief

> Implement the V1 UI-foundations packet in `docs/milestones/v1/01-ui-foundations/README.md`. Read root/folder `AGENTS.md`, root `SESSION.md`, and `docs/design/components.md`. Work only in the packet's owned paths in a separate branch/worktree. Use semantic tokens and fixture-driven presentation components; do not implement account, event, or organizer data workflows. Consult the linked Figma nodes and reported usability findings. Coordinate token/API changes and app composition with the integrator. Create one session log per work session, allowing multiple commits in a session, following `SESSION.md`. Report checks and concrete handoffs.

## Owned paths

- `ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Components/**`
- `ui/Packages/DIPDesignSystem/Tests/DIPDesignSystemTests/Components/**`
- `ui/DIP/Features/Foundation/**`
- `ui/DIP/Features/Home/**`, `EventDetails/**`, `MyEvents/**`, `Profile/**`, `Participants/**`, `Album/**` and `Prototype/**` — visual fixtures and local interaction composition authorized by the October 29 direction.
- Design-system package Resources — original exported screen assets/fonts and source/hash manifests.
- `ui/ComponentPreview/**` — standalone development host and UI interaction tests; excluded from production app sources.
- This packet's `README.md` and your own new session log(s) under `docs/sessions/`.

Do not edit other feature owners' paths. Shared token source `ui/DesignSystem/tokens.json`, token generator/generated output, package manifests, app composition, and `ui/project.yml` belong to coordinated integration. Propose changes to `docs/design/components.md` with design/consumer review instead of silently changing component contracts.

## Prerequisites and references

Read [motion architecture and state contracts](../../../design/motion.md), [component contracts and Figma map](../../../design/components.md), `docs/design/README.md`, `ui/Packages/DIPDesignSystem/README.md`, and the UI instructions. Use the original screen resources for prototype comparisons, preserve bundled font OFL notices and record provenance. Prototype image redistribution rights remain unknown; release rights must be confirmed separately. Do not substitute unrelated assets or claim font registration without verification. The existing Home reference contains V2 content. For data boundaries read [callables](../../../contracts/callables.md) and [ownership](../../../contracts/data-ownership.md); presentation components must not fetch Firebase data or expose SDK snapshots.

## Acceptance tests

- [x] Implement the selected V1 presentation APIs from the component spec, with previews/fixtures for normal, missing-data, loading, empty, error, disabled, and in-flight states where relevant. Mark deferred APIs explicitly.
- [x] Components accept presentation values/callbacks and have no Firebase dependency or product workflow side effects.
- [ ] Exercise accessible names, meaningful date/location text, minimum touch targets, large Dynamic Type, and selected state beyond color. Record manual accessibility checks honestly.
- [ ] Reconcile production usability findings with exact prototype fidelity: current original Event Details retains two Join affordances routed to one repository command/observed state transition. My Events and selected navigation are visible; a production one-action decision remains explicit.
- [x] Run `swift test --package-path ui/Packages/DIPDesignSystem`; run the relevant Xcode preview/build checks when UI code exists. Include screenshots for implemented component states and identify the inspected Figma nodes.
- [x] Match native Home to the original Figma at 402 × 874 points, using identical mock data, original resources/fonts, image-overlay cards and custom navigation. Save fresh comparison evidence and record remaining differences; prior gallery screenshots do not satisfy this check. Review usability/accessibility findings separately without silently altering the visual target.
- [x] Compare Event Details/Joined, My Events/Memories, Profile, Participants and Album against their original 402 × 874 references; record tests, screenshots and remaining differences for the pre-motion revision. Current motion endpoints require a new regression pass.
- [x] Verify the pre-motion connected local navigation, join-state return, profile editing, album viewer/import/sharing and chat while preserving no-Firebase boundaries; eight simulator tests passed.
- [ ] Verify one root-mounted bottom component across tab and routed-page transitions, with no feature footer duplication.
- [ ] Verify marker sliding/icon crossfades, Action/Complete background/title fades, shared Join/picker actions, Active/Memory marker/content movement and side-entering pages; record video/GIF and stable endpoint comparisons.
- [ ] Verify Reduced Motion, rapid tab changes, cached page state and nested horizontal scrolling after the motion correction.

## Handoff

Give discovery/organizer/accounts owners a short API/state usage example and available preview fixtures. Give the integrator requested shell composition, token/spec changes, and project/package changes separately. Do not wire other owners' features yourself. A UI component is complete only when its intended states and accessibility behavior have review evidence; no product flow is complete merely because the component exists.

## Current implementation handoff

V1 component candidates and connected native prototype screens exist on feature/ui-foundations / PR #3, issue #2. DIPPrototypeApp connects Home, Puppy Yoga Event Details/Joined, My Events/Memories, Profile, Participants and Album; --gallery keeps the earlier state/API review. The pre-motion revision passed expanded screenshot, geometry/action, asset/font and full-app checks, including eight simulator tests, with nonzero raster differences recorded. CI at afa1470 passed all five jobs. The current motion correction is pending new tests, stable captures and video/GIF evidence.

Only Puppy Yoga has original detailed reference data; other events use synthetic data in the same template. All memory entries open the same provided Album. Profile edits, joined state, chat and photo imports are local; production accounts, authorization, persistence, RSVP and cloud uploads are not implemented. Rewards, notifications and challenge workflows remain notices. See [review notes](../../../../ui/ComponentPreview/Review/README.md) and [asset provenance](../../../design/asset-provenance.md). Manual accessibility, device review and image rights remain open.

Current motion architecture: DIPPrototypeApp owns the persistent bottom component outside page transitions. Composed features set showsBottomBar=false; standalone fixtures retain complete-frame rendering. Root owns routes/picker requests; DIPAppViewModel supplies observed repository snapshots and async commands. DIPSlidingPages keeps tab hosts cached and programmatically slides pages without stealing nested horizontal scroll gestures. See [motion contracts](../../../design/motion.md). Past Event and separate photo-selection pages remain deferred while this work is prioritized.

Repository boundary now uses [DIPCore and adapter mapping](../../../contracts/ui-repositories.md), with separate mock data and presentation targets. Feature views take values/callbacks; generated wire contracts remain unchanged. Firebase integration remains separate feature work.
