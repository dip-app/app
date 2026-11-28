// English copy for the bugs area. Keys start with "bugs.". US English, no em dashes. See docs/design/admin-i18n.md.

export const bugs = {
  // Page
  "bugs.title": "Bug reports",
  "bugs.subtitle": "What people send with shake-to-report or from Profile. Only admins can see these, including who sent them.",
  "bugs.brief": "Only admins see these, including who sent them.",
  "bugs.loading": "Loading bug reports",
  "bugs.list.label": "Reports",

  // Status and category labels
  "bugs.status.all": "All",
  "bugs.status.new": "New",
  "bugs.status.triaged": "Triaged",
  "bugs.status.resolved": "Resolved",
  "bugs.category.bug": "Bug",
  "bugs.category.confusing": "Confusing",
  "bugs.category.looksWrong": "Looks wrong",
  "bugs.category.idea": "Idea",
  "bugs.category.unspecified": "No category",

  // Screens the report came from
  "bugs.screen.home": "Home",
  "bugs.screen.rewards": "Rewards",
  "bugs.screen.myEvents": "My events",
  "bugs.screen.profile": "Profile",
  "bugs.screen.event": "Event",
  "bugs.screen.participants": "Participants",
  "bugs.screen.album": "Album",
  "bugs.screen.challenge": "Challenge",
  "bugs.screen.other": "Other",

  // Diagnostics labels
  "bugs.diag.appVersion": "App version",
  "bugs.diag.os": "OS",
  "bugs.diag.device": "Device",
  "bugs.diag.language": "Language",
  "bugs.diag.screen": "Screen",
  "bugs.diag.install": "Install",

  // Filters
  "bugs.filterByStatus": "Filter by status",
  "bugs.search.label": "Search reports",
  "bugs.search.placeholder": "Text, person or screen",
  "bugs.filters.category": "Category",
  "bugs.filters.allCategories": "All categories",
  "bugs.filters.from": "From",
  "bugs.filters.to": "To",
  "bugs.filters.clear": "Clear filters",
  "bugs.filters.rangeBad": "The end date is before the start date.",
  "bugs.counts.capped": "Counts cover the newest 1,000 reports. Older ones are still listed as you load more.",

  // Empty states
  "bugs.empty.noMatches.title": "No matches",
  "bugs.empty.noMatches.body": "Try a different search, category or date range.",
  "bugs.empty.all.title": "No reports yet",
  "bugs.empty.all.body": "When someone shakes their phone and sends feedback, it shows up here.",
  "bugs.empty.new.title": "Inbox zero",
  "bugs.empty.new.body": "Nothing new to look at. Reports that need triage appear here.",
  "bugs.empty.triaged.title": "Nothing triaged",
  "bugs.empty.triaged.body": "Reports you have looked at but not closed wait here.",
  "bugs.empty.resolved.title": "Nothing resolved yet",
  "bugs.empty.resolved.body": "Closed reports are kept here for reference.",
  "bugs.empty.pick.title": "Pick a report",
  "bugs.empty.pick.body": "Choose one from the list to read it and triage it.",

  // Result count
  "bugs.count.showingOf": "Showing {shown} of {total, plural, one {# report} other {# reports}}",
  "bugs.count.soFar": "{shown} reports so far",
  "bugs.count.matches": "{shown, plural, one {# report matches} other {# reports match}}",

  // List items
  "bugs.item.noDescription": "No description",
  "bugs.item.screenshot": "Screenshot",
  "bugs.item.note": "Note",
  "bugs.item.tryAgain": "Try again",

  // Detail
  "bugs.detail.label": "Bug report from {name}",
  "bugs.detail.allReports": "All reports",
  "bugs.detail.loading": "Loading report",
  "bugs.detail.sentShake": "Sent {when} from {screen} by shaking the phone.",
  "bugs.detail.sentProfile": "Sent {when} from {screen} in Profile.",
  "bugs.detail.loadFailed": "Couldn’t load this report. Check your connection and try again.",
  "bugs.detail.wrote": "What they wrote",
  "bugs.detail.noDescription": "No description.",
  "bugs.detail.screenshot": "Screenshot",
  "bugs.detail.shotGone": "The screenshot is no longer available.",
  "bugs.detail.shotNone": "No screenshot was attached.",
  "bugs.detail.diagnostics": "Diagnostics",
  "bugs.detail.noDiagnostics": "The app didn’t include diagnostics.",

  // Screenshot viewer
  "bugs.shot.expired": "The screenshot link expired or couldn’t be loaded.",
  "bugs.shot.reload": "Reload report",
  "bugs.shot.viewLabel": "View full size: screenshot from {who}",
  "bugs.shot.alt": "Screenshot from {who}",
  "bugs.shot.viewFull": "View full size",
  "bugs.shot.dialog": "{who}’s screenshot",
  "bugs.shot.close": "Close",

  // Triage form
  "bugs.triage.title": "Triage",
  "bugs.triage.status": "Status",
  "bugs.triage.assignee": "Assigned to",
  "bugs.triage.unassigned": "Unassigned",
  "bugs.triage.formerAdmin": "Former admin",
  "bugs.triage.note": "Internal note",
  "bugs.triage.notePlaceholder": "Repro steps, ticket link, decision",
  "bugs.triage.hint": "Only admins see this. {length}/{max}",
  "bugs.triage.hintSaved": "Only admins see this. {length}/{max} · Last saved {when}",
  "bugs.triage.hintSavedBy": "Only admins see this. {length}/{max} · Last saved {when} by {name}",
  "bugs.triage.conflict": "Someone else updated this report. Reload it to see their changes, then save again.",
  "bugs.triage.reload": "Reload report",
  "bugs.triage.saving": "Saving…",
  "bugs.triage.save": "Save changes",
  "bugs.triage.copied": "Copied",
  "bugs.triage.copy": "Copy as issue text",
  "bugs.triage.copiedStatus": "Issue text copied to the clipboard",
  "bugs.triage.copyFailed": "Couldn’t copy. Select the text and copy it yourself.",
  "bugs.triage.noChanges": "No changes to save",
  "bugs.triage.saved": "Saved.",
  "bugs.triage.nothingToChange": "Nothing to change.",
  "bugs.item.assignedTo": "Assigned to {name}",
};
