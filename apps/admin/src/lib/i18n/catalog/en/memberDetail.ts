// English copy for the member detail page. Keys start with "memberDetail.". US English, no em dashes. See docs/design/admin-i18n.md.

export const memberDetail = {
  // Page
  "memberDetail.title": "Member",
  "memberDetail.subtitle": "Edit details, access, points and profile. Every change is recorded in the audit log.",
  "memberDetail.loading": "Loading member",
  "memberDetail.backToMembers": "Back to members",
  "memberDetail.joined": "Joined {date}",

  // Status chip
  "memberDetail.status.active": "Active",
  "memberDetail.status.invited": "Invited",
  "memberDetail.status.deactivated": "Deactivated",

  // Form
  "memberDetail.reloadLatest": "Reload latest",
  "memberDetail.field.role": "Role",
  "memberDetail.field.teams": "Teams",
  "memberDetail.field.workLocation": "Work location",
  "memberDetail.field.department": "Department",
  "memberDetail.field.jobTitle": "Job title",
  "memberDetail.hint.ownRole": "You can’t change your own role.",
  "memberDetail.hint.roles": "Organizers manage events, themes, albums and attendees. Admins also manage people and imports.",
  "memberDetail.readOnly": "Read-only. Only admins can change people.",
  "memberDetail.save": "Save changes",
  "memberDetail.saving": "Saving…",
  "memberDetail.discard": "Discard",
  "memberDetail.saved": "Saved.",

  // Access panel
  "memberDetail.access.title": "Access",
  "memberDetail.access.deactivatedNote": "Deactivated. They can’t sign in and are hidden from events and feeds.",
  "memberDetail.access.activeNote": "Deactivating blocks sign-in and removes them from upcoming events. Their history and points stay.",
  "memberDetail.access.reactivate": "Reactivate",
  "memberDetail.access.deactivate": "Deactivate",
  "memberDetail.access.selfNote": "You can’t deactivate yourself.",

  // Points panel
  "memberDetail.points.title": "Points",
  "memberDetail.points.adjustOrReset": "Adjust or reset",

  // Participant profile panel
  "memberDetail.profile.title": "Participant profile",
  "memberDetail.profile.avatar": "Avatar",
  "memberDetail.profile.avatarChosen": "Chosen",
  "memberDetail.profile.avatarDefault": "Default",
  "memberDetail.profile.city": "City",
  "memberDetail.profile.cityNotSet": "Not set",
  "memberDetail.profile.clears": "Clears what they set themselves: photo, avatar, city, interests, travel radius, availability and favorites. Identity, role, teams and points stay.",
  "memberDetail.profile.reset": "Reset profile",

  // Role change dialog
  "memberDetail.role.title": "Change {name}’s role?",
  "memberDetail.role.confirm": "{role, select, member {Make Member} organizer {Make Organizer} other {Make Admin}}",
  "memberDetail.role.busy": "Changing role…",
  "memberDetail.role.goesFrom": "{name} goes from ",
  "memberDetail.role.goesTo": " to ",
  "memberDetail.role.goesEnd": ".",
  "memberDetail.role.description.member": "Members join events and challenges in the app but can’t use the admin portal.",
  "memberDetail.role.description.organizer": "Organizers manage events, albums and attendees, and can read the member list.",
  "memberDetail.role.description.admin": "Admins can edit and deactivate people, change points, import and manage the roster, and read the audit log. Only give this to someone you trust with all of that.",
  "memberDetail.role.otherEdits": "Your other edits on this page are saved at the same time.",

  // Deactivate dialog
  "memberDetail.deactivate.title": "Deactivate {name}?",
  "memberDetail.deactivate.reason": "Why are you deactivating them?",
  "memberDetail.deactivate.body": "They are signed out of DIP and removed from upcoming events. You can reactivate them later.",
  "memberDetail.deactivate.done": "Deactivated. They can no longer sign in.",

  // Reactivate dialog
  "memberDetail.reactivate.title": "Reactivate {name}?",
  "memberDetail.reactivate.reason": "Why are you reactivating them?",
  "memberDetail.reactivate.body": "They can sign in again. Events they were removed from are not restored.",
  "memberDetail.reactivate.done": "Reactivated.",

  // Reset profile dialog
  "memberDetail.reset.title": "Reset {name}’s profile?",
  "memberDetail.reset.reason": "Why is the profile being reset?",
  "memberDetail.reset.body": "Photo, avatar, city, interests, travel radius, availability and favorites go back to defaults. This can’t be undone. Name, role, teams, location and points are kept.",
  "memberDetail.reset.done": "Profile reset to defaults.",

  // Points dialog
  "memberDetail.pointsDialog.title": "Change points",
  "memberDetail.pointsDialog.confirmReset": "Reset to 0",
  "memberDetail.pointsDialog.confirmApply": "Apply change",
  "memberDetail.pointsDialog.reason": "Reason for the change",
  "memberDetail.pointsDialog.kind": "Kind of change",
  "memberDetail.pointsDialog.tabAdjust": "Adjust",
  "memberDetail.pointsDialog.tabReset": "Reset to 0",
  "memberDetail.pointsDialog.resetBody": "The balance of {balance} is reduced to 0 by one adjustment.",
  "memberDetail.pointsDialog.delta": "Points to add or take away",
  "memberDetail.pointsDialog.deltaPlaceholder": "e.g. 50 or -25",
  "memberDetail.pointsDialog.balance": "Balance {balance}. It can’t go below 0.",
  "memberDetail.pointsDialog.balanceBecomes": "Balance {balance} becomes {next}. It can’t go below 0.",
  "memberDetail.pointsDialog.resetDone": "Points reset to 0.",
  "memberDetail.pointsDialog.changedDone": "Points changed by {delta}.",
};
