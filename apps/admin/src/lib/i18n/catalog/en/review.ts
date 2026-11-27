// English copy for the review area. US English, no em dashes. See docs/design/admin-i18n.md.

export const review = {
  // Page
  "review.title": "Review submissions",
  "review.subtitle": "Approve to award the points, or request changes with a note. Use J and K to move between entries, or turn the shortcuts off.",
  "review.loading": "Loading submissions",
  "review.loadingMore": "Loading more submissions",
  "review.filterLabel": "Filter submissions",
  "review.queueLabel": "Submissions",

  // Status labels
  "review.status.submitted": "Pending",
  "review.status.rejected": "Changes requested",
  "review.status.approved": "Approved",

  // Empty states
  "review.empty.submitted.title": "Nothing waiting for review",
  "review.empty.submitted.body": "New submissions show up here as people send them in.",
  "review.empty.rejected.title": "No changes requested",
  "review.empty.rejected.body": "Entries you ask to change wait here until the member resubmits.",
  "review.empty.approved.title": "Nothing approved yet",
  "review.empty.approved.body": "Approved entries, with the points they earned, are listed here.",

  // Errors
  "review.error.noTheme": "No weekly challenge was selected. Pick one from the challenges list.",
  "review.error.themeMissing": "That weekly challenge doesn’t exist.",
  "review.error.loadFailed": "Couldn’t load submissions. Check your connection and try again.",
  "review.backToChallenges": "Back to challenges",

  // Toolbar
  "review.themeMeta": "{window} · {goal}",

  // Banner
  "review.banner.dismiss": "Dismiss",
  "review.banner.changed": "{who} changed this submission while you were reviewing it. It is reloaded below: check the update, then review again.",
  "review.banner.alreadyReviewed": "{who}’s submission was already reviewed, so nothing changed. The list is up to date.",
  "review.banner.alreadyApproved": "{who}’s submission was already approved, so no points were awarded again.",
  "review.banner.alreadyRejected": "You already requested changes from {who}.",

  // Toasts
  "review.toast.approved": "Approved {who}. {points} points awarded.",
  "review.toast.rejected": "Requested changes from {who}. They can resubmit while the week is open.",
  "review.nowShowing": "Now showing {who}’s submission.",

  // Queue
  "review.queue.progress": "{progress} of {goal} {unit} · {when}",
  "review.attempt": "Attempt {n}",
  "review.noPhotoChip": "No photo",

  // Detail
  "review.detail.label": "Submission from {who}",
  "review.detail.submitted": "Submitted {created}",
  "review.detail.submittedUpdated": "Submitted {created}, updated {updated}",
  "review.action.approve": "Approve · {points} points",
  "review.action.requestChanges": "Request changes",
  "review.nav.previous": "Previous",
  "review.nav.next": "Next",
  "review.nav.backToList": "Back to list",
  "review.nav.position": "{current} of {total}{more}",

  // Keyboard shortcuts
  "review.keys.label": "Keyboard shortcuts",
  "review.keys.hint": "Single-key shortcuts for this page. Turn them off if they get in the way.",
  "review.keys.next": "Next",
  "review.keys.previous": "Previous",
  "review.keys.approve": "Approve",
  "review.keys.requestChanges": "Request changes",
  "review.keys.press": "Press {key} for {action}",
  "review.keys.pressNext": "next",
  "review.keys.pressPrevious": "previous",
  "review.keys.pressApprove": "approve",
  "review.keys.pressRequestChanges": "request changes",

  // Facts and note
  "review.facts.progress": "Progress",
  "review.facts.progressValue": "{progress} of {goal}",
  "review.facts.reward": "Reward",
  "review.facts.rewardValue": "{points} points",
  "review.note.heading": "Member’s note",
  "review.note.none": "No note.",
  "review.evidence.heading": "Evidence",

  // Result lines
  "review.result.approved": "Approved. {points} points awarded. Approvals are final.",
  "review.result.approvedOn": "Approved on {when}. {points} points awarded. Approvals are final.",
  "review.result.rejected": "Changes requested. It stays here until the member resubmits.",
  "review.result.rejectedOn": "Changes requested on {when}. It stays here until the member resubmits.",

  // Evidence picture
  "review.photo.none": "No photo. This is a note-only entry.",
  "review.photo.failed": "The photo couldn’t be loaded.",
  "review.photo.loading": "Loading photo",
  "review.photo.viewAria": "View full size: photo from {who}",
  "review.photo.alt": "Evidence from {who}",
  "review.photo.viewFull": "View full size",
  "review.photo.dialogLabel": "{who}’s photo",
  "review.photo.close": "Close",

  // Approve dialog
  "review.approve.title": "Approve {who}?",
  "review.approve.confirm": "Approve and award {points} points",
  "review.approve.busy": "Approving…",
  "review.approve.summaryPhoto": "{progress} of {goal}, with a photo.",
  "review.approve.summaryNoPhoto": "{progress} of {goal}, no photo.",
  "review.approve.pointsBold": "{points} points",
  "review.approve.addedNow": "are added to {who}’s balance now. Approvals are final and can’t be undone.",

  // Request changes dialog
  "review.reject.title": "Request changes from {who}?",
  "review.reject.confirm": "Request changes",
  "review.reject.busy": "Requesting changes…",
  "review.reject.reasonLabel": "What should they change?",
  "review.reject.reasonHint": "The member sees this note.",
  "review.reject.body": "{who} gets your note and the submission goes back to them. They can edit and resubmit while the week is open.",
};
