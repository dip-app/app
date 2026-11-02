# Motion and reusable composition

Status: motion revision on feature/ui-foundations / PR #3 passed a full app build and nine simulator UI tests. Static evidence exists for eight prototype states; navigation, section and page GIFs are recorded in ui/ComponentPreview/Review/Motion. The subsequent repository refactor is awaiting integrated verification. These earlier results do not establish that the current refactor passes.

## Source and interpretation

Figma file DCIagJo7uk5IOUGqlKzAjf, official MCP session 3e1280af-413b-44c3-aa9f-76a159a5152c. Navigation component 46:637 has these inspected variants:

| Variant | Node | Interpretation |
| --- | --- | --- |
| Home | 1228:1060 | Home selected |
| Rewards | 46:633 | Ticket selected; workflow is still deferred |
| Memories / My Events | 46:634 | Grid selected |
| Profile | 46:635 | Profile selected |
| Action | 46:651 | Action overlay on the persistent bottom component |
| Complete | 46:1806 | Disabled completion overlay; source gray #CCCCCC |

Prototype reactions provide page PUSH transitions with 0.3-second EASE_OUT timing, reversing horizontal direction for backward destinations. Active Events / Memories reactions provide PUSH transitions with the SLOW preset and duration 0.625061452 seconds. The exported preset does not include spring coefficients. get_motion_context returned no timeline nodes: these are interactive prototype variants/reactions, not keyframe tracks. An empty motion timeline is not evidence that the prototype lacks animation.

The human explicitly requires Action/Complete backgrounds and titles to fade over the same bottom component. That direction governs the implementation even where exported reaction data is incomplete.

## One persistent bottom component

DIPPrototypeApp renders one DIPFloatingNavigation above and outside its NavigationStack/page content. It stays in the same root position when a tab changes, a detail is pushed or an action appears. Do not put a separate replacement bar inside every app page or animate the bar as part of a page transition.

Each feature accepts showsBottomBar for standalone use. Its default remains true so isolated previews can render a complete frame; DIPPrototypeApp passes false to every composed feature. This is the distinction between a useful standalone fixture and the single component mounted in the real prototype shell.

DIPFloatingNavigation owns only presentation:

- One white 60-point selection circle moves horizontally between fixed tab slots.
- Each icon has original selected/unselected SVG layers whose opacity crossfades.
- An optional DIPBottomBarAction overlays background/title/action state on the tab bar.
- The tabs remain mounted underneath the action overlay, but are disabled, not hittable and hidden from accessibility while that overlay is active.
- Action/title changes dissolve in place. They must not push a new bottom bar on/offscreen or expose hidden tab controls to interaction.

