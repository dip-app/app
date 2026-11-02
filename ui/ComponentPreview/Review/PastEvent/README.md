# Past-event review

Native simulator captures, iPhone 17 Pro / iOS 27, 402 × 874 points. Cached Figma frame 46:1755 supplies the past-event layout and Kayaking copy; existing asset metadata maps the exact cover and five avatar resources. Figma MCP was unavailable for a fresh full-frame screenshot comparison. No zero-pixel-equivalence claim.

- [Initial detail](detail.png)
- [Scrolled photo preview](photos.png)
- [Existing participant page with past-event album action](attendees.png)

Run the isolated preview with `--screen=past-event`, or choose My Events → Memories → Kayaking. Tap View Album or a photo preview to open the album; back returns to the detail. Upcoming events retain their original flow. Photo/participant data are repository-backed fixtures, not a deployed tenant feed. The album/gallery functionality remains later-release prototype scope.

Validation: four targeted UI tests pass (past-event plus existing screen flows); final corrected capture test passes again; all 16 DIPCore tests pass. Production adapter must derive isPast from Event.endTime. Wire contracts are unchanged.
