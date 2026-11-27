// English copy for the themeForm area. US English, no em dashes. See docs/design/admin-i18n.md.

export const themeForm = {
  // Pages (new and edit)
  "themeForm.new.title": "New challenge",
  "themeForm.new.subtitle": "Members see it on Home when its first week starts.",
  "themeForm.edit.title": "Edit challenge",
  "themeForm.edit.subtitle": "Changes appear in the app as soon as you save.",
  "themeForm.edit.loading": "Loading challenge",
  "themeForm.edit.noTheme": "No challenge was selected. Pick one on the Challenges page.",
  "themeForm.edit.loadFailed": "Couldn’t load this challenge. Check your connection and try again.",
  "themeForm.edit.backLabel": "Back to Challenges",

  // Banners
  "themeForm.fixFields": "Fix {count, plural, one {# field} other {# fields}} to continue.",
  "themeForm.reloadLatest": "Reload latest",

  // Theme picker
  "themeForm.theme": "Illustration",
  "themeForm.themeHint": "Each illustration ships with the app. Pick one to fill in a title, description, goal and tag you can still change.",
  "themeForm.whyItsFun": "Why it’s fun:",
  "themeForm.membersPost": "Members post: {prompt}",

  // Title, description, tags
  "themeForm.titleLabel": "Title",
  "themeForm.titleHint": "Shown in capitals on the app’s Home card.",
  "themeForm.description": "Description",
  "themeForm.tags": "Tags",
  "themeForm.tagsLoading": "Loading tags…",
  "themeForm.tagsError": "Couldn’t load tags.",
  "themeForm.tagsRetry": "Try again",

  // Weeks
  "themeForm.weeks": "Weeks",
  "themeForm.firstWeek": "First week",
  "themeForm.chooseWeek": "Choose a week",
  "themeForm.optionTaken": "{label} (taken: {title})",
  "themeForm.runsUntil": "Runs until",
  "themeForm.chooseLastDay": "Choose the last day",
  "themeForm.optionOverlaps": "{label} (overlaps {title})",
  "themeForm.weeksHintLocked": "The start is locked because people have joined. You can still change when it ends, as long as that isn’t in the past.",
  "themeForm.weeksHint": "Challenges run Monday 12:00 AM to Sunday 11:59 PM {zone}, for one or two weeks. Weeks that already have a challenge are marked taken.",

  // Goal and reward
  "themeForm.goalReward": "Goal & reward",
  "themeForm.goal": "Goal",
  "themeForm.unit": "Unit",
  "themeForm.pointsReward": "Points reward",
  "themeForm.pointsHint": "Added to a member’s points when an organizer approves their entry (0 to {max}).",
  "themeForm.counts": "{joined} joined · {completed} completed. These counts update as members take part.",

  // Actions, dialog, toasts
  "themeForm.saving": "Saving…",
  "themeForm.saveChanges": "Save changes",
  "themeForm.create": "Create challenge",
  "themeForm.cancel": "Cancel",
  "themeForm.discard.title": "Discard your changes?",
  "themeForm.discard.confirm": "Discard changes",
  "themeForm.discard.bodyEdit": "The changes you made to this challenge won’t be saved.",
  "themeForm.toast.saved": "Saved changes to “{title}”.",
  "themeForm.toast.created": "Created “{title}”.",

  // Errors the form authors
  "themeForm.error.overlap": "Overlaps another challenge ({window}). Pick a week without a challenge.",
  "themeForm.error.unconfirmedSave": "We couldn’t confirm whether your changes were saved. Reload the latest version to check before saving again.",
  "themeForm.error.createFailed": "Couldn’t create the challenge. Your draft is kept; trying again is safe and won’t create a duplicate.",

  // Preview
  "themeForm.preview.aria": "Preview",
  "themeForm.preview.label": "Preview: This Week’s Challenge",
  "themeForm.preview.titleFallback": "Challenge title",
  "themeForm.preview.others": "+ {count} others participating",
  "themeForm.preview.first": "Be the first this week",
  "themeForm.preview.week": "Week",
  "themeForm.preview.weekEmpty": "Pick the weeks",
  "themeForm.preview.goal": "Goal",
  "themeForm.preview.reward": "Reward",
  "themeForm.preview.notSet": "Not set",
};
