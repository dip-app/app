# Photo discussion

DIPPhotoCommentsScreen composes a floating photo, DIPPhotoAttributionTag, DIPMessageComposer.photoOverlay and DIPPhotoCommentBubble. The reference is Figma 76:1884 with keyboard state76:2021, inspected earlier through the official design context. The original photo and chat-bubble SVG are bundled matches. Native material/close control and real software keyboard are used; the unavailable original back SVG is an explicit fidelity limitation.

The human defined the comment UI directly: show the newest4 compact avatar-leading pills, slightly overlapping image edges. Previews contain at most3 words and truncate in an84-point text slot. Tapping one centers its expanded bubble over the photo; long full text scrolls after about4 lines. Tapping outside collapses it. No discussion panel, author headings or timestamps are rendered. All comments remain in repository data.

The album passes an observed photo/thread/current-user projection and an asynchronous command callback. New comments come from repository observation. The screen owns only a draft, stable retry ID, pending/error/focus state and presentation. Threads are scoped by event and photo at the repository boundary; reopening uses the same adapter instance. Failed drafts stay editable, and unchanged retries retain the command ID.

Native keyboard avoidance keeps a single composer outside scrolling photo/thread content. No keyboard image, OS chrome replica or keyboard-height notification choreography belongs here. Parent flows verify the send control remains above the keyboard, failure/retry, close/reopen and photo isolation before frontend status is unflagged.

These are in-memory local features; authorization, production persistence and cross-device delivery remain future Firebase adapter/rules work. See [repository contract](../../../../docs/contracts/ui-repositories.md) and [feature status](../../../../docs/milestones/v2/FEATURE_STATUS.md).
