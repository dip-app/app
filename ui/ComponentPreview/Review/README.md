# Native prototype review — October 29, 2026

[PR #3](https://github.com/dip-app/app/pull/3), branch feature/ui-foundations, [issue #2](https://github.com/dip-app/app/issues/2). The runnable app connects Home, Event Details/Joined, My Events/Memories, Profile, Participants and Album, plus native activity chat and photo discussions. Product values and commands pass through DIPRepository/DIPAppViewModel; DIPMockData is injected only at composition. Firebase is unimplemented.

## Current interaction evidence

- [Navigation marker/action transitions](Motion/navigation.gif), [sections](Motion/sections.gif), [page transitions](Motion/pages.gif).
- [Opaque held press](Motion/opaque-press.gif): the action button darkens without exposing underlying tabs. [Pressed frame](Motion/pressed-state.png).
- [Activity chat](Conversations/chat.gif): attributed/timestamped messages, native multiline composer, failed send/retry and reopening. [Still](Conversations/chat.png).
- [Photo comments](Conversations/photo-comments.gif): floating photo, owner attribution, native keyboard-safe composer, four compact avatar-first edge pills, centered expansion/scrolling, retained comments and per-photo isolation. [Still](Conversations/photo-comments.png).

Both frontend features were explicitly flagged unfinished and only unflagged after tests passed; [status](../../../docs/milestones/v2/FEATURE_STATUS.md) keeps backend work separate. Activity chat is a native design-system composition, because no exact chat frame was supplied. Photo overlay layout derives from inspected Figma76:1884/76:2021; the native close/material treatment remains an explicit asset/rendering fidelity difference. OS keyboards are real native UI.

One persistent bottom component stays outside page transitions. It slides its selection marker, crossfades icons and fades Action/Complete overlays. Cached native page hosts preserve tab state. See [motion contracts](../../../docs/design/motion.md). Native internal page timing is not claimed to reproduce an exact exported curve; Reduced Motion needs manual verification.

## Verification

- Nine UI tests passed for the initial repository integration. Seven final conversation/motion/connected-flow regression tests passed in118.636seconds. The two conversation tests passed again after final error-contrast polish. Across these runs, all13 distinct current UI tests were exercised; this is not a claim that a single local12-test run was made.
- Tests cover source geometry, carousel gestures, navigation, shared Join state, cached Profile edits, album viewer, fixed bar position, covered tab hit testing, a1.5-second held press, chat/comment failures and safe retries, close/reopen retention and event/photo thread isolation. The photo test explicitly checks the send button is above the keyboard. It caught and drove removal of competing manual keyboard layout.
- Full DIP simulator build passed. All25 Swift tests passed:1 contracts,9 design-system,10 mock/domain and5 presentation. Independent adapter tests prove command acknowledgements do not fabricate read state. Repository/generated-file/docs/session checks and8 baseline Firebase emulator rules tests passed; existing Functions product TODOs remain unimplemented.
- Original114 image/SVG resources and7 font files remain bundled, exposing8 named faces. No screenshot is used as app artwork. See [provenance](../../../PROVENANCE.md).

CI's last published green baseline is [afa1470](https://github.com/dip-app/app/actions/runs/40911603057); it predates this change. Current publication CI is reported on the PR, not inferred from this local evidence.

## Original screen comparisons

Figma file DCIagJo7uk5IOUGqlKzAjf. Same402×874-point viewport, stable native captures and exact integer simulator scaling. Each Screens/<screen>/ directory contains its original cropped reference, current native capture, comparison, overlay, difference and numeric report. [Summary](Screens/summary.json) and [overview](Screens/overview.png).

| Launch argument | Original frame | Mean absolute app-region channel difference /255 |
| --- | --- | --- |
| --screen=home | 35:147 | 2.1574 |
| --screen=event | 46:1397 | 3.0603 |
| --screen=event-joined | 76:1742 | 2.9277 |
| --screen=events | 76:6032 | 1.6675 |
| --screen=memories | 76:6204 | 2.7476 |
| --screen=profile | 76:4016 | 3.2476 |
| --screen=attendees | 76:4932 | 2.1921 |
| --screen=album | 46:1995 | 5.4312 |

The comparison masks rounded-frame/OS chrome regions; rasterizers and image filters differ. Nonzero scores are not zero-pixel fidelity or human approval. Current overlay/chat screenshots are separate evidence, without an independent pixel comparison to a newly retrieved overlay render.

Source MCP sessions: Home be39ee55-d9c7-4f0a-9060-c6a86dbffcc7, expanded screens0cf05e71-dfb2-4c4a-92f3-db6358767921, motion/overlay inspection3e1280af-413b-44c3-aa9f-76a159a5152c. Navigation component46:637 supplies the shared variants; interactive reactions supply0.3-second EASE_OUT page pushes and0.625061452-second SLOW section pushes, without exported spring coefficients.

## Run and remaining work

Default launch is Home. Use --gallery for isolated foundations; see [host instructions](../README.md). The verified actual DIP app is installed on the development review simulator; tests use a separate device. Local simulator IDs are not portable project settings.

Open a joined event's Activity Chat, or Album→photo→comment. The mock retains changes across navigation for its adapter lifetime and resets on app restart. It does not implement account authorization, production persistence, cross-device delivery, capacity policy or deployed Firebase functions. The [repository handoff](../../../docs/contracts/ui-repositories.md) defines the adapter replacement path.

Past Event detail, Rewards/challenge/notification workflows, manual VoiceOver/larger-text/RTL/contrast, Reduced Motion, physical-device checks and image release rights remain open. Only Puppy Yoga has supplied detail/Joined references; other event details are synthetic. Memory albums have distinct IDs but initially reuse reference photos. No merge or cloud deployment is part of this delivery.

## November1 photo correction

The prior below-image thread was rejected by the human. Current [compact view](Conversations/photo-comments.png) and [expanded view](Conversations/photo-comments-expanded.png) implement the human-defined four small avatar-leading pills, slight image overlap, ellipsis preview, centered full text and native scrolling after about four lines. Three conversation tests passed; the visual capture test passed again with screenshots attached. The full actual DIP build and all25 Swift package tests pass. Current original-frame captures remain unchanged for default empty-comment state.
