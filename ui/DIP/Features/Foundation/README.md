# UI fixtures and integration handoff

DIPPrototypeApp connects native Home, Puppy Yoga Event Details/Joined, My Events/Memory grid, Profile, Participants and Album. The standalone host and DIP startup use the same local fixture composition. The original Figma is the visual target, using matching mock content and bundled resources; expanded screenshot and simulator verification is recorded in the review notes.

Launch arguments such as --screen=event, --screen=event-joined or --screen=profile select an initial state; see the preview host table for every supported value. Home is the default. --gallery opens DIPFoundationGallery for isolated candidate APIs and states; its earlier visual substitutions are not the screen design standard.

The root owns navigation and injects DIPRepository; DIPAppViewModel observes product state and coordinates commands. Profile edits, chat messages, photo comments and imports use asynchronous repository commands; viewers and sharing use native presentation. They do not initialize Firebase, authorize accounts, persist server RSVP or upload to cloud storage. Other event detail content is synthetic in the Puppy Yoga template; memory IDs select explicit album projections seeded with the supplied photos. Rewards, notifications and challenge workflows remain notices.

Consumers map DTO/domain state into presentation values. Production features own formatting, image authorization/loading, async commands and repository integration. Shared views receive values/callbacks; Firestore snapshots, callable clients and raw backend errors do not belong in them. Preserve the [resource provenance](../../../../docs/design/asset-provenance.md).

See [component contracts](../../../../docs/design/components.md), [preview host](../../../ComponentPreview/README.md) and [visual review notes](../../../ComponentPreview/Review/README.md). Manual accessibility, contrast, RTL and physical-device checks remain open; passing fixture checks does not establish completed product workflows.
