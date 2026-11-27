/**
 * English email copy (the source). Rendering with these messages must produce byte-identical output to the
 * pre-catalog templates: the golden snapshots in gcp/tests/unit/__snapshots__/email are the proof. ICU subset of
 * modules/i18n (`{slot}`, `plural`, `select`). Server content (event titles, names, idea text) arrives in slots and is
 * never translated. Keys start with `email.`.
 */
export const en = {
  // Greeting line: the template lead follows the greeting in the same paragraph.
  "email.lead.named": "Hi {name}, {lead}",
  "email.lead.anonymous": "Hi there, {lead}",
  /** Preheader with the event day appended; `sentence` has no final period. */
  "email.preheader.onDay": "{sentence} ({day}).",

  // Event card and plain-text labels
  "email.card.when": "When",
  "email.card.where": "Where",
  /** Hidden (screen reader) prefix of a struck-through old value. Keep the trailing space. */
  "email.card.was": "was ",
  "email.text.was": "(was: {value})",
  "email.time.range": "{start} to {end}",
  "email.cta.open": "Open in DIP",
  "email.badge.updated": "Updated",
  "email.badge.canceled": "Canceled",

  // Footer of the event and challenge emails
  "email.footer.reason": "You are getting this because {reason} emails are on.",
  "email.footer.unsubscribe": "Unsubscribe",
  "email.footer.manage": "Manage in DIP: {path}",
  "email.footer.profile": "Profile",
  "email.footer.notifications": "Notifications",
  "email.footer.sentBy": "Sent by DIP",
  "email.footer.questions": "Questions?",

  // Category nouns for the footer reason
  "email.reason.invites": "invite",
  "email.reason.event_updates": "event update",
  "email.reason.reminders": "reminder",
  "email.reason.challenges": "challenge",
  "email.reason.discovery": "event suggestion",
  "email.reason.calendar_invites": "calendar invite",
  "email.reason.admin_suggestions": "weekly event idea",
  "email.reason.weekly_themes": "weekly challenge",
  "email.reason.admin_digest": "daily roster digest",
  "email.reason.day_before_reminders": "day-before reminder",

  // invite_received
  "email.inviteReceived.heading": "New invitation",
  "email.inviteReceived.subject": "{who} invited you to {title}",
  "email.inviteReceived.preheader": "{who} invited you to {title}.",
  "email.inviteReceived.lead": "{who} invited you to join an event on DIP.",
  "email.inviteReceived.note": "See who is going and respond.",

  // invite_answered
  "email.inviteAnswered.heading": "{answer, select, accepted {Invitation accepted} other {Invitation declined}}",
  "email.inviteAnswered.subject": "{who} {answer, select, accepted {accepted} other {declined}} your invite to {title}",
  "email.inviteAnswered.preheader": "{who} {answer, select, accepted {accepted} other {declined}} your invite to {title}.",
  "email.inviteAnswered.lead": "{who} {answer, select, accepted {accepted} other {declined}} your invite to this event.",

  // event_changed: `what` is a joined list of the words below
  "email.eventChanged.heading": "Event updated",
  "email.eventChanged.subject": "Updated: {title} ({what} changed)",
  "email.eventChanged.preheader": "The {what} changed for {title}.",
  "email.eventChanged.lead": "the {what} changed for this event.",
  "email.change.date": "date",
  "email.change.dateAndTime": "date and time",
  "email.change.time": "time",
  "email.change.location": "location",
  "email.change.title": "title",
  "email.change.details": "details",
  "email.note.calendar": "To add it to your calendar, open the event in DIP.",

  // event_canceled
  "email.eventCanceled.heading": "Event canceled",
  "email.eventCanceled.subject": "Canceled: {title}",
  "email.eventCanceled.preheader": "{title} was canceled.",
  "email.eventCanceled.lead": "this event was canceled.",
  "email.eventCanceled.note": "Open it in DIP to see the details, then find another event to join.",

  // attendee_added
  "email.attendeeAdded.heading": "You were added",
  "email.attendeeAdded.subject": "You were added to {title}",
  "email.attendeeAdded.preheader": "You are on the guest list for {title}.",
  "email.attendeeAdded.lead": "you were added to this event.",

  // event_reminder
  "email.reminder.heading": "{window, select, day {Starts tomorrow} other {Starts in about an hour}}",
  "email.reminder.subject": "{window, select, day {Tomorrow: {title}} other {Starting in about an hour: {title}}}",
  "email.reminder.preheader": "{window, select, day {{title} is tomorrow.} other {{title} starts in about an hour.}}",
  "email.reminder.lead": "{window, select, day {{title} starts tomorrow.} other {{title} starts in about an hour.}}",

  // calendar_invite
  "email.calendarInvite.heading": "{reason, select, updated {Calendar updated} other {Add it to your calendar}}",
  "email.calendarInvite.subject": "{reason, select, updated {Updated invite: {title}} other {Calendar invite: {title}}}",
  "email.calendarInvite.preheader": "{reason, select, updated {The details changed for {title}.} other {Add {title} to your calendar.}}",
  "email.calendarInvite.lead": "{reason, select, updated {the time or place changed for this event.} other {you joined this event.}}",
  "email.calendarInvite.note": "{reason, select, updated {To update your calendar, open the attached invite. The button below opens the event in DIP.} other {To add it to your calendar, open the attached invite (invite.ics) and choose Add to calendar. The button below opens the event in DIP. If the time or place changes, we will send an updated invite.}}",

  // calendar_cancel
  "email.calendarCancel.heading": "{reason, select, left {Removed from your calendar} other {Event canceled}}",
  "email.calendarCancel.subject": "{reason, select, left {Removed from your calendar: {title}} other {Canceled: {title}}}",
  "email.calendarCancel.preheader": "{reason, select, left {{title} was removed from your calendar.} other {{title} was canceled.}}",
  "email.calendarCancel.lead": "{reason, select, left {you are no longer going to this event.} other {this event was canceled.}}",
  "email.calendarCancel.note": "The attached calendar message removes it from your calendar.",

  // challenge_reviewed
  "email.challenge.heading": "{outcome, select, approved {Submission approved} other {Changes requested}}",
  "email.challenge.subject": "{outcome, select, approved {Approved: {title}} other {Changes requested: {title}}}",
  "email.challenge.preheader": "{outcome, select, approved {Your submission for {title} was approved.} other {A reviewer asked for changes to {title}.}}",
  "email.challenge.lead": "{outcome, select, approved {your submission for “{title}” was approved.} other {a reviewer asked for changes to your submission for “{title}”.}}",
  "email.challenge.points": "{points, plural, one {+{points} point} other {+{points} points}}",
  "email.challenge.note": "See the feedback and resubmit.",

  // Account emails (roster_invite, welcome, bug_report_resolved): transactional, with their own footer reason.
  "email.cta.getApp": "Get DIP",
  "email.cta.openApp": "Open DIP",
  "email.cta.portal": "Open the admin portal",
  "email.footer.unsubscribeInvites": "Stop invitation emails",

  // roster_invite: `named` is yes when the inviting admin's first name is known; {title} is the company name.
  "email.rosterInvite.heading": "{reminder, select, yes {Your DIP invitation} other {You are invited to DIP}}",
  "email.rosterInvite.subject": "{reminder, select, yes {Reminder: join {title} on DIP} other {{named, select, yes {{who} invited you to join {title} on DIP} other {You are invited to join {title} on DIP}}}}",
  "email.rosterInvite.preheader": "{named, select, yes {{who} set you up on DIP at {company}.} other {You are set up on DIP at {company}.}}",
  "email.rosterInvite.lead": "{named, select, yes {{who} set you up on DIP, where {company} plans team events and activities.} other {you are set up on DIP, where {company} plans team events and activities.}}",
  "email.rosterInvite.note": "{staff, select, yes {Open the admin portal and sign in with Google using {address}. Your role is already assigned.} other {Get the DIP app and sign in with Google using {address}. Your teams and details are already filled in.}}",
  "email.rosterInvite.thisAddress": "this email address",
  "email.rosterInvite.ignore": "Not expecting this? You can ignore this email.",
  "email.rosterInvite.reason": "{named, select, yes {You are getting this because {who} added you to DIP at {company}.} other {You are getting this because {company} added you to DIP.}}",

  // welcome: {title} is the company name.
  "email.welcome.heading": "Welcome to DIP",
  "email.welcome.subject": "Welcome to DIP at {title}",
  "email.welcome.preheader": "You joined DIP at {company}. Here is how to get started.",
  "email.welcome.lead": "you joined DIP at {company}. Here is how to get started:",
  "email.welcome.step.portal": "Plan events and weekly challenges in the admin portal.",
  "email.welcome.step.join": "Join an event that looks fun, or invite a coworker to one.",
  "email.welcome.step.interests": "Pick your interests in Profile so events that fit you show up first.",
  "email.welcome.reason": "You are getting this because you joined DIP at {company}.",

  // bug_report_resolved
  "email.bugResolved.heading": "Problem resolved",
  "email.bugResolved.subject": "Your problem report was resolved",
  "email.bugResolved.preheader": "The problem you reported on {day} was marked resolved.",
  "email.bugResolved.lead": "the problem you reported on {day} was marked resolved. Thank you for helping us make DIP better.",
  "email.bugResolved.note": "Still seeing it? Report it again from the app: shake your phone, or go to Profile > Report a problem.",
  "email.bugResolved.reason": "You are getting this because you sent a problem report in DIP.",

  // Calendar file text (invite.ics)
  "email.ics.description": "Open in DIP: {url}",
  "email.ics.alarm": "{title} starts soon",

  // Weekly event ideas for admins (admin_suggestions)
  "email.ideas.heading": "Your weekly event ideas",
  "email.ideas.subject": "Your event ideas for the {week}",
  "email.ideas.hi.named": "Hi {name},",
  "email.ideas.hi.anonymous": "Hi,",
  "email.ideas.lead.withHistory": "{hi} {count, plural, one {here is {count} idea} other {here are {count} ideas}} for the coming weeks, picked from what your team likes and how past events went.",
  "email.ideas.lead.short": "{hi} {count, plural, one {here is {count} idea} other {here are {count} ideas}} for the coming weeks.",
  "email.ideas.topPick": "Top pick: {title}",
  "email.ideas.fit.perfect": "Perfect fit",
  "email.ideas.fit.great": "Great choice",
  "email.ideas.fit.good": "Good match",
  "email.ideas.why": "Why this idea",
  "email.ideas.start": "Start this event",
  "email.ideas.startLabel": "Start this event: {title}",
  "email.ideas.open": "Open event ideas",
  "email.ideas.footer.reason": "You are getting this because you turned on weekly event ideas for admins.",
  "email.ideas.footer.manage": "Manage in the admin portal",
  "email.ideas.text.when": "When: {hint}",

  // weekly_theme (opt-in `weekly_themes`): {title} is the theme title as the organizer wrote it.
  "email.weeklyTheme.heading": "This week's challenge",
  "email.weeklyTheme.subject": "This week's challenge: {title}",
  "email.weeklyTheme.preheader": "Runs {dates}. Join in with coworkers, then log what you did in DIP.",
  "email.weeklyTheme.lead": "a new weekly challenge just started. Join in with coworkers, then log what you did in DIP.",
  "email.weeklyTheme.dates": "{start} to {end}",
  "email.weeklyTheme.points": "{points, plural, one {Worth # point} other {Worth # points}}",
  "email.weeklyTheme.note": "You will find it on the Home screen of the DIP app.",

  // admin_digest (opt-in, admins): {day} is the company-local day the digest covers ("Thursday, November 19").
  "email.adminDigest.heading": "Roster update",
  "email.adminDigest.subject": "DIP roster update for {day}",
  "email.adminDigest.summary.joined": "{count, plural, one {# person joined} other {# people joined}}",
  "email.adminDigest.summary.imports": "{count, plural, one {# import finished} other {# imports finished}}",
  "email.adminDigest.preheader": "{summary} on {day}.",
  "email.adminDigest.lead": "here is what changed on your roster on {day}.",
  "email.adminDigest.joined.label": "Joined ({count})",
  "email.adminDigest.joined.more": "{count, plural, one {and # more person} other {and # more people}}",
  "email.adminDigest.joined.unnamed": "{count, plural, one {# person} other {# people}}",
  "email.adminDigest.imports.label": "Imports finished ({count})",
  "email.adminDigest.import": "{time}: {invited} invited, {updated} updated{failed, plural, =0 {} one {, # could not be added} other {, # could not be added}}",
  "email.adminDigest.imports.more": "{count, plural, one {and # more import} other {and # more imports}}",
  "email.adminDigest.cta": "Open Members",
  "email.adminDigest.reason": "You are getting this because you turned on the daily roster digest for admins.",
  "email.adminDigest.manage": "Manage in the admin portal",
} as const;

export type EmailMessageKey = keyof typeof en;
