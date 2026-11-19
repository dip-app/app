// English copy for the roster area. Keys start with "roster.". US English, no em dashes. See docs/design/admin-i18n.md.

export const roster = {
  "roster.title": "Roster",
  "roster.subtitle": "Everyone at your company. Invited people were added in advance and get their role and teams when they sign in; anyone with a company email can join.",
  "roster.import": "Import people",
  "roster.loading": "Loading roster",
  "roster.tableLabel": "Roster",
  "roster.filterLabel": "Filter roster",

  // Filter tabs and state chips
  "roster.filter.all": "Everyone",
  "roster.state.invited": "Invited",
  "roster.state.active": "Active",
  "roster.state.deactivated": "Deactivated",
  "roster.state.revoked": "Revoked",

  // Search
  "roster.search.label": "Search by name or email",
  "roster.search.placeholder": "Search by name or email (press / to focus)",

  // Unlisted members banner
  "roster.unlisted.headline": "{count, plural, one {# person has signed in but isn’t on the roster.} other {# people have signed in but aren’t on the roster.}}",
  "roster.unlisted.detail": "They joined before the roster listed everyone. Adding them keeps them Active with the same role and teams.",
  "roster.unlisted.add": "Add existing members to the roster",
  "roster.unlisted.checking": "Checking {count}…",

  // Empty states
  "roster.empty.rosterEmpty": "The roster is empty",
  "roster.empty.noMatches": "No matches",
  "roster.empty.noInvites": "No pending invites",
  "roster.empty.noPeople": "No people",
  "roster.empty.noActive": "No active people",
  "roster.empty.noDeactivated": "No deactivated people",
  "roster.empty.noRevoked": "No revoked people",
  "roster.empty.importBody": "Import a spreadsheet to add people before they sign in.",
  "roster.empty.invitedBody": "People you import who haven’t signed in yet show up here as Invited.",
  "roster.empty.searchBody": "Try a different name or email, or clear the search.",
  "roster.empty.groupBody": "Nobody is in this group right now.",

  // Result count
  "roster.count.showingOf": "Showing {shown} of {total, plural, one {# person} other {# people}}",
  "roster.count.matchesSoFar": "{count} matches so far",
  "roster.count.matches": "{count, plural, one {# person matches} other {# people match}}",

  // Table
  "roster.table.name": "Name",
  "roster.table.role": "Role",
  "roster.table.teams": "Teams",
  "roster.table.status": "Status",
  "roster.table.added": "Added",
  "roster.table.actions": "Actions",
  "roster.table.noTeams": "None",
  "roster.table.resent": "Message shared {count}×",
  "roster.table.resentLast": "Message shared {count}×, last {date}",
  "roster.table.emailed": "Invite emailed {count}×",
  "roster.table.emailedLast": "Invite emailed {count}×, last {date}",

  // Row actions. DIP sends no email: the action opens the invite message for the admin to send (and records it).
  "roster.action.resend": "Get invite message",
  "roster.action.resending": "Opening…",
  "roster.action.resendAria": "Get the invite message for {name}",
  "roster.action.revoke": "Revoke",
  "roster.action.revokeAria": "Revoke invite for {name}",
  "roster.action.inviteAgain": "Invite again",
  "roster.action.inviteAgainAria": "Invite again: {name}",
  "roster.action.email": "Send invite email",
  "roster.action.emailAria": "Send an invite email to {name}",

  // Toasts
  "roster.toast.reinvited": "{name} is invited again. They get the role and teams set here when they sign up.",
  "roster.toast.nothingToAdd": "Everyone who has signed in is already on the roster. Nothing to add.",
  "roster.toast.revoked": "Invite for {email} revoked. They won’t get the role and teams set here when they sign up.",
  "roster.toast.added": "{count, plural, one {Added # person to the roster.} other {Added # people to the roster.}}",
  "roster.toast.copied": "Invite message copied. Send it to {name} yourself.",
  "roster.toast.addedPerson": "Added {name} to the roster as Invited. Use Get invite message on their row to send the invite.",
  "roster.toast.addedPersonEmail": "Added {name} to the roster as Invited. Use Send invite email on their row when you’re ready.",
  "roster.toast.addedEmailed": "Added {name} and emailed them an invitation.",
  "roster.toast.emailed": "Invitation emailed to {email}. It arrives within a few minutes.",

  // Add one person (the import's dry run and apply for a single row)
  "roster.add": "Add person",
  "roster.add.title": "Add a person",
  "roster.add.intro": "They’re added as Invited and get this role when they sign in with this email. DIP doesn’t email them; you send the invite message yourself.",
  "roster.add.introEmail": "They’re added as Invited and get this role when they sign in with this email.",
  "roster.add.sendEmail": "Email them an invitation now",
  "roster.add.name": "Name",
  "roster.add.email": "Work email",
  "roster.add.emailHint": "Must end in @{domain}.",
  "roster.add.role": "Role",
  "roster.add.confirm": "Add person",
  "roster.add.confirmEmail": "Add and send invite",
  "roster.add.busy": "Adding…",
  "roster.add.nameRequired": "Add their name.",
  "roster.add.checkDetails": "Check the details above.",
  "roster.add.exists": "That email is already on the roster. Search for it to see or change their entry.",

  // Revoke dialog
  "roster.revoke.title": "Revoke {name}’s invite?",
  "roster.revoke.confirm": "Revoke invite",
  "roster.revoke.busy": "Revoking…",
  "roster.revoke.body": "{email} stays able to sign in with a work account, but won’t get the role, teams and location set here. You can import them again later.",

  // Backfill dialog
  "roster.backfill.title": "Add existing members to the roster?",
  "roster.backfill.confirm": "{count, plural, one {Add # person} other {Add # people}}",
  "roster.backfill.busy": "Adding people…",
  "roster.backfill.signedIn": "{count, plural, one {# person has signed in but isn’t on the roster.} other {# people have signed in but aren’t on the roster.}} They are added as Active with their current role and teams.",
  "roster.backfill.existing": "{count} already listed stay as they are. Nobody is emailed, and it is safe to run again.",
  "roster.backfill.existingSkipped": "{count} already listed stay as they are, {skipped} without an email are skipped. Nobody is emailed, and it is safe to run again.",

  // Invite message dialog
  "roster.message.title": "Invite message for {name}",
  "roster.message.copy": "Copy message",
  "roster.message.copying": "Copying…",
  "roster.message.intro": "DIP doesn’t send email, so share this message with {email} yourself.",
  "roster.message.introSelf": "Share this message with {email} yourself.",
  "roster.message.recorded": "Message shared {count}× so far.",
  "roster.message.label": "Message",
  "roster.message.link": "Link: {url}",
  "roster.message.copyFailed": "Couldn’t copy automatically. The message is selected: copy it with Ctrl+C or Cmd+C.",
  "roster.email.title": "Email an invitation to {name}?",
  "roster.email.confirm": "Send email",
  "roster.email.busy": "Sending…",
  "roster.email.body": "DIP emails {email} that you invited them, with a link to sign in with that address.",
  "roster.email.sentBefore": "Already emailed {count}×, last {date}.",
  "roster.email.copyInstead": "Prefer to send it yourself?",
};
