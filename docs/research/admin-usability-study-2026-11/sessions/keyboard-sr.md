# Session: keyboard-sr (simulated participant)
Persona: Sam, 52, low vision, screen reader + keyboard only, occasional admin. Setup: Desktop 1440x900, English; tree/list/focus/press/type only (no shot/click).
(Sign-in: login page tree is clear; one Tab reached "Sign in as admin", Enter worked, focus landed on main of /overview/.)
## T2: Create and publish an event
Start: 21:08:11, end: 21:11:02, driver commands: ~50 (over the 25 budget because of long form; recorded honestly)
Outcome in my own words: I created "Board-game night", Fri Nov 27 5-8 PM, 30 spots, tags Social+Games, cover Rolling dice. It appears in the Upcoming list as "Upcoming" with 0 / 30. There is no separate Publish button; the page says "Members see it in the app as soon as it's created", so I assume it is published. I did not hear any success confirmation after Create event (status region empty by the time I looked).
### Think-aloud log
- [21:08:12] (think-aloud) Events list, table is well labelled. "New event" link is first in main. -> `press Tab` -> focus on "New event" link (first Tab goes straight to main content, good).
- [21:08:19] Enter on link -> new page, but focus goes to the whole `main` region, so I hear a long read of the heading and intro; acceptable, but not on Title field.
- [21:08:29] Long form. 174 cover radios appear in the element list (219 elements) - noisy in `list`, but the radio group is a single Tab stop (good).
- [21:08:33] Title, Description typed via field jump. Tags are toggle buttons announced "Social, 29 members interested" and "(pressed)" - nice.
- [21:08:41] Tabbing from tags to the calendar: Tab order passes Let Dipbot choose, Search covers, Filter by theme, cover radios, then month buttons, then grid. Calendar is one Tab stop; arrows move days: "Friday, November 27, 2026". Fine.
- [21:09:23] CONFUSION: I pressed Enter once on Nov 27; label became "...start and end date" but a visible text said "Fri, Nov 27 chosen as the start. Now choose the end date, or click it again for a one-day event." Contradictory; I only found this later by reading the page, it was not announced.
- [21:09:28] Start time textbox showed "10:00 PM" by default (odd default). Typed "5:00" -> became "5:00 PM" because PM was already pressed. OK. Also AM/PM toggles and sliders are extra tab stops (6 stops for two times) - tedious.
- [21:09:44] Location: Street address is a combobox; "Pick a result to fill the venue and city. You can also type the address yourself." Typed venue name and city; capacity default "20" -> "30". "Price (USD)" blank, left blank (became Free).
- [21:10:01] Pressed Create event -> alert "Fix 2 fields to continue." and focus jumped to first invalid field (cover radio). Good focus handling. But `read` only revealed "Pick a cover image." I did not know what the second error was until I resubmitted.
- [21:10:12] Cover is required. Searched "game", Tab x2 to first radio "Rolling dice", Space -> checked. The error text "Pick a cover image." stayed after fixing.
- [21:10:38] Had to go back and press Enter on Nov 27 again to finish the one-day range ("Fri, Nov 27, one day").
- [21:10:46] Create event again -> focus to Street address, text "Add the street address." Typed "500 Grant Street, Pittsburgh"; autocomplete said "No matches. Keep typing or enter the address yourself." The field stayed marked invalid until resubmit.
- [21:11:01] Create event -> back to /events/, "Upcoming (3)", Board-game night row present. Focus on main, no spoken confirmation that I could find.
### Questionnaire
Ease: 4/7. Confidence: 5/7. Confusing: end-date state of the calendar ("chosen as the start. Now choose the end date" vs label "start and end date"); required cover image and street address only discovered after failed submit; no "publish" concept - I had to infer creation = published; no success message heard; two-step errors (one error at a time visible in read); 10:00 PM default start time. Would change: announce date-range state in the grid label/live region; mark required fields up front; list all errors in the alert; confirm "Event created and visible to members" via a status message; default time to something sensible.

