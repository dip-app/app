# Component contracts and Figma map

Status: connected prototype implementation on feature/ui-foundations / [PR #3](https://github.com/dip-app/app/pull/3). Home, Event Details/Joined, My Events/Memories, Profile, Participants and Album use original Figma resources. Expanded visual evidence and all eight simulator checks are recorded in the review notes. The optional --gallery implementation is a state/API laboratory, not the visual target for new screen consumers.

Source: [Team 05 prototype](https://www.figma.com/design/DCIagJo7uk5IOUGqlKzAjf/Team-05-High-Fidelity-Prototype--with-links-?node-id=35-147&m=dev), file DCIagJo7uk5IOUGqlKzAjf. See [working agreement](README.md), [source provenance](asset-provenance.md) and [review evidence](../../ui/ComponentPreview/Review/README.md).

## Shared visual components

| Component | Figma node | Inputs and behavior |
| --- | --- | --- |
| DIPHomeHeader | 46:276 | Title, unread count and notification/profile callbacks. Original white-on-purple text and avatar/count resource fixture; no fetching. |
| DIPPhotoEventCard | 46:1162 | Title/locality, resource image/avatars, count, width/shade and activation callback; full-photo overlay layout. |
| DIPFloatingNavigation | Home 46:668; selected variants in My Events/Profile | Selected destination and activation callback; original Home/My Events/Profile selected SVG states, four-icon pill, VoiceOver selected traits. Rewards workflow remains a notice. |
| DIPChallengeCard | 46:1017 | Category, participation count/avatars and callback; original mascot and Fitness/128 reference fixture; no challenge command. |
| DIPReferenceAssets | Original individual exports | Bundled image lookup and registered named fonts; temporary URLs never enter feature code. |
| DIPAvatar / DIPAvatarGroup | 168:2951 | Loaded image/name inputs, size and aggregate count; explicit fallback and decorative-accessibility handling. |

Presentation contracts differ from transport DTOs. Map domain values at the feature boundary; never pass Firestore snapshots, callable clients or server-owned write authority into these views.

## Screen composition and local state

| Screen/API | Source frame | Boundary |
| --- | --- | --- |
| DIPPrototypeApp | Supplied screen relationships | Owns selected tab, route stack and local joined-event IDs. Direct launch via --screen=...; no Firebase initialization or authorization. |
| DIPHomeScreen | 35:147 | Original Home, activation callback into prototype root. |
| DIPEventDetailsScreen | 46:1397 / 76:1742 | Event fixture, initial Joined state, back/attendee/join callbacks. Puppy Yoga has original reference data. Both original Join affordances share the local transition; Joined opens local chat. Native ShareLink shares event text. |
| DIPMyEventsScreen | 76:6032 / 76:6204 | Active/Memory selection and tab/event/album callbacks. Reference cards/grid remain deterministic; no live RSVP query. |
| DIPProfileScreen | 76:4016 | Tab/memory callbacks, original curved header/portrait/tags/mosaic. Native edit form changes local preview name, department, city and interests; empty name cannot save. |
| DIPParticipantsScreen | 76:4932 | Back/chat callbacks and all17 original participant rows; no roster query or user lookup. |
| DIPAlbumScreen | 46:1995 | Back callback; original album, local photo imports/viewing, native sharing. No cloud upload or photo authorization adapter. |
| DIPEventChatFixture | Annotation only; no high-fidelity chat frame | Local messages/composer supporting screen; no server, membership check or persistent chat. |

Other events use synthetic detail data in the same Puppy Yoga view template. Every memory entry opens the same supplied reference album. These are explicit fixture boundaries, not proof that all production destinations/data variants are implemented.

## State and accessibility handoff

Use identical mock content for standard-size screenshot review. Preserve original typography, photo crops and selected navigation. Supporting native forms/sheets have no supplied exact reference. Manual large text, VoiceOver, contrast, RTL and physical-device review remain open.

Original white-on-purple/yellow accents and duplicate Join affordances are retained for fidelity; do not claim the source usability concerns are resolved. Production integration must reconcile those findings explicitly rather than quietly changing the comparison target.

Feature owners supply loaded/authorized media and asynchronous repository state. Foundation code owns reusable rendering/callback APIs; no backend side effects occur here. Coordinate token, resource, package and API changes with the integrator before dependent agents edit consumers. Verified Code Connect mappings are still absent.

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
