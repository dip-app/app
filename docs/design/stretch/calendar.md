# Calendar conflicts and one-tap add (stretch S1)

Status: CAL-1 to CAL-7 built (November 17, 2026; see [Decisions](#decisions-november-17-2026)); CAL-8 built (emailed calendar invites, see [Emailed invites](#emailed-invites-cal-8-november-17-2026)). Part of the [V2 stretch goals](../../milestones/v2/STRETCH_GOALS.md). Extends the shipped "add to calendar" flow.

## Goal and user stories

Show employees when an event conflicts with their own schedule, prefer events they can attend, and make the top-right date pill on the event page a one-tap add that is colored or disabled by availability, with a modal such as "Overlaps with Team Lunch".

- As a member, the date pill is in the primary brand style when I am free, amber when something overlaps, and a checked, disabled "Added" state once it is in my calendar.
- As a member with a conflict, tapping the pill opens "Overlaps with OTHER_EVENT_NAME" with "Add anyway" and "Cancel".
- As a member, Home and My Events can surface events that fit my calendar first ("Fits your calendar" chip or sort), without hiding anything.
- As a member, I can use all of it without giving DIP access to my calendar (the current editor flow keeps working).
- As a privacy-minded member, my calendar contents never leave my phone.

## Current state (findings)

- Add to calendar is **write-only and permissionless**: `ui/DIP/Features/Shared/DIPEventCalendar.swift` presents `EKEventEditViewController` (runs out of process on iOS 17, user reviews and saves). The protocol `DIPEventCalendarAdding`, `DIPCalendarEventFields`, `canAddToCalendar` and the all-day "floating days" logic are in `ui/Packages/DIPCore/Sources/DIPCore/DIPCalendarEvent.swift` with tests (`CalendarEventTests`). The event page pill ("Monday, 11/23" with a calendar icon, `--calendar-label=generic` shows "Add to Calendar") and weekly-theme page use it (`DIPEventDetailsScreen.swift`, `DIPChallengeDetailsScreen.swift`).
- `ui/project.yml` already declares `NSCalendarsWriteOnlyAccessUsageDescription`, although the editor flow does not need it. No full-access string exists.
- The privacy policy (`apps/landing/privacy/index.html`) says: "Calendar: write-only access, only when you add an event to your calendar. DIP cannot read your calendar." **Reading for conflicts changes this statement.**
- The pill does not know whether the member already added the event, and the event URL written to the calendar is the maps URL, so DIP cannot find its own calendar entry later.
- Server side knows only DIP RSVPs. `Event` times are UTC instants; there is no company time zone field (UNVERIFIED, none found in contracts).
- Google sign-in is used for account entry (ADR 0007), but with identity scopes only. There is no Google Calendar API integration.

## Options considered

Sources for every claim are listed at the end.

| Option | Reads conflicts? | One-tap add? | Permission and review burden | Verdict |
| --- | --- | --- | --- | --- |
| 1. EventKitUI editor (today) | no | no (user taps Save) | none | keep as fallback |
| 2. EventKit write-only (iOS 17) | no (cannot fetch events) | yes, `save` without UI | `NSCalendarsWriteOnlyAccessUsageDescription`, system prompt | useful only for add |
| 3. EventKit full access (iOS 17) | **yes, on device** | yes | `NSCalendarsFullAccessUsageDescription` (name UNVERIFIED), system prompt, privacy policy change | **recommended** |
| 4. Google Calendar API `freebusy.query` | yes, Google calendars only | via `events.insert` | Sensitive-scope OAuth verification (brand verification, justification, demo video, up to about 10 days; classification of the freebusy scopes UNVERIFIED), Limited Use policy, token handling | later, only if needed |
| 5. ICS invite emailed from `events@letsdip.work` | no | no (recipient settings decide) | needs [email](email.md) infrastructure | optional fallback in emails |
| 6. Service account with domain-wide delegation | yes | yes | A super admin of each customer Workspace must grant it; access to all users' data; not viable for arbitrary companies | reject |
| 7. Per-user `webcal://` feed of "my DIP events" | no (one-way) | subscription, not per-event | secret URL token to manage | optional extra |
| 8. Microsoft Graph `getSchedule` (`Calendars.ReadBasic`) | yes, work or school accounts | via events API | Entra app registration; not for personal accounts | only if Microsoft 365 companies ask |

### Why on-device EventKit (option 3)

- One API covers Apple Calendar plus every account the phone syncs (iCloud, Google, Exchange, Microsoft), so it works for companies on either suite without per-company setup.
- Apple distinguishes write-only from full access: write-only cannot fetch existing events, full access can fetch and modify ([WWDC23 10052](https://developer.apple.com/videos/play/wwdc2023/10052/)). Reading for conflicts therefore needs full access.
- Data processed only on the device is not "collected" for the App Store privacy label; anything derived and sent to a server is assessed separately ([app privacy details](https://developer.apple.com/app-store/app-privacy-details/)). Keeping the check on device avoids a label change and avoids Google restricted/sensitive-scope review.
- Cost: the member must grant a broad "full calendar access" prompt. Mitigations: ask only after the member opts in from the conflict teaser, explain exactly what is read (times and titles, on device only), and keep the editor flow for anyone who declines.

### Why not email invites or a service account

- ICS `METHOD:REQUEST` invites are suggestions: Gmail's "add invitations to my calendar" setting defaults can leave a shared sender's invite as an email, and Outlook ignores requests from unknown senders by default ([Google help](https://support.google.com/calendar/answer/13159188), [Microsoft](https://support.microsoft.com/en-us/outlook/calendar-settings)). There is no conflict pre-check and no "was it added" signal.
- Domain-wide delegation needs each customer's super admin to authorize our client ID and scopes, grants the service account the data of all their users, and may take up to 24 hours to apply ([Google admin](https://knowledge.workspace.google.com/admin/apps/control-api-access-with-domain-wide-delegation)). It cannot scale to arbitrary companies and is a large security liability.
- Event emails (see [email](email.md)) should still carry an "Add to calendar" ICS attachment or link for people who read mail on a laptop.

## Design (recommended)

### Phases

1. **Phase A, DIP-internal conflicts (no permission).** Using the member's own RSVPs ("going" events from My Events), compute overlaps with the viewed event and show "Overlaps with <your other DIP event>". Pure function in `DIPCore`, works offline, no privacy impact. Ships first.
2. **Phase B, one-tap add and device calendar conflicts (opt-in).** Full-access read with an on-device conflict engine and the state-colored pill.
3. **Phase C (optional).** Reminder-email ICS, `webcal://` feed, Google or Microsoft freebusy for web or portal use.

### Conflict engine (on device)

- `DIPCalendarConflictChecking` protocol in `DIPCore` (`func conflicts(for window: DateInterval) async -> [DIPCalendarConflict]`), EventKit adapter in `ui/DIP/Features/Shared`, fake for tests, mirroring `DIPEventCalendarAdding`.
- One `EKEventStore.predicateForEvents(withStart:end:calendars:)` fetch per loaded window (for example the next 45 days), cached for the session and refreshed on `EKEventStoreChanged`; interval overlap computed in pure code. (`predicateForEvents` was not verified in fetched docs, UNVERIFIED; it is the standard EventKit read API.)
- Ignore by default: the event's own previously added entry (matched by stored identifier or DIP URL, below), all-day events (a setting: "Treat all-day events as busy", default off), events marked free (`availability == .free`), declined events, and canceled events. Tentative counts as a soft conflict.
- Output is minimal: `{title, start, end, isSoft}`. Titles are shown only on the member's own screen and are never logged, uploaded or put in analytics.
- Performance: one fetch per window plus an O(n log n) sweep; the Home list asks the cached index, not the store.

### States of the date pill

| State | Look | Tap |
| --- | --- | --- |
| No calendar permission | Current outlined pill | System editor (today) |
| Free | Primary brand fill, calendar-plus icon | Saves directly to the default calendar, shows "Added" toast with Undo (Undo deletes the entry) |
| Soft or hard conflict | Amber outline and warning glyph | Modal "Overlaps with <name>" (up to 2 names then "and N more"), actions "Add anyway" and "Cancel" |
| Already added | Check icon, muted, disabled | VoiceOver reads "Added to your calendar" |
| Past or canceled | Hidden (unchanged, `canAddToCalendar`) | none |

Colors come from semantic tokens in `ui/DesignSystem/tokens.json` (add `calendar.free`, `calendar.conflict` semantic roles; regenerate; no raw hex in views). White text on purple per the locked decisions. State must not rely on color alone (icon and label change too), and the modal and pill need accessibility labels and Dynamic Type checks ([accessibility notes](../../milestones/v2/ACCESSIBILITY.md)).

### Tracking added events

- Store `eventId -> EKEvent.eventIdentifier` locally (UserDefaults keyed per uid, same pattern as other local prefs) and also write the share link `https://letsdip.work/e/<eventId>` into the entry URL or notes, so entries can be re-found if the identifier changes.
- When an event changes (time or venue) the existing change push arrives; the app offers "Update your calendar entry" (full access only).
- When the member leaves an event, offer "Remove from your calendar".

### Prioritizing attendable events

Home gets a "Fits your calendar" chip and an optional sort within the existing filter row (`DIPHomeEventsPresentation` is pure and testable). Events are never hidden; conflicting events get a small warning glyph. A calendar conflict is computed after the feed loads, so first paint is unchanged.

### Server and contract impact

- **None** for phases A and B: no new callable, no Firestore field, no schema change. Conflicts are never written to the server.
- Optional: an `ics` endpoint for the personal feed (Phase C) would be a new HTTPS function and a per-user token document (server-only); additive.

### Interaction with push

The server cannot know about calendar conflicts, so it never suppresses or changes "starting soon" pushes. On device, the app can show the conflict banner on the event page and My Events. A local notification when a calendar edit creates a new conflict is not reliable in the background and is out of scope. If the owner later wants conflict-aware pushes, the only privacy-preserving route is an on-device local notification scheduled while the app is foregrounded (open question 3).

## Privacy and policy impact

- Info.plist: add `NSCalendarsFullAccessUsageDescription` (exact key name UNVERIFIED, confirm in the Xcode "Privacy - Calendars Full Access Usage Description" entry); keep the write-only string while the app still saves without the editor.
- Privacy policy (`apps/landing/privacy/index.html`, live at letsdip.work/privacy) must change from "cannot read your calendar" to: read access only if you turn on calendar conflicts; read on your device only, never uploaded, stored or shared; you can revoke it in iOS Settings. Ship the policy edit in the same release as the permission.
- App Store privacy label: unchanged if nothing leaves the device. If Phase C adds server-side freebusy, add the data type and, for Google scopes, the Limited Use disclosure and a Google OAuth consent screen with brand verification ([verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [user data policy](https://developers.google.com/terms/api-services-user-data-policy)).
- Whether EventKit needs a privacy-manifest entry is UNVERIFIED; check Apple's required-reason API list at build time.
- Employee consent: opt-in per member, default off, reversible from Profile settings.

## Testing plan

- DIPCore unit tests: overlap math (adjacent, nested, multi-day, all-day float across time zones and DST, tentative vs busy, free, declined, own entry excluded), pill state reducer, Home chip ordering. Use the `CalendarEventTests` style with fixed zones.
- Fakes for the checker and adder; UI tests with injected fakes for each pill state, the modal and Undo.
- Device checklist: permission prompt wording, deny path falls back to the editor, revoke in iOS Settings mid-session, work and iCloud accounts, shared calendar, recurring events, timezone change while traveling, Undo, leave event cleanup.
- No server tests needed for A and B.

## Rollout and flags

`DIP_CALENDAR_CONFLICTS_ENABLED` build flag plus a Profile toggle ("Show calendar conflicts"), default off. Phase A can ship without the flag. Release order: policy text, Info.plist string, then the feature. Rollback: turn the flag off; nothing server-side to undo.

## Risks

Full-access prompt wording discourages opt-in (measure; Phase A still helps); stale calendar cache (refresh on store change and foreground); recurring and time zone edge cases; EventKit write-only bugs reported on iOS 17.5 ([thread](https://forums.developer.apple.com/forums/thread/742809), one report, UNVERIFIED fix); Apple review questions about calendar read (answer with the on-device explanation and the opt-in).

## Decisions (November 17, 2026)

The owner had not answered the open questions when this was built; each default below follows this doc's recommendation and is recorded in the PR.

1. **Opt-in full access is adopted (Q1).** Phase A (DIP-to-DIP conflicts, no permission) is always on. Phase B (device calendar read, direct save) needs the build flag `DIP_CALENDAR_CONFLICTS_ENABLED` (Info.plist `DIPCalendarConflictsEnabled`: YES in Debug, NO in Release), the per-uid Profile toggle "Show calendar conflicts" (default off) and iOS full access. Without all three, the pill keeps the permissionless system editor.
2. **"Add anyway" is allowed (Q2).** A conflict opens the "Overlaps with" alert (up to two names, then "and N more"; "May overlap with" when all are tentative) with Add anyway and Cancel.
3. **No conflict-aware reminders (Q3)** and **no Google or Microsoft freebusy (Q4)**: out of scope.
4. **Emailed invites from `events@letsdip.work` (Q5)**: reversed on the owner's request, built as CAL-8 (#185) with EML-5 (#219); see [Emailed invites](#emailed-invites-cal-8-november-17-2026).
5. **Conflict pill is a solid amber fill** (new token `warningAmber` #FF9F43 behind semantic `calendarConflict`, ink text `textOnCalendarConflict`, warning triangle) rather than the amber outline sketched above, because the owner's design language reserves outlines for informational states and the pill stays pressable. Brand yellow was tried first and rejected in design crit (it read as a second back button). `calendarFree` aliases purple. The added state is an outlined, disabled capsule with a checkmark.
6. **Free state:** without opt-in it looks exactly as before (solid purple, calendar icon, date). With opt-in it shows a calendar-plus icon and saves directly, then a toast "Added to your calendar" with Undo (5 s).
7. **Entry tracking:** the entry URL is now the share link `https://letsdip.work/e/<id>` (the venue stays in the location field), so DIP excludes its own entries from conflicts and re-finds them. Records (`dip.calendar.v1.<uid>`: identifiers and times only, never titles) are cleared on sign-out. Times within a minute count as unchanged. Update and remove are offered only for entries DIP created: "This activity moved. Update your calendar entry." under the When row, and "Leave and remove from calendar" in the leave dialog. The adapter refuses to update or delete any entry whose URL is not a DIP share link.
8. **Opt-in teaser:** a one-time card "See what overlaps" (Turn on / Not now) under the event info card; a denial leaves the setting off and offers Settings.
9. **Home:** events that fit come first (stable order, nothing hidden) and overlapping cards get an amber warning badge with the VoiceOver value "Overlaps your calendar". No separate chip; the sort applies whenever a conflict is known, after the feed's first paint. My Events is unchanged.
10. **All-day entries** are ignored unless "Count all-day events as busy" is on; free, declined and canceled entries are ignored; tentative is a soft conflict.
11. **Privacy:** the policy page and the TestFlight checklist ([ops](../../ops/testflight-universal-links.md#calendar-conflicts-stretch-s1-app-store-privacy-and-review)) were updated in the same change. The App Store privacy label is unchanged because calendar data never leaves the device. `NSCalendarsFullAccessUsageDescription` was added next to the write-only string.

## Emailed invites (CAL-8, November 17, 2026)

Status: done in code and tests; nothing sends until the owner turns email on (`EMAIL_ENABLED`, `emailSettings/{companyId}.enabled`) and runs the [manual client checklist](../../ops/email-runbook.md#11-calendar-invites-manual-test-checklist).

Joining an event (RSVP `going`) emails the member a real calendar invite, so Gmail, Outlook, Apple Mail and iOS Mail show their native "Add to calendar" or "Yes" card. The date button in the app is unchanged; the email is the second, no-permission route to the same result.

| Moment | Trigger | iCalendar | Email |
| --- | --- | --- | --- |
| Member joins | RSVP becomes `going` | `METHOD:REQUEST`, SEQUENCE n | "Calendar invite: title" |
| Time, place or title changes | event update (same field set as the changelog) | `METHOD:REQUEST`, same UID, SEQUENCE n+1 | "Updated invite: title" |
| Member leaves or is removed | RSVP leaves `going` or is deleted | `METHOD:CANCEL`, same UID, SEQUENCE n+1 | "Removed from your calendar: title" |
| Event canceled | event status becomes `cancelled` | `METHOD:CANCEL`, same UID, SEQUENCE n+1 | "Canceled: title" |

- **Sender:** `DIP Events <events@letsdip.work>`, Reply-To `support@letsdip.work`. The domain `letsdip.work` is already verified for sending; the `events@` mailbox does not need to exist (nobody answers iTIP replies). ORGANIZER is `events@letsdip.work`.
- **ATTENDEE:** the member, `PARTSTAT=ACCEPTED;RSVP=FALSE`. They already said yes in DIP, so clients show an add-to-calendar card and never ask for a reply or send one.
- **UID:** `dip-<eventId>-<first 16 hex of sha256(memberUid)>@letsdip.work`, per (event, member), so every update and the cancel modify the same entry and the member id never appears in the file. SEQUENCE comes from a server-only counter `emailInviteState` per (company, event, member): first invite 0, then +1 for every REQUEST or CANCEL. It only grows; a rejoin after a leave continues the count.
- **Times:** UTC instants (`DTSTART:20301105T233000Z`), as in `ics.ts`. Daylight saving cannot move an entry and no VTIMEZONE is needed. DTSTAMP is the send time.
- **Content:** SUMMARY title, LOCATION `venue name, street address`, DESCRIPTION and URL the share link `https://letsdip.work/e/<id>`, `TRANSP:OPAQUE`, a `VALARM` 30 minutes before the start on REQUEST (none on CANCEL).
- **Body:** the standard email layout (admin-site look, logo header art, footer last): title, when, where, one sentence "Open the attached invite (invite.ics) and choose Add to calendar", and the Open in DIP button.
- **Delivery format and provider limits:** the calendar travels as one attachment `invite.ics` with content type `text/calendar; charset=UTF-8; method=REQUEST` (or `CANCEL`). Neither Resend (`attachments[].content_type`) nor Postmark (`Attachments[].ContentType`) offers a raw MIME body or an inline `text/calendar` alternative part: their JSON APIs only take html, text and attachments (checked against the provider docs on November 17, 2026). Clients that need the inline `multipart/alternative` calendar part to render the card from the body may show the attachment instead of the card; Gmail, Apple Mail and iOS Mail read `method=` from an attached `.ics`. If the manual checklist shows a client that does not, the fallback is the provider's SMTP relay with a hand-built `multipart/alternative` message; that is not built.
- **Preferences:** new email-only category `calendar_invites`, default on, because the member just asked to join and the invite is the transactional confirmation. Profile > Notifications > Email shows "Calendar invites"; every email has the one-click unsubscribe, which turns only this category off. Turning it off stops the whole sequence (invites, updates, cancels).
- **Safety:** outbox id `calendar_invites_<eventId>_<uid>_<r|c><trigger write time>` is created once, so a redelivered trigger cannot send twice; sends are at most once. At send time the sender re-reads the RSVP and event: no invite when the member left or the event was canceled or ended (`not_going`, `event_canceled`, `event_ended`); no cancel unless an invite was actually delivered (`never_invited`) or when the member rejoined meanwhile (`rejoined`). Tenant, `EMAIL_ENABLED`, company `emailSettings`, suppression, member cap (20 per day) and company cap apply. Updates fan out to at most 500 going members per event change.
- **One owner of the entry:** the informational `event.ics` (`METHOD:PUBLISH`, UID `<eventId>@letsdip.work`) is no longer attached to any email, so a member can never end up with two entries for one event. Reminder and changed emails say "To add it to your calendar, open the event in DIP" and link to the event page; the invite, update and cancel emails are the only ones with a calendar file.
- **Not built:** the optional per-user `webcal://` feed from the CAL-8 scope (needs a revocable token; not part of this request).

### Decision: grey busy state for personal-calendar overlaps (November 17, 2026)

Owner decision, supersedes the single amber state of 2 and 5 above for device entries.

1. **Amber is for DIP, grey is for everything else.** An overlap with another DIP event the member joined keeps the amber conflict pill ("Overlaps with X", Add anyway / Cancel). An overlap with a non-DIP entry in the member's own device calendar (the opt-in read) shows a **neutral gray pill** instead: solid `calendarBusy` fill (token alias of `completeGray` #CCCCCC, ink text about 10:1), calendar-clock icon, same date label. It means "you have something else then", is informational rather than a warning, and stays tappable.
2. **Tapping the grey pill** opens an alert titled with the busy entry ("Team Lunch", "Team Lunch and Standup", "A, B and 2 more") or "Busy" when the entry has no title, with the time(s), "You have something else then." and Add anyway / Cancel. DIP only ever reads what the full-access grant already exposes; titles are shown on the device only, never logged or uploaded. Untitled or hidden titles read "Busy" everywhere (alert, list, VoiceOver); nothing is invented.
3. **Both kinds overlap:** DIP wins (amber). The alert reads "Overlaps with Yoga and Dentist" (personal entries by title, or "Busy"), one line per entry in the body.
4. **Resolution order:** hidden, then added, then adding, then DIP overlap (amber), then personal overlap (grey), then free. Pure and unit tested (`DIPCalendarPillState.resolve`).
5. **VoiceOver:** amber reads "Add to calendar. Overlaps with <titles>"; grey reads "Add to calendar. Busy at this time" and never speaks the entry title (the alert shows it). Home cards say "Overlaps another activity you joined" or "Busy at this time".
6. **Home:** a card overlapping a joined DIP event keeps the amber warning badge; a card overlapping only the member's calendar gets a small neutral gray circle with the calendar-clock icon (same size and place). Order is fits first, then personal-calendar overlaps, then DIP overlaps; nothing is hidden. The Duo list and its default detail selection use the same rule, and the Duo detail pane shares the event page, so its pill follows the same states.
7. **Fixtures (Debug only):** `--calendar-fake=<free|busy|busy-untitled|conflict|both|added|off|denied>`. `conflict` and `both` move the first upcoming event the member has not joined to overlap the first one they have joined.

## Open questions for the owner

1. Is the opt-in full-access prompt acceptable, or should V2 stay with Phase A (DIP-only conflicts) plus the editor?
2. Should "Add anyway" be allowed, or should conflicting adds be blocked entirely? Recommended: allowed, because a conflict can be stale or soft.
3. Do you want conflict-aware reminders (local notification) even though they are best effort?
4. Which calendars matter most to your customers (Google Workspace, Microsoft 365, Apple)? Decides whether Phase C Google or Microsoft freebusy is worth the verification work.
5. Answered: yes, `events@letsdip.work` sends the invites ([Emailed invites](#emailed-invites-cal-8-november-17-2026)).

## Work breakdown

| ID | Title | Scope | Acceptance | Est | Area | Depends |
| --- | --- | --- | --- | --- | --- | --- |
| CAL-1 | DIP-only overlap check | Pure overlap function over the member's going events; "Overlaps with" modal on the event page | Unit tests for adjacent, nested, multi-day and all-day cases; modal text correct for 1, 2 and 3+ overlaps; VoiceOver labels | M | ios | none |
| CAL-2 | Conflict checker protocol and EventKit adapter | `DIPCalendarConflictChecking`, EventKit full-access adapter, fake, change observer, ignore rules | Fake-based tests for ignore rules; adapter reads only the requested window; titles never logged | L | ios | none |
| CAL-3 | Permission flow and settings | Opt-in teaser, system prompt, Profile toggle, Info.plist string, deny and revoke handling | Deny keeps the editor flow; revoke mid-session degrades cleanly; toggle persists per uid | M | ios | CAL-2 |
| CAL-4 | Stateful date pill | Free, conflict, added, no-permission states with semantic tokens, icons and labels, direct save with Undo | UI tests per state with fakes; contrast and Dynamic Type checked; Undo removes the entry | L | ios | CAL-2, CAL-3 |
| CAL-5 | Added-entry tracking | Local identifier store, DIP link in entry URL, "Update" and "Remove" offers after change or leave | Tests: re-find by URL, update after time change, remove after leave; no entry touched that DIP did not create | M | ios | CAL-4 |
| CAL-6 | Home "Fits your calendar" | Chip and sort over cached conflicts in the pure presentation layer | Presentation tests keep order stable and never hide events; first paint not delayed | M | ios | CAL-2 |
| CAL-7 | Privacy policy and store disclosures | Update letsdip.work/privacy, App Privacy answers, review notes | Policy text merged and deployed before the feature flag turns on; checklist in the ops doc | S | infra | none |
| CAL-8 | Email ICS and optional feed | Add-to-calendar ICS in event emails and an optional per-user `webcal://` feed endpoint | ICS validates in Gmail, Outlook and Apple Mail; feed token can be revoked; no calendar data read | M | backend | EML-5 |

CAL-8 status: invite emails done (REQUEST, update, CANCEL); the `webcal://` feed is not built. Manual client validation is pending (owner, see the runbook checklist).

## Sources

- WWDC23 Discover Calendar and EventKit UI changes (write-only vs full access): https://developer.apple.com/videos/play/wwdc2023/10052/ and https://developer.apple.com/videos/play/wwdc2023/10053/
- `NSCalendarsWriteOnlyAccessUsageDescription`: https://developer.apple.com/documentation/bundleresources/information-property-list/nscalendarswriteonlyaccessusagedescription
- App privacy details ("collect" definition): https://developer.apple.com/app-store/app-privacy-details/
- Google Calendar freebusy.query scopes and limits: https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
- Google Calendar auth scopes: https://developers.google.com/workspace/calendar/api/auth
- Google sensitive scope verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- Google API user data (Limited Use) policy: https://developers.google.com/terms/api-services-user-data-policy
- Incremental scopes on iOS: https://developers.google.com/identity/sign-in/ios/additional-scopes
- Gmail invite settings: https://support.google.com/calendar/answer/13159188
- Outlook calendar settings: https://support.microsoft.com/en-us/outlook/calendar-settings
- iTIP invites: https://www.rfc-editor.org/rfc/rfc5546
- Domain-wide delegation: https://knowledge.workspace.google.com/admin/apps/control-api-access-with-domain-wide-delegation
- Microsoft Graph getSchedule: https://learn.microsoft.com/en-us/graph/api/calendar-getschedule?view=graph-rest-1.0
- Not verified: Apple developer pages returned titles only to the fetch tool, so Apple details above come from WWDC session excerpts and search snippets. Confirm key names and API signatures in Xcode before building.