## T4: Office location and venue
Start: 21:11:23, end: 21:12:51, driver commands: ~25 (budget reached)
Outcome in my own words: FAILED. I could not set the office to 600 Grant Street, Pittsburgh. The "Office address" field only offers a few fixed suggestions; my address gave "No matches". The only way to set an office was to pick a different listed place (I ended with "Near 412 Forbes Avenue, Pittsburgh, PA", which is wrong). I never reached venue results: "Find venues near your office, 1 credit" was disabled with "Add a title so Dipbot knows what to look for."
### Think-aloud log
- [21:11:23] (think-aloud) New-event page opened with ?office=unset. -> `goto` -> normal long form, nothing at top says the office is missing.
- [21:11:30] I scroll to the end looking for office/venues. Under heading "Dipbot venues": "Set your office address to find venues nearby." plus a combobox "Office address". -> `scroll down`
- [21:11:34] Typed "600 Grant Street, Pittsburgh" -> "No matches. Keep typing or enter the address yourself." + "Google Maps". No Save/Set button anywhere. "enter the address yourself" has no way to confirm.
- [21:11:38] Pressed Enter hoping to save -> it submitted the whole event form: alert "Fix 6 fields to continue.", focus jumped to Title, office not saved. Lost context, annoyed.
- [21:11:55] Tab away (blur) does not save either; the "No matches" text just vanished.
- [21:12:00] Tried "600 Grant Street, Pittsburgh, PA", "600 Grant St", "Grant", "Grant Street Pittsburgh", with zip. All "No matches". ArrowDown opens nothing.
- [21:12:25] Typing only "Pittsburgh" showed 4 options (Schenley Park, Primanti Bros., 412 Forbes Avenue, Phipps Conservatory). Found by accident via `list`; the results were not announced that I noticed.
- [21:12:50] Picked the third option with ArrowDown x3 + Enter -> office became "Near 412 Forbes Avenue, Pittsburgh, PA, within [radius]". Focus dropped to page body (lost focus). Venue button still disabled until a title is typed. Gave up here: the office is wrong and I cannot set the real address.
### Questionnaire
Ease: 1/7. Confidence: 1/7. Confusing: "Set your office address to find venues nearby" but a real address is rejected with "No matches. Keep typing or enter the address yourself." (nothing lets me enter it myself); Enter submits the event form instead of the office field; the office setting lives inside the New event form; focus lost after choosing a suggestion; search button disabled with a reason ("Add a title so Dipbot knows what to look for.") placed after the control, not tied to it. Would change: accept a typed address with an explicit "Use this address" button; do not submit the form on Enter in that field; keep focus on the field/Change office button after choosing; announce suggestion count; put office setting in company settings.

