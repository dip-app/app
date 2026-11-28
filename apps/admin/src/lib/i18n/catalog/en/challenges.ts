// English copy for the challenges area. Keys start with "challenges.". US English, no em dashes. See docs/design/admin-i18n.md.
// Challenge titles and descriptions are server content and never go through t().

export const challenges = {
  // Challenges page: Schedule (plan and edit) and Review (submissions)
  "challenges.title": "Challenges",
  "challenges.subtitle": "Plan the weekly challenge members see on the app’s Home screen, and review what they submit.",
  "challenges.tabsLabel": "Challenges",
  "challenges.tab.schedule": "Schedule",
  "challenges.tab.review": "Review",
  "challenges.review.intro": "Approve an entry to award the points, or ask for changes.",
  "challenges.loading": "Loading challenges",
  "challenges.empty.title": "Nothing to review yet",
  "challenges.empty.body": "Submissions appear here once a weekly challenge has started.",
  "challenges.empty.action": "Open the schedule",

  // Status chip on a theme
  "challenges.phase.current": "This week",
  "challenges.phase.upcoming": "Upcoming",
  "challenges.phase.past": "Past",

  // Review list rows
  "challenges.table.label": "Challenges",
  "challenges.table.caption": "Challenges, this week first, then upcoming and past",
  "challenges.table.challenge": "Challenge",
  "challenges.table.dates": "Week",
  "challenges.table.goal": "Goal",
  "challenges.table.joined": "Participation",
  "challenges.table.pending": "Pending",
  "challenges.table.action": "Action",
  "challenges.row.noteUpcoming": "Reviews open when the week starts",
  "challenges.row.notePast": "Reviews stay open after the week ends",
  "challenges.row.noteCurrent": "Review as entries arrive",
  "challenges.row.noneYet": "None yet",
  "challenges.row.loadingPending": "Loading pending count",
  "challenges.row.pending": "{count} pending",
  "challenges.row.review": "Review submissions",
  "challenges.row.reviewAria": "Review submissions for {title}, {window}",

  // Schedule tab
  "challenges.themes.new": "New challenge",
  "challenges.themes.loadFailed": "Couldn’t load challenges. Check your connection and try again.",
  "challenges.themes.filterLabel": "Show challenges by week",
  "challenges.themes.tab.current": "This week",
  "challenges.themes.tab.upcoming": "Upcoming",
  "challenges.themes.tab.past": "Past",
  "challenges.themes.empty.current.title": "No challenge this week",
  "challenges.themes.empty.current.body": "Members see the Home challenge card only while a challenge runs. Add one for this week or plan the next.",
  "challenges.themes.empty.upcoming.title": "Nothing planned",
  "challenges.themes.empty.upcoming.body": "Plan the next weeks so Home always has a challenge on Monday.",
  "challenges.themes.empty.past.title": "No past challenges",
  "challenges.themes.empty.past.body": "Challenges move here once their last day ends.",

  // Schedule table
  "challenges.themes.table.label": "Challenge schedule",
  "challenges.themes.table.theme": "Challenge",
  "challenges.themes.table.week": "Week",
  "challenges.themes.table.goal": "Goal",
  "challenges.themes.table.reward": "Reward",
  "challenges.themes.table.participation": "Participation",
  "challenges.themes.table.actions": "Actions",
  "challenges.themes.row.editTitle": "Edit challenge",
  "challenges.themes.row.editWindowAria": "Edit {title}, {window}",
  "challenges.themes.row.editAria": "Edit {title}",
  "challenges.themes.row.edit": "Edit",
  "challenges.themes.row.joined": "{count, plural, =0 {No one joined} other {# joined}}",
  "challenges.themes.row.joinedCompleted": "{joined} joined · {completed} completed",

  // Dates, goals and rewards
  "challenges.window.range": "{start} to {end}",
  "challenges.weeks.weekOf": "Week of Mon, {date}",
  "challenges.weeks.endLabel": "Sun, {date}",
  "challenges.weeks.endLabelOneWeek": "Sun, {date} (1 week)",
  "challenges.weeks.endLabelTwoWeeks": "Sun, {date} (2 weeks)",
  "challenges.weeks.easternTime": "Eastern Time",
  "challenges.reward": "+{points} points",

  // Validation messages for the challenge form
  "challenges.validation.title": "Title must be 1 to {max} characters.",
  "challenges.validation.description": "Description must be 1 to {max} characters.",
  "challenges.validation.cover": "Pick an illustration from the list.",
  "challenges.validation.goal": "Goal must be more than 0 and at most {max}.",
  "challenges.validation.unit": "Unit must be 1 to {max} characters.",
  "challenges.validation.points": "Points must be a whole number from 0 to {max}.",
  "challenges.validation.startDate": "Choose the first week.",
  "challenges.validation.endDate": "Choose the last week.",
  "challenges.validation.endBeforeStart": "The last week can’t end before the first week starts.",
  "challenges.validation.tooLong": "A challenge can run for at most {max} days (two weeks).",
  "challenges.validation.passed": "These weeks have already passed. Pick this week or a later one.",
  "challenges.validation.tagsUnknown": "Choose tags from the list.",
  "challenges.validation.tagsDuplicate": "Choose each tag once.",
  "challenges.validation.tagsMax": "Choose at most {max} tags.",
  "challenges.validation.overlap": "Overlaps “{title}” ({window}). Pick a week without a challenge.",
};
