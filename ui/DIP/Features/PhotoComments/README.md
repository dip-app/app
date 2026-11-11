# Photo discussion

DIPPhotoCommentsScreen composes a floating photo, DIPPhotoAttributionTag, DIPMessageComposer.photoOverlay and DIPPhotoCommentBubble. The reference is Figma 76:1884 with keyboard state76:2021, inspected earlier through the official design context. The original photo and chat-bubble SVG are bundled matches. Native material/close control and real software keyboard are used; the unavailable original back SVG is an explicit fidelity limitation.

The human defined the comment UI directly: show the newest4 compact avatar-leading pills, slightly overlapping image edges. Previews contain at most3 words and truncate in an84-point text slot. Tapping one centers its expanded bubble over the photo; long full text scrolls after about4 lines. Tapping outside collapses it. No discussion panel, author headings or timestamps are rendered. All comments remain in repository data.

The album passes an observed photo/thread/current-user projection and an asynchronous command callback. New comments come from repository observation. The screen owns only a draft, stable retry ID, pending/error/focus state and presentation. Threads are scoped by event and photo at the repository boundary; reopening uses the same adapter instance. Failed drafts stay editable, and unchanged retries retain the command ID.

Native keyboard avoidance keeps a single composer outside scrolling photo/thread content. No keyboard image, OS chrome replica or keyboard-height notification choreography belongs here. Parent flows verify the send control remains above the keyboard, failure/retry, close/reopen and photo isolation before frontend status is unflagged.

Configured member builds now read and write comments live (`companies/{c}/events/{e}/photos/{photoId}/comments`, own-author append under rules, see [event photo albums](../../../../docs/contracts/callables.md#event-photo-albums)); the album reports the open photo so only its thread is observed. Fixtures and `--mock-member` keep the in-memory repository. See [repository contract](../../../../docs/contracts/ui-repositories.md) and [feature status](../../../../docs/milestones/v2/FEATURE_STATUS.md).

## Deferred design work: comment placement

User feedback, November 2, 2026: placing the comment bubbles only at fixed photo edges/corners looks bad. Revisit their distribution and relationship to the photo; the current four-corner arrangement is not the desired final layout. The attached example showed comments crowding corners/edges around a kayaking photo.

This is a later design task, not an instruction to invent a replacement in the current implementation. Explore and review a better placement system with the user before changing it. Preserve compact avatar-first previews, access to full text, readable photo content and usable touch targets while evaluating alternatives. Keep this open even if the current interaction tests pass; those tests verify behavior, not approval of the placement design.

November 2 interaction improvements: compact artwork stays 32 points tall but the button hit area is 44 points; expanded comments expose a named Collapse comment accessibility action. Swipe left/right across the photo, or use named Earlier/Newer comments accessibility actions, to browse groups of at most four. Incoming comments preserve an older-page anchor; a successful own send returns to the latest group. Editing clears a stale send error. These behavior changes do not resolve the deferred placement design criticism above.