## T5: Review a challenge submission
Start: 21:13:19, end: 21:14:22, driver commands: ~30 (several were Tab loops)
Outcome in my own words: I asked Avery Kim (Fitness, Nov 16 to 22) for changes with the note "Thanks! Please log your third workout, then resubmit." Page text "Requested changes from Avery Kim. They can resubmit while the week is open." appeared and the pending count went from 13 to 12. I chose "request changes" because she had only 2 of 3 workouts; I could not judge the photo.
### Think-aloud log
- [21:13:19] (think-aloud) Overview. I expect "Needs attention" to lead me there. Tab x3 -> reached "View as table" (chart group is in the way), Tab again -> link "4 Submissions to review 3 from Current theme: Fitness 1 from Past theme: Fitness, Nov 9 to Nov 15". Long link name but clear. Enter.
- [21:13:26] Lands on Challenges table, not on the submissions. The overview said 3 from current theme, the table says "13 pending" for Fitness. CONFUSION: 3 vs 13 mismatch.
- [21:13:30] Tab went to `region "Challenges"` (a scrollable container as a tab stop, unlabelled purpose), another Tab -> link "Review submissions for Fitness, Nov 16 to Nov 22, 2026". Link names are descriptive, good. Enter.
- [21:13:36] Review page: heading, "Use J and K to move between entries, or turn the shortcuts off." Single-key shortcuts could clash with my screen reader keys; there is a switch for it (good), but I only see it far down.
- [21:13:48] Tabs: "All themes", tab "Pending", then 13 submission buttons. Enter on Avery Kim showed the detail below the list: Approve, Request changes, Previous, Next, progress "2 of 3 workouts", note "Morning stretch routine, every day.", evidence image "Evidence from Avery Kim" (alt text says nothing about the content).
- [21:14:14] CONFUSION: from the list, the Approve/Request changes buttons are after ALL 13 list items (14 Tab presses). No heading/landmark jump or skip. Pressing Enter on a person in the list did not announce that details opened and focus stayed in the list.
- [21:14:14] Request changes opens a dialog "Request changes from Avery Kim?" and focus goes to textarea "What should they change? (required)". Good. Text "Add a reason to continue." is shown before I typed anything.
- [21:14:21] Typed note, Tab -> "Request changes" (enabled), Enter -> dialog closed; text "Requested changes from Avery Kim. They can resubmit while the week is open." in the page; list now 12.
- [21:14:22] Focus is on a "Request changes" button which now belongs to the NEXT submission (Casey Novak?) with no announcement - risk of acting on the wrong person.
### Questionnaire
Ease: 4/7. Confidence: 6/7. Confusing: 3 vs 13 pending; detail pane placed after the whole list so keyboard users pass 13 stops; I could not evaluate the photo (alt text generic) so I could not really decide if it "fits the theme"; unclear whether 2 of 3 workouts is enough to approve; focus ends on the next submission's button silently. Would change: move focus to the detail heading after selecting a person; descriptive evidence alt/caption; announce who is now shown after an action; skip link to actions.

## T7: Who changed an event
Start: 21:14:50, end: 21:15:17, driver commands: ~11
Outcome in my own words: In the Audit log, filtered by category Events, the newest event entry is "Added an attendee to an event", Nov 17, 3:08 PM, by Alex Admin (Admin): "Added Morgan Lee to Game Cafe". So I answer: Alex Admin, Nov 17 at 3:08 PM. I am not sure that "added an attendee" counts as "changing an event"; there is no entry for editing an event itself, and the event I created myself in T2 is not in the log.
### Think-aloud log
- [21:14:51] (think-aloud) No obvious "history" on the Events page; I guess the nav item "Audit log" under "Insights". Shift+Tab x3 from the start of the page goes backward through nav to "Audit log" (nav is before main, so reverse tabbing was quicker). Enter -> /audit/.
- [21:14:58] Page: "Every admin change: who did it, to what, and why." Good, matches. Table has columns When / What happened / Who / Target / Details. Row text reads well: "Nov 17, 3:08 PM Added an attendee to an event Events Alex Admin (Admin) Added Morgan Lee to Game Cafe".
- [21:15:10] Category select -> Events. Page reloads (focus reset to main), "Showing 3 of 3 entries" in a status. Entries: Nov 17 3:08 PM Alex Admin; Nov 16 7:08 PM Casey Novak (Organizer) "Marked Morgan Lee as attended"; Nov 13 9:08 PM Casey Novak "Removed an event photo".
- [21:15:16] Tried to open Details: Tab from main went Export CSV -> search -> (did not reach Details, skipped it; I already had who/when). 
- CONFUSION: "Game Cafe" in the log vs "Game Café Night" in the events list; the target does not link to the event. Times have no timezone.
### Questionnaire
Ease: 5/7. Confidence: 4/7. Confusing: whether attendee changes count; "Admin" vs "Organizer" in brackets; no timezone; events I just created are not in the log; select change reloads and resets focus to main so I must Tab again. Would change: log event create/edit; link target to the event; keep focus on the filter after changing it.

