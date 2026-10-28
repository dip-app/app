# Component contracts and Figma map

Status: **specified for implementation; no components implemented**. Names below are proposed SwiftUI APIs. Obtain design/frontend review before stabilizing an API.

Source: [Team 05 High Fidelity Prototype](https://www.figma.com/design/DCIagJo7uk5IOUGqlKzAjf/Team-05-High-Fidelity-Prototype--with-links-?node-id=35-147&m=dev). File key `DCIagJo7uk5IOUGqlKzAjf`. Home node `35:147` was inspected through Figma MCP on October 28, 2026. The prototype includes later-version content; it does not define release scope.

| Proposed component | Figma node | Inputs and outputs | Required states and constraints |
| --- | --- | --- | --- |
| `DIPHeader` | `46:276` Header Bar | title; optional unread count; avatar presentation; notification/profile callbacks | Hide unavailable V1 actions; meaningful VoiceOver labels; no data fetching |
| `DIPEventCard` | `46:1162` Event Card | title, date/time display text, locality, image source, attendee presentation, activation callback | Loading-image fallback; accessible date and location; Dynamic Type; selected/pressed state; one card activation target |
| `DIPAvatar` / `DIPAvatarGroup` | `168:2951` Coworker Profile Picture | local asset or image URL, accessible name, size, displayed avatars and overflow count | Missing image fallback; decorative avatars hidden from VoiceOver if nearby text repeats the name; avoid exposing raw URLs |
| `DIPTabBar` | `46:668` Navigation Bar/Home | selected destination; available destinations; selection callback | Visible destination labels; selected state beyond color; use a recognizable My Events icon; respect safe areas and large text |
| `DIPChallengeCard` | `46:1017` Activity | category, illustration, participation display, activation callback | V2 only; requirement and reward must be clear in the surrounding feature; never ship prototype sample counts |
| `DIPButton` | to inspect before implementation | label, semantic role, loading, enabled, callback | Default, pressed, disabled, loading; minimum 44 pt touch target; no duplicate event Join actions |
| `DIPStateView` | to design before implementation | loading / empty / error presentation, optional retry callback | Distinct loading and empty states; retry labels describe the action; no raw backend errors |

These are presentation contracts, separate from transport models. Feature code maps shared contract objects to component inputs. Avoid passing Firestore snapshots or callable clients to components.

For each implementation PR, add a small contract file or documentation section covering API, state table, VoiceOver, Dynamic Type, asset provenance, previews, and Figma node link. Add a real Code Connect mapping only after that component exists and its variants match the design. No mapping is registered in this setup.

## Ownership and handoff

The UI foundations workstream implements and reviews these reusable components under `ui/Packages/DIPDesignSystem`. It owns the component contracts, tokens, accessibility behavior, previews, and tests. Feature owners map their domain/transport data to presentation inputs and own feature layouts in `ui/DIP/Features`. Backend owners do not edit presentation components. Agree on any API change in this specification before dependent agents change consumers.

For a new component, the handoff is: claim component files, review the exact Figma node, propose the SwiftUI initializer and state table here, implement it with semantic tokens, and provide previews/tests and consumer migration notes. Consumers may use their own temporary local presentation stubs while implementation is pending, but must not add competing shared components.
