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

--large-text requests Accessibility 3 for applicable review. It does not imply the exact standard-size reference has a reviewed large-text equivalent. Only light appearance is supplied.

## Interaction boundaries

Navigation, join state, profile edits, chat messages and local photo imports work in the prototype. State is local; these are not Firebase account, authorization, persistence, RSVP, chat or upload implementations. Native ShareLink/system sheets handle sharing. Rewards, notifications and challenge workflows remain explicit notices.

Only Puppy Yoga has supplied detail/Joined frames. Other events use synthetic details in the same template, and all memory links open the provided reference album. Supporting edit/chat/photo-viewer/system-picker UI has no corresponding supplied high-fidelity frame.

All eight simulator tests, asset/font checks and same-viewport comparisons are complete; numerical differences and manual-review limits are recorded. Home's previous evidence remains in Review; expanded state artifacts belong under Review/Screens/<screen>. See [review notes](Review/README.md), [asset provenance](../../docs/design/asset-provenance.md) and the active session before claiming completion.
