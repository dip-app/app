# Frontend feature modules

The current PR contains a connected local prototype: Home, EventDetails, MyEvents, Profile, Participants and Album. Prototype/DIPPrototypeApp owns local navigation and joined-event state; views receive callbacks rather than importing Firebase. Foundation retains the optional component gallery.

The supplied Figma screens and identical fixtures define visual acceptance. See [design guidance](../../../docs/design/README.md) and [screen comparisons](../../ComponentPreview/Review/README.md). Account, repository and privileged command integration remain separate workstreams; local edits, joins, messages and selected photos are not server writes.
