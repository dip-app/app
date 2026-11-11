# Native prototype preview host

This separate development app has no Firebase dependency. It defaults to DIPPrototypeApp at Home and connects Event Details, My Events, Profile, Participants and Album using local fixtures. DIP startup presents the same prototype. The optional developer state gallery remains available with --gallery.

From the repository root, with Xcode, an installed iPhone simulator runtime and XcodeGen:

```sh
python3 ui/ComponentPreview/verify.py
```

Pass --device UDID to select a simulator and --derived-data /tmp/dip-preview-build to reuse output. Automatic selection is suitable for interactions; visual comparison requires a 402 × 874 logical viewport. Open ui/ComponentPreview/DIPFoundationPreview.xcodeproj, scheme Preview, for manual review.

## Review destinations

Set an Xcode scheme launch argument or simulator launch argument:

| Argument | Initial state |
| --- | --- |
| --screen=home | Original Home; default |
| --screen=event | Puppy Yoga before joining |
| --screen=event-joined | Original Joined state |
| --screen=events | My Events, Active Events |
| --screen=memories | My Events, Memories |
| --screen=profile | Original Profile |
| --screen=attendees | 17 Participants |
| --screen=album | Original Album |
| --gallery | Earlier isolated component/state gallery |
| --home-theme=live | Home with the weekly theme read through WeeklyChallengeFeed and a fake source (Fitness, 128) |
| --home-theme-count=0, 1 or 128 | With --home-theme=live: participant-count variants |
| --home-theme=none / error / loading / offline / unknown | No theme this week (empty card), failed read with in-place retry (first read fails), skeleton, cached card marked stale, unknown catalog key (title-only fallback) |

--large-text requests Accessibility 3 for applicable review. It does not imply the exact standard-size reference has a reviewed large-text equivalent. Only light appearance is supplied.

## Interaction boundaries

Navigation is local UI state. Join/profile/message/photo data passes through the injected DIPRepository and is retained for the life of its mock adapter; these are not Firebase account, authorization, persistence, RSVP, chat or upload implementations. Native ShareLink/system sheets handle sharing. Notifications remain an explicit notice. Rewards is a mock-backed page (local entries, no real redemption); review it with --screen=rewards and --rewards-state=empty. The weekly challenge opens a read-only detail; submissions are V2.

Only Puppy Yoga has supplied detail/Joined frames. Other events use synthetic details in the same template, and memory IDs select explicitly keyed albums seeded with the provided reference photos. Supporting edit/chat/photo-viewer/system-picker UI has no corresponding supplied high-fidelity frame.

The pre-motion revision passed eight simulator tests, asset/font checks and same-viewport comparisons. The current persistent-navigation correction and repository integration have fresh tests, eight endpoint captures, and motion/conversation GIF evidence. Home's previous evidence remains in Review; expanded state artifacts belong under Review/Screens/<screen>. See [review notes](Review/README.md), [asset provenance](../../docs/design/asset-provenance.md) and the active session before claiming completion.

## Motion review

Read [motion architecture and state contracts](../../docs/design/motion.md) before changing shared navigation. DIPPrototypeApp owns one bottom component outside page transitions. Composed features set showsBottomBar=false; standalone fixtures can include their own complete-frame footer. Validate marker travel/icon crossfades, Action/Complete fades, Active/Memory movement, side-entering pages and Reduced Motion. New Past Event and separate photo-selection pages remain deferred.

Use a dedicated test simulator while someone explores the installed playable app; pass --device explicitly rather than allowing automatic device selection. On the current development Mac, playable iPhone 17 Pro 16B68013-4977-4EC6-8EF5-464F5405D761 is separate from test device 25A03B8F-E5D6-42A7-A1DF-47BE901D77CF. Those local IDs are not portable configuration. The currently installed playable build includes verified motion, repository state, native chat/photo comments and opaque bottom-action presses.

## Repository integration

See [repository mapping](../../docs/contracts/ui-repositories.md) and [DIPCore](../Packages/DIPCore/README.md). Feature screens do not import mock data or Firebase. The host chooses DIPMockRepository; a future Firebase DIPRepository can be injected without replacing screen layout or callbacks. Current mocks do not simulate production security, capacity policy or cloud persistence.