DIPBottomBarAction supplies title, style, stable accessibility identifier and optional value. Its styles are standard/dark, accent/purple and complete/gray. Complete uses the Figma-derived actionComplete token (#CCCCCC) and disables activation. The Complete visual API does not imply an implemented production completion workflow.

## State ownership contracts

| Owner | State / output | Constraint |
| --- | --- | --- |
| DIPPrototypeApp | selectedTab, route stack, active action and picker request | Single source for navigation and bottom presentation; injects the repository |
| DIPAppViewModel / DIPRepository | Observed read snapshots, asynchronous commands, pending/error state | Product state changes arrive through observation; commands do not fabricate read state |
| DIPFloatingNavigation | Selected tab + optional action, selection/action callbacks | Renders motion and hit/accessibility state; no feature writes |
| Event Details | Event value, Joined Bool and Join/attendees/chat/back callbacks | In-page Join and root bottom Join read the same snapshot and invoke the same command |
| Album | Picker presentation binding | Root Add Photos action requests the feature's picker; no second footer |
| My Events | Active/Memory selection and its local content | Header, marker and content agree on the same selected section |
| Feature views | Presentation data and callbacks | No Firebase adapters or server authority enter shared components |

The root derives a bottom action from the active route: Join the Activity / Activity Chat for Event Details, Activity Chat for Participants and Add Photos for Album. Removing the route reveals the existing selected-tab bar again. Joined state remains repository-owned while moving between routes. Photo imports, profile edits and chat issue repository commands; the injected mock currently retains them only for its instance lifetime. See the [repository contract](../contracts/ui-repositories.md) and [ADR 0005](../adr/0005-observable-ui-repositories.md).

## Pages and sections

DIPSlidingPages adapts a native UIPageViewController for horizontal, programmatic transitions between Home, My Events and Profile. Its coordinator caches UIHostingController instances instead of rebuilding a page for every selection. Forward/reverse direction follows the current page order. It refreshes hosted content so values/callbacks use current observed snapshots and navigation state.

The outer page pan is intentionally disabled. Tab taps select pages; nested event carousels and photo grids retain their own scrolling gestures. Native NavigationStack pushes and pops detail routes from the side. These page containers choose native transition behavior; do not claim their internal timing/easing exactly reproduces Figma's numeric curve without measured video evidence.

Active Events / Memories uses one white capsule marker that changes width/position while its content moves in opposite horizontal directions. The SwiftUI smooth animation uses the exported SLOW duration as an approximation because the original spring coefficients were not exported. Do not invent physical spring constants or describe this as a verified spring match.

## Shared timing and Reduced Motion

DIPMotion defines navigationDuration = 0.3, sectionDuration = 0.625061452 and reducedMotionDuration = 0.12. Navigation marker/icon/action transitions use the shared navigation helper; My Events uses the section duration/curve. Keep these values centralized when adjusting shared behavior and coordinate changes across consumers.

With Reduce Motion enabled, selection/page/section changes use short opacity transitions rather than translating large regions across the display. Controls retain their identifiers, selected traits and shared state. This path requires its own verification; a standard-motion video does not establish Reduced Motion behavior.

## Reuse through composition

The requested React-style atomic reuse idea maps here to small, composable SwiftUI views. This is an architectural approach, not a formal atomic-design framework or a new runtime dependency:

1. Tokens, registered fonts and original resources provide shared values/assets.
2. Components such as headers, photo cards, markers and the persistent bottom navigation compose those values.
3. Feature views compose components around presentation data and callbacks.
4. DIPPrototypeApp owns cross-feature navigation and bottom presentation; DIPAppViewModel observes repository state and coordinates commands.

Extract a reusable component when multiple consumers share behavior or the design explicitly specifies a shared component. Keep page-specific layout in its feature. Do not duplicate a navigation component to obtain a different selected/action state, install React in the iOS app, or add abstract component hierarchies solely to mirror terminology.

## Verification contract

The pre-refactor motion checkpoint passed nine UI tests and a full app build. Recorded clips: [navigation](../../ui/ComponentPreview/Review/Motion/navigation.gif), [sections](../../ui/ComponentPreview/Review/Motion/sections.gif), [pages](../../ui/ComponentPreview/Review/Motion/pages.gif). The repository integration then passed nine UI tests, seven final connected regressions and a full app build. Retain these acceptance cases for future changes:

- Record tab transitions with the bottom component fixed while its marker slides and icon layers crossfade.
- Record push/pop detail routes and confirm the same bottom component remains in place.
- Record tab-to-Action, Join-to-Chat and Action-to-tabs; background/title should fade rather than replace the footer.
- Verify Complete styling/disabled behavior at the component boundary.
- Record Active/Memory forward/back marker and content travel.
- Verify rapid tab taps, cached page state, nested horizontal scrolling and shared Join/picker actions.
- Verify Reduced Motion and endpoint geometry; repeat static comparisons after the motion changes.

Save video/GIF evidence alongside current test/build results in the [review notes](../../ui/ComponentPreview/Review/README.md). Current local results and native conversation evidence are recorded there; published CI status remains separate.
