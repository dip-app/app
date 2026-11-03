# Component contracts and Figma map

Status: connected prototype implementation on feature/ui-foundations / [PR #3](https://github.com/dip-app/app/pull/3). Home, Event Details/Joined, My Events/Memories, Profile, Participants and Album use original Figma resources. Pre-motion visual evidence and eight simulator checks are recorded in the review notes. The motion revision passed a full app build and nine simulator UI tests, with navigation/section/page GIFs under ui/ComponentPreview/Review/Motion. Integrated verification of the subsequent repository refactor is pending. The optional --gallery implementation is a state/API laboratory, not the visual target for new screen consumers.

Source: [Team 05 prototype](https://www.figma.com/design/DCIagJo7uk5IOUGqlKzAjf/Team-05-High-Fidelity-Prototype--with-links-?node-id=35-147&m=dev), file DCIagJo7uk5IOUGqlKzAjf. See [working agreement](README.md), [source provenance](asset-provenance.md) and [review evidence](../../ui/ComponentPreview/Review/README.md).

## Shared visual components

| Component | Figma node | Inputs and behavior |
| --- | --- | --- |
| DIPHomeHeader | 46:276 | Title, unread count, supplied profile-avatar view and notification/profile callbacks. Original white-on-purple layout; no fetching. |
| DIPPhotoEventCard | 46:1162 | Title/locality, supplied artwork/avatar views, stable identifier, count, width/shade and activation callback; full-photo overlay layout. Asset-name convenience initializer retained for the gallery. |
| DIPFloatingNavigation | Home 46:668; selected variants in My Events/Profile | One root-mounted component accepts selected destination, optional DIPBottomBarAction and callbacks. Its marker slides, selected/unselected SVGs crossfade, and action backgrounds/titles dissolve over disabled tabs. Home/My Events/Profile and selected Rewards icon variants exist; Rewards workflow remains a notice. |
| DIPBottomBarAction / DIPMotion | Action 46:651 / Complete 46:1806; prototype reactions | Shared action title/style/identifier/value and timing. Complete uses source gray #CCCCCC and is disabled. No backend completion is implied. |
| DIPChallengeCard | 46:1017 | Category, participation count, supplied artwork/avatar views and callback; original mascot geometry. The repository supplies mock Fitness/128 content; no challenge command. |
| DIPReferenceAssets | Original individual exports | Bundled image lookup and registered named fonts; temporary URLs never enter feature code. |
| DIPAvatar / DIPAvatarGroup | 168:2951 | Loaded image/name inputs, size and aggregate count; explicit fallback and decorative-accessibility handling. |

Presentation contracts differ from transport DTOs. Map domain values at the feature boundary; never pass Firestore snapshots, callable clients or server-owned write authority into these views.

## Screen composition and local state

| Screen/API | Source frame | Boundary |
| --- | --- | --- |
| DIPPrototypeApp | Supplied screen relationships | Owns selected tab, route stack, picker request and the persistent bottom component; injects DIPRepository and renders DIPAppViewModel snapshots. DIPSlidingPages caches feature hosts and programmatically slides tab pages; NavigationStack handles routed detail pushes. Direct launch via --screen=...; no Firebase initialization or authorization. |
| DIPHomeScreen | 35:147 | DIPHomeSnapshot, stable event/challenge ID callbacks and menu/navigation callbacks into the root. |
| DIPEventDetailsScreen | 46:1397 / 76:1742 | DIPEventDetail, Joined Bool and Join/back/attendee/chat callbacks. Puppy Yoga has original reference data. Both Join affordances issue the same repository command; observed snapshots update the Joined display. Native ShareLink shares event text. |
| DIPMyEventsScreen | 76:6032 / 76:6204 | Active event/memory arrays, unread count/profile media and stable ID callbacks; local Active/Memory selection. One selection marker and content slide together; Reduced Motion uses fades. The repository supplies deterministic reference cards/grid; no query lives in this screen. |
| DIPProfileScreen | 76:4016 | DIPProfile and tab/memory callbacks, original curved header/portrait/tags/mosaic. Native edit form submits editable fields asynchronously, retains its draft on failure and rejects an empty name. |
| DIPParticipantsScreen | 76:4932 | Participant array/count and back/chat callbacks; the mock supplies the 17 reference rows. No roster query or user lookup lives in this screen. |
| DIPAlbumScreen | 46:1995 | DIPAlbum, back callback and asynchronous photo-add callback; native picker/viewing/sharing. No cloud upload or photo authorization adapter is implemented. |
| DIPEventChatFixture | Annotation only; no high-fidelity chat frame | Provided DIPMessage values and asynchronous send callback; local draft/pending/error state only. No server, membership check or persistent chat is implemented. |

Other events use synthetic detail data in the same Puppy Yoga view template. Memory/event IDs select repository album entries with synthetic reference content. These are explicit fixture boundaries, not proof that all production destinations/data variants are implemented.

## Persistent composition contract

DIPPrototypeApp mounts one bottom component outside page/route transitions. Composed features receive showsBottomBar=false; true is reserved for complete standalone fixtures. Root Action overlays share the existing component, disabling/hiding underlying tabs until the overlay is removed. Observed repository snapshots and a shared Join command keep in-page and bottom actions synchronized; the root picker request opens the album picker. Read [motion architecture, state contracts and reuse](motion.md) before adding a screen or action state.

Small reusable SwiftUI views apply the requested React-style atomic composition idea; this is not a formal framework or a React dependency. Past Event and separate photo-selection pages remain deferred while motion is prioritized.

## State and accessibility handoff

Use identical mock content for standard-size screenshot review. Preserve original typography, photo crops and selected navigation. Supporting native forms/sheets have no supplied exact reference. Manual large text, VoiceOver, contrast, RTL and physical-device review remain open.

Original white-on-purple/yellow accents and duplicate Join affordances are retained for fidelity; do not claim the source usability concerns are resolved. Production integration must reconcile those findings explicitly rather than quietly changing the comparison target.

Feature owners supply authorized media references and asynchronous repository state. DIPMedia/DIPMediaStack adapt bundled assets, URLs and local bytes. [The repository contract](../contracts/ui-repositories.md) and [ADR 0005](../adr/0005-observable-ui-repositories.md) define adapter replacement and state ownership. Foundation code owns reusable rendering/callback APIs; no backend side effects occur here. Coordinate token, resource, package and API changes with the integrator before dependent agents edit consumers. Verified Code Connect mappings are still absent.

## Retained gallery APIs

The gallery remains accessible with --gallery. DIPHeader, DIPEventCard and DIPTabBar contain earlier system/readability adaptations; do not treat them as the exact Figma screen standard. Review/migrate their APIs before using them in a new visual feature.

| API | Candidate behavior |
| --- | --- |
| DIPHeader | Optional person/image/count and callbacks; unavailable controls hidden; large-text stacking. |
| DIPEventCard | DIPEventCardContent, image state, attendee identities/resolver and callback; date/location/attendance/joined metadata. |
| DIPTabBar | Binding to Home/My Events/Profile and native TabView content; separate from the original custom navigation. |
| DIPButton | Title, emphasis, loading/enabled flags and callback; disabled/in-flight controls cannot activate. |
| DIPStateView | Loading/empty/failure presentation and optional retry; no backend requests. |

See [fixture handoff](../../ui/DIP/Features/Foundation/README.md) and [preview instructions](../../ui/ComponentPreview/README.md). Passing local fixture tests does not establish the V1 coverage target or completed product workflows.

## Native conversation components

DIPMessageComposer is shared by activity chat and photo comments. It owns a native multiline TextField and focus reporting, character/blank/pending states, accessible send/retry controls, and an opaque pressed surface. Hosts own drafts and command IDs. Standard and photoOverlay variants share behavior; the overlay accepts avatar/send-art slots. DIPConversationBubble handles sender/body/time and own/other layouts; DIPPhotoAttributionTag provides the shared photo-owner pill. These components take values and view content, without importing domain or Firebase types.

Activity chat is a native design-system composition because no chat frame was supplied. Photo comments translate the cached 76:1884/76:2021 reference into a floating overlay with native keyboard avoidance, not a rendered keyboard or a direct Figma-code transcription. Its native close control is an explicit asset fidelity difference until the unavailable original back SVG can be inspected/imported. Feature status and verified flows live in [V2 interactive status](../milestones/v2/FEATURE_STATUS.md).

Human-defined photo annotations (November1): DIPPhotoCommentBubble is distinct from chat message bubbles. Four compact avatar-first pills slightly overlap image edges; preview text is a few words with ellipsis. A selected pill centers and expands over the image, with native full-text scrolling capped near four lines. It does not introduce a discussion panel or timestamps.
