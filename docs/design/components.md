# Component contracts and Figma map

Status: **Home fidelity implementation available for review on feature/ui-foundations / PR #3**. The native Home fixture must match the original Figma, including prototype challenge content and four-icon navigation. The earlier interactive component gallery remains optional through `--gallery`. Live product workflows, including V2 challenge/rewards behavior, are not implemented. Fresh Home comparison and simulator geometry/action verification are recorded in the review notes.

Source: [Team 05 High Fidelity Prototype](https://www.figma.com/design/DCIagJo7uk5IOUGqlKzAjf/Team-05-High-Fidelity-Prototype--with-links-?node-id=35-147&m=dev). File key `DCIagJo7uk5IOUGqlKzAjf`. Home node `35:147` was inspected through Figma MCP on October 28–29, 2026. The prototype includes later-version content; it does not define release scope.

| Proposed component | Figma node | Inputs and outputs | Required states and constraints |
| --- | --- | --- | --- |
| Header presentation | `46:276` Header Bar | title, unread count, loaded avatar, notification/profile callbacks | Home uses white-on-purple title and original notification/profile pill; fixture count 5; meaningful VoiceOver names; no fetching |
| Home event card | `46:1162` Event Card | original photo, title, locality, attendee images/count, activation callback | Match image-overlay layout, crop, 163 × 205 size and typography; one activation target; accessible metadata. Gallery DIPEventCard remains a separate adapted API pending reconciliation. |
| `DIPAvatar` / `DIPAvatarGroup` | `168:2951` Coworker Profile Picture | caller-supplied loaded Image, accessible name, size, displayed avatars and overflow count | Missing image fallback; decorative avatars hidden from VoiceOver if nearby text repeats the name; avoid exposing raw URLs |
| Home navigation | `46:668` Navigation Bar/Home | Home-selected visual state and destination activation callback | Match dark four-icon pill and white Home circle; other selected-state variants are not implemented. original icons with VoiceOver names/selected traits. Gallery DIPTabBar remains a native three-tab API and is not the Home visual target. |
| Home challenge card | `46:1017` Activity | category, original mascot, participation images/count, activation callback | Include identical Fitness / 128 fixture content for Home comparison. This is presentation only; V2 challenge backend/workflows remain deferred. |
| `DIPButton` | `46:2091`, `46:1410` Join actions (Event Page `46:1397`) | label, semantic role, loading, enabled, callback | Default, pressed, disabled, loading; minimum 44 pt touch target; no duplicate event Join actions |
| `DIPStateView` | native ProgressView/ContentUnavailableView proposal | loading / empty / error presentation, optional retry callback | Distinct loading and empty states; retry labels describe the action; no raw backend errors |

These are presentation contracts, separate from transport models. Feature code maps shared contract objects to component inputs. Avoid passing Firestore snapshots or callable clients to components.

For each implementation PR, add a small contract file or documentation section covering API, state table, VoiceOver, Dynamic Type, asset provenance, previews, and Figma node link. Add a real Code Connect mapping only after that component exists and its variants match the design. No mapping is registered in this setup.

## Ownership and handoff

The UI foundations workstream implements and reviews these reusable components under `ui/Packages/DIPDesignSystem`. It owns the component contracts, tokens, accessibility behavior, previews, and tests. Feature owners map their domain/transport data to presentation inputs and own feature layouts in `ui/DIP/Features`. Backend owners do not edit presentation components. Agree on any API change in this specification before dependent agents change consumers.

For a new component, the handoff is: claim component files, review the exact Figma node, propose the SwiftUI initializer and state table here, implement it with semantic tokens, and provide previews/tests and consumer migration notes. Consumers may use their own temporary local presentation stubs while implementation is pending, but must not add competing shared components.

## Existing gallery APIs and state handoff

These APIs describe the retained gallery implementation. They are not evidence that Home matches Figma. The October 29 fidelity direction supersedes their visual substitutions for Home; confirm a shared API migration with consumers before treating the fixture as production composition.

| API | Candidate input / behavior |
| --- | --- |
| DIPHeader | title, optional person/loaded avatar, unread count, optional profile/notification callbacks. Absent callbacks hide unavailable actions; accessibility text stacks controls. |
| DIPEventCard | DIPEventCardContent, DIPEventImage, attendee identities and image resolver, one activation callback. Missing strings get explicit unconfirmed labels; date/location/attendance and joined value are accessible. |
| DIPAvatar / DIPAvatarGroup | Stable IDs and names plus already-loaded images. Initials/person fallback; deduplicated visible identities and nonnegative overflow; aggregate attendee label. Decorative instances are hidden when redundant. |
| DIPTabBar | Binding<DIPDestination> plus destination content. Native TabView, labeled Home/My Events/Profile, calendar icon and native selected trait. No V2 reward tab. |
| DIPButton | title, primary/secondary/destructive emphasis, feature-owned loading/enabled flags and callback. Loading/disabled buttons cannot activate; loading retains the action's accessible name and adds In progress. |
| DIPStateView | loading/empty/failure state with user-facing strings, optional retry title/callback for failure. No raw backend errors or data loading. |

Shared APIs are in ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Components. Foundation presentation values are independent of Firebase. Home resources and registered custom fonts are under Sources/DIPDesignSystem/Resources; see [asset provenance](asset-provenance.md). System typography in the earlier gallery must not be mistaken for Figma parity. Only light appearance is specified; dark-mode semantics remain pending.

See [fixture usage](../../ui/DIP/Features/Foundation/README.md), [preview host](../../ui/ComponentPreview/README.md) and [visual review notes](../../ui/ComponentPreview/Review/README.md). API compatibility should be confirmed with consuming workstream owners before stabilization. No Code Connect mapping has been registered.
