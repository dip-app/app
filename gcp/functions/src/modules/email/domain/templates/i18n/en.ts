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
  "email.preheader.onDay": "{sentence} on {day}.",

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
  "email.eventCanceled.note": "Browse other events.",

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
  "email.calendarInvite.note": "{reason, select, updated {Open the attached calendar invite to update your calendar.} other {Open the attached invite (invite.ics) and choose Add to calendar. If the time or place changes, we will send an updated invite.}}",

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
  "email.ideas.footer.reason": "You get this because you turned on weekly event ideas for admins.",
  "email.ideas.footer.manage": "Manage in the admin portal",
  "email.ideas.text.when": "When: {hint}",
} as const;

export type EmailMessageKey = keyof typeof en;
