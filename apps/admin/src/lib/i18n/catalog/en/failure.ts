// Plain-language copy for errors that have no message of their own: transport failures, bare callable codes and
// vague server text ("Invalid request."). Keys start with "failure.". Read through `userError()` in
// src/lib/userError.ts, never directly in pages. US English, no em dashes, no status codes or reason keys.

export const failure = {
  "failure.network": "Can’t reach DIP. Check your connection and try again.",
  "failure.busy": "DIP is busy right now. Try again in a moment.",
  "failure.busyDipbot": "Dipbot is busy right now. Try again in a moment.",
  "failure.signedOut": "Your session ended. Sign in again to continue.",
  "failure.permission": "You don’t have access to do this. Ask a company admin if you need it.",
  "failure.rateLimit": "Too many tries. Wait a minute and try again.",
  "failure.validation": "Some details need fixing. Check them and try again.",
  "failure.rejected": "DIP couldn’t accept these changes. Check them and try again; if it keeps happening, contact support.",
  "failure.rejectedAction": "DIP couldn’t do this. Try again; if it keeps happening, contact support.",
  "failure.notFound": "This no longer exists. It may have been deleted.",
  "failure.conflict": "Someone else changed this since you opened it. Reload the latest version (your edits here will be lost).",
  "failure.reloadLoses": "Reloading the latest version drops your edits here.",
  "failure.unavailable": "This can’t be done right now. Reload the page and try again.",
  "failure.unknown": "Something went wrong. Try again.",
  "failure.field": "Check this field.",
  "failure.venuesOff": "Venue suggestions are turned off for your company.",

  // Titles for the surfaces that show one (page load and form save failures)
  "failure.title.load": "Couldn’t load this",
  "failure.title.save": "Couldn’t save",

  "failure.signIn": "Sign in",
} as const;