## T8: Weekly ideas email
Start: 21:15:25, end: 21:16:09, driver commands: ~14
Outcome in my own words: In "Your settings" I changed the weekly ideas email Day from Monday to Tuesday and pressed Save schedule: "Schedule saved." and "Next email: Tuesday, Nov 24 at 9:00 AM PST". Then pressed "Send me a test": "Test queued. It should arrive in a minute." I believe both worked, but I could not verify the inbox.
### Think-aloud log
- [21:15:26] (think-aloud) First I guessed the Audit log by mistake (Shift+Tab x3), realised it, went back; the "Your settings, Alex Admin, Admin" link is the account link at the bottom of the nav, not obviously "settings for email". Shift+Tab x2 + Enter -> /account/.
- [21:15:37] Page "Your settings": "Preferences that belong to you, not to your company." Region "Weekly ideas email" has switch (checked) "Send me weekly event ideas Next email: Monday, Nov 23 at 9:00 AM PST", Schedule (Day/Time selects), Preview, Test. Good structure with headings.
- CONFUSION: "This setting is only for you. Other admins choose for themselves." (switch) vs "This schedule applies to every admin in your company." (schedule) vs page intro "belong to you, not to your company". I changed it fearing I would change it for everyone.
- [21:15:45] `select Day Tuesday` -> Save schedule became enabled; focus reset to main after select.
- [21:15:53] Tabbed Switch -> Day -> Time -> Save schedule, Enter -> "Schedule saved." (status), Next email text updated. Focus dropped to page body.
- [21:16:03] Two similar buttons: "Preview this week's email" (dry run, nothing sent) and "Send me a test" (own inbox). I chose "Send me a test" for "in my own inbox".
- [21:16:09] Enter -> status "Test queued. It should arrive in a minute." Focus on body again. It does not say which address it goes to.
### Questionnaire
Ease: 5/7. Confidence: 6/7. Confusing: personal vs company-wide schedule wording; "Your settings" is the avatar link; focus lost to body after save and after test; the timezone is America/Los_Angeles and not my local one; Preview vs Test labels fairly clear. Would change: restore focus to the button/status after actions; show the destination email in the test message; say clearly who the schedule affects.

## T9: Switch language
Start: 21:16:46, end: 21:18:12, driver commands: ~12 (one select timed out)
Outcome in my own words: Switched to Español and back to English from Your settings, Language section. Whole page changed language immediately both ways ("Tus ajustes", "Idioma"), no save button needed.
### Think-aloud log
- [21:16:46] (think-aloud) No language control on Overview. From T8 I remembered Your settings; Shift+Tab x2 + Enter -> /account/. Region "Language": "The language of DIP Admin in this browser." Options: "Same as this browser (English)", English, Español, "Pseudo (layout test)".
- [21:16:54] First `select` failed (timeout 30 s): the Language select is at the very bottom, not in the element list until I scrolled down. Waiting 30 s with no feedback was painful.
- [21:18:01] Select Español -> page translated at once, focus reset to main (heading "Tus ajustes"). Nav also translated. Next-email time shows "GMT-8" in Spanish vs "PST" in English.
- [21:18:11] Select English -> back, focus on main again.
- CONFUSION: "Pseudo (layout test)" is a developer option shown to admins; the setting is per browser, so it is not clear it is not saved for my account.
### Questionnaire
Ease: 5/7. Confidence: 6/7. Confusing: language lives only on "Your settings" bottom; developer "Pseudo" option; focus reset to main after change. Would change: put a language switch in the nav/header; remove Pseudo for real users; announce the change.

## Overall
Most annoying: T4: the office address could not be entered (Enter submitted the whole event form, "No matches"), and focus repeatedly dropping to body/main after actions. Liked: clear headings/regions, descriptive link names, tag toggles announcing pressed state, error summary moving focus to the first invalid field, and the Review dialog moving focus to its note field.
