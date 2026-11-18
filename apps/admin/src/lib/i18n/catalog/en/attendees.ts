// English copy for the attendees and album pages. Keys start with "attendees." and "album.". US English, no em dashes. See docs/design/admin-i18n.md.

export const attendees = {
  // Attendees page: shell and loading
  "attendees.title": "Attendees",
  "attendees.subtitle": "Who is going, who showed up. Changes are recorded in the audit log.",
  "attendees.loading": "Loading attendees",
  "attendees.backToEvents": "Back to events",

  // Toolbar
  "attendees.allEvents": "All events",
  "attendees.going": "{count} of {capacity} going",
  "attendees.checkedInCount": "{count} checked in",
  "attendees.exportCsv": "Export CSV",
  "attendees.addAttendee": "Add attendee",

  // Add panel
  "attendees.add.panel": "Add attendee",
  "attendees.add.heading": "Add a member as going",
  "attendees.add.searchLabel": "Search members by name or email",
  "attendees.add.button": "Add",
  "attendees.add.noMatch": "No active members match.",
  "attendees.add.loadingMembers": "Loading members…",

  // Search and results
  "attendees.search.label": "Search attendees",
  "attendees.search.placeholder": "Search attendees (press / to focus)",
  "attendees.empty.title": "Nobody is going yet",
  "attendees.empty.body": "Add members yourself, or they can join from the app.",
  "attendees.noMatches.title": "No matches",
  "attendees.noMatches.body": "Try a different name, email or department.",
  "attendees.count.matches": "{shown} of {total} attendees match",
  "attendees.count.total": "{count, plural, one {# attendee} other {# attendees}}",

  // Table
  "attendees.table.label": "Attendees for {title}",
  "attendees.table.name": "Name",
  "attendees.table.department": "Department",
  "attendees.table.rsvp": "RSVP",
  "attendees.table.attendance": "Attendance",
  "attendees.table.actions": "Actions",
  "attendees.table.addedByStaff": "Added by staff",
  "attendees.status.checkedIn": "Checked in",
  "attendees.status.noShow": "No-show",
  "attendees.status.notCheckedIn": "Not checked in",
  "attendees.action.undo": "Undo",
  "attendees.action.checkIn": "Check in",
  "attendees.action.undoCheckInFor": "Undo check-in for {name}",
  "attendees.action.checkInFor": "Check in {name}",
  "attendees.action.opensAtStart": "Attendance opens when the event starts",
  "attendees.action.remove": "Remove",
  "attendees.action.removeNamed": "Remove {name}",

  // Toasts
  "attendees.toast.checkedIn": "{name}: checked in.",
  "attendees.toast.notCheckedIn": "{name}: marked as not checked in.",
  "attendees.toast.pointsAwarded": "{count} points awarded.",
  "attendees.toast.undone": "Check-in undone for {name}.",
  "attendees.toast.exported": "{count, plural, one {Exported # attendee.} other {Exported # attendees.}}",
  "attendees.toast.exportFailed": "The export didn’t finish. Try again.",
  "attendees.toast.nowGoing": "{name} is now going.",
  "attendees.toast.removed": "{name} was removed from the event.",

  // Add dialog
  "attendees.addDialog.title": "Add {name}?",
  "attendees.addDialog.confirm": "Add as going",
  "attendees.addDialog.busy": "Adding…",
  "attendees.addDialog.reason": "Why is the event going over capacity?",
  "attendees.addDialog.body": "They are marked as going and get the event’s default notifications.",
  "attendees.addDialog.full": "The event is full ({capacity} places). Adding them raises the capacity by one and needs a reason.",
  "attendees.notify.label": "Notify them",
  "attendees.notify.addedHint": "Sends a notification that they were added.",
  "attendees.notify.removedHint": "Sends a notification that they were removed.",

  // Remove dialog
  "attendees.removeDialog.title": "Remove {name}?",
  "attendees.removeDialog.confirm": "Remove from event",
  "attendees.removeDialog.busy": "Removing…",
  "attendees.removeDialog.reason": "Why is this person being removed?",
  "attendees.removeDialog.body": "Their RSVP is canceled and the going count drops by one. Attendance already recorded is kept.",

  // Album page: shell and loading
  "album.title": "Event album",
  "album.subtitle": "Photos members shared after the event. Remove anything that doesn’t belong.",
  "album.loading": "Loading album",
  "album.loadingComments": "Loading comments",

  // Photos
  "album.photoUnavailable": "Photo unavailable",
  "album.photoBy": "Photo by {name}",
  "album.allEvents": "All events",
  "album.count.photos": "{count, plural, one {# photo} other {# photos}}",
  "album.count.comments": "{count, plural, one {# comment} other {# comments}}",
  "album.empty.title": "No photos yet",
  "album.empty.body": "Members who went can add photos after the event ends. They show up here.",
  "album.grid.label": "Album photos",
  "album.tile.label": "{name}, {date}, {count, plural, one {# comment} other {# comments}}: open photo",

  // Viewer
  "album.viewer.close": "Close",
  "album.viewer.comments": "Comments ({count})",
  "album.viewer.noComments": "No comments on this photo.",
  "album.viewer.removeCommentBy": "Remove comment by {name}",
  "album.viewer.remove": "Remove",
  "album.viewer.removePhoto": "Remove photo",

  // Remove dialog
  "album.remove.photoTitle": "Remove this photo?",
  "album.remove.commentTitle": "Remove this comment?",
  "album.remove.photoConfirm": "Remove photo",
  "album.remove.commentConfirm": "Remove comment",
  "album.remove.reason": "Why is it being removed?",
  "album.remove.photoBody": "The photo, its file and all {count} comments are deleted for everyone. This can’t be undone. The removal is recorded in the audit log.",
  "album.remove.commentBody": "The comment by {name} is deleted for everyone. This can’t be undone. The removal is recorded in the audit log.",
  "album.remove.photoDone": "Photo removed. Its comments went with it and the member’s upload slot is free again.",
  "album.remove.commentDone": "Comment removed.",
};
