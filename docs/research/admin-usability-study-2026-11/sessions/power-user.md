# Session: power-user (simulated participant)
Persona: Tom, 44, IT-adjacent admin, wants speed/density/control, skeptical of AI and credits. Setup: desktop 1440x900, English.
## T1: How is the team engaging
Start: 21:08:01, end: 21:08:12, driver commands: 4 (login, goto, shot)
Outcome in my own words: 18 of 30 members joined an event in the last 30 days (about 60%), 208 RSVPs and 74% average attendance; this week's Fitness theme has 128 participants, 41 completed.
### Think-aloud log
- [21:07:56] (think-aloud) Login page, two buttons; "Sign in as admin" is obvious -> click -> landed on Overview. Screenshot: shots/001-start.png
- [21:08:10] (think-aloud) Dense stat cards, good. But header says "How your company uses DIP over the last 30 days", my manager asked "this week"; no week filter visible. I combine the 30-day cards with the "This week's theme" card (Participants 128, Completed 41, "Day 3 of 7"). "Active, last 30 days 18 / Members who joined an event" is the key number. Screenshot: shots/002-t1.png
### Questionnaire
Ease: 6/7. Confidence: 5/7. Confusing: no way to see "this week" for engagement; only 30 days. "Active" definition is only a subtitle. Would change: a date range switch (7/30 days).

## T3: Get ideas from the assistant
Start: 21:08:12, end: 21:08:30, driver commands: ~8
Outcome in my own words: Found "Dipbot" in the sidebar (name is not obviously "the assistant"). Page already showed two ideas. I used "Use this idea" on "Lunch Break 5K Jog" and landed on New event prefilled ("Filled from a Dipbot draft. Pick a venue and time, review everything, then save."). It is NOT saved; the only save button is "Create event" and the header says "Members see it in the app as soon as it's created." So I don't think a true draft exists; I stopped without pressing Create so as not to publish. Task only half done by my own judgement.
### Think-aloud log
- [21:08:12] (think-aloud) Where is "the assistant"? Sidebar has "Dipbot" with a cloud icon, guessing that is it -> click Dipbot -> /ideas/ page. Screenshot: shots/003-t3a.png
- [21:08:15] (think-aloud) Good: ideas are already there ("Ideas for you", two cards). Refresh costs "3 credits", "Customize with Dipbot", "Use suggestions" and "Refresh suggestions 1 credit" are unclear; "Use suggestions" vs "Use this idea" confusing. I avoid anything with credits. "Use this idea" has no price tag, so I click it on Lunch Break 5K Jog -> New event page prefilled. Screenshot: shots/004-t3b.png
- [21:08:21] (think-aloud) Banner "Filled from a Dipbot draft" good. Title, description, tags, cover ("Dipbot picked this") filled. But start time defaults to 10:00 PM tonight and Capacity 20; a lunch jog at 10 PM is silly. Scrolled to bottom: only "Create event" and "Cancel", no "Save as draft". Header says members see it as soon as it is created -> I do not press it, a draft should not go live. Screenshot: shots/005-t3c.png
### Questionnaire
Ease: 5/7. Confidence: 3/7. Confusing: "draft" wording vs "Create event" which publishes immediately; "Generate suggestions 10 credits" on the event page; unclear which buttons cost credits ("Use suggestions" no price while "Refresh suggestions" 1 credit); default time 10:00 PM. Would change: a real "Save as draft" or "Create (unpublished)" button; sensible default time; state clearly that using an idea is free.

## T4: Office location and venue
Start: 21:08:30, end: 21:09:40, driver commands: ~22
Outcome in my own words: Failed. I could not set the office to 600 Grant Street, Pittsburgh. The office address search says "No matches. Keep typing or enter the address yourself." for "600 Grant Street, Pittsburgh", "600 Grant", and with ", PA". Only the bare word "Pittsburgh" gave a list (Schenley Park, Primanti Bros., 412 Forbes Avenue...), none of them 600 Grant. I never found a way to "enter the address yourself". So no venue search either.
### Think-aloud log
- [21:08:30] (think-aloud) goto the start page failed twice (ERR_ABORTED): the earlier unsaved form blocked leaving. I clicked Cancel -> modal "Discard your changes? The event you started won't be saved." Fine and clear -> "Discard changes". Screenshot: shots/008-t4c.png
- [21:08:40] (think-aloud) New event page. Scrolled to the bottom; under "Where" there is a "Dipbot venues" box: "Set your office address to find venues nearby." with a field "Search your office address" -> typed 600 Grant Street, Pittsburgh. Screenshot: shots/012-t4g.png
- [21:08:55] (think-aloud) Dropdown says "No matches. Keep typing or enter the address yourself." with "Google Maps" footer. No visible way to confirm my typed text; no Save button -> tried shorter "600 Grant" -> same. Screenshot: shots/013-t4h.png
- [21:09:09] (think-aloud) Pressed Enter hoping it accepts the text. It submitted the whole event form ("Fix 6 fields to continue." with errors on Title, Description, address, venue, city) and jumped me to the top. That was a surprise and annoying; the office stayed unset. Screenshot: shots/014-t4i.png
- [21:09:25] (think-aloud) Select-all via Ctrl+a did not clear the field, text got duplicated ("600 Grant Street600 Grant Street, Pittsburgh, PA"). "Pittsburgh" alone gave suggestions but not my street. I give up here. Screenshot: shots/017-t4l.png
### Questionnaire
Ease: 2/7. Confidence: 1/7. Confusing: "No matches. Keep typing or enter the address yourself." but there is no way to enter it; Enter submits the entire form; no confirmation that the office is saved; where office is stored (company-wide?) unclear. Would change: accept a typed address with an explicit "Use this address" button; Enter must not submit the form from this field; show saved state.

## T6: Add a coworker, resend an invite
Start: 21:10:00, end: 21:10:40, driver commands: ~12
Outcome in my own words: Resend: done (Nico Farrow, via Roster > Invited (3) > "Resend invite"), but it only records a resend and gives me a message to copy and send myself ("DIP doesn't send email"). Add Jordan Lee: failed. I found no "Add person" button anywhere. Members has none; Roster only has "Import people", which is a CSV/XLSX upload, and it says email "must end in @acme.com" while Jordan's is example.com. I can't make a file here, so I gave up on adding Jordan.
### Think-aloud log
- [21:10:00] (think-aloud) Overview "Needs attention: Invited, not joined yet" is helpful for resend. For adding, I try Members first: it has "Export CSV" and search ("press / to focus", nice) but no Add. Screenshot: shots/018-t6a.png
- [21:10:08] (think-aloud) Roster: tabs Everyone (29), Invited (3)... but Members says 30. Banner "5 people have signed in but aren't on the roster... Add existing members to the roster" is confusing and unrelated to my task. Button top-right "Import people" -> /import/. Screenshot: shots/019-t6b.png
- [21:10:14] (think-aloud) Import page: "Drop a .csv or .xlsx file here", "Download template", steps Upload, Match columns, Review, Import. For ONE person this is heavy. "must end in @acme.com" blocks jordan.lee@example.com. No manual add form. Gave up on add. Screenshot: shots/020-t6c.png
- [21:10:20] (think-aloud) Back to Roster, Invited (3) tab: Nico Farrow, Priya Shah, Tomas Reyes, each with "Resend invite" and "Revoke" (red). Clear. Screenshot: shots/021-t6d.png
- [21:10:30] (think-aloud) Clicked "Resend invite to Nico Farrow" (picked oldest, Nov 6) -> dialog "DIP doesn't send email, so share this message with nico.farrow@acme.com yourself. The resend is recorded (1x)." plus a Copy message button; toast "Resend recorded for Nico Farrow. Copy the message to share it." Surprised: I expected an email to go out. Screenshot: shots/022-t6e.png
### Questionnaire
Ease: 3/7. Confidence: 4/7 (resend), 1/7 (add). Confusing: no single-person add; Import is the only route and is file-only; "Resend invite" does not send; Members 30 vs Roster 29; the "5 people have signed in but aren't on the roster" banner. Would change: an "Add person" button on Roster and Members; rename "Resend invite" to "Get invite message" or actually send; explain the roster vs members difference.
## T7: Who changed an event
Start: 21:10:59, end: 21:11:25, driver commands: 7
Outcome in my own words: Audit log (sidebar, Insights) filtered to category Events: the latest event-related entry is "Added an attendee to an event", Alex Admin (Admin), Nov 17, 3:08 PM ("Added Morgan Lee to Game Cafe"). There is no entry that says an event was edited, so I answer with that and note the caveat. Other entries: Casey Novak recorded attendance Nov 16; removed event photo Nov 13.
### Think-aloud log
- [21:10:59] (think-aloud) "Audit log" in the sidebar sounds exactly right -> click -> table with When / What happened / Who / Target, 10 entries, search box ("press / to focus") and Category filter. Love it. Screenshot: shots/023-t7a.png
- [21:11:09] (think-aloud) Select Category "Events" -> 3 entries. Nothing says "edited event"; closest is attendee added. My own earlier resend shows up too (reassuring: it logs me). Screenshot: shots/023-t7a.png
- [21:11:13] (think-aloud) Clicking "Details" by text timed out because every button is named "Show details for ..."; clicking by number worked. Details row shows "Action key: attendee.add · Reference: attendee game-cafe/uid-member": raw developer text; the header promises "and why" but there is no reason. Screenshot: shots/025-t7c.png
### Questionnaire
Ease: 6/7. Confidence: 4/7. Confusing: no distinct "event edited" entry (are event edits logged at all?); "Details" shows internal keys; "latest 100 entries" only; no date filter. Would change: human-readable details, show before/after values, date range filter.

## T8: Weekly ideas email
Start: 21:11:27, end: 21:11:55, driver commands: 8
Outcome in my own words: Done. Avatar/name "Alex Admin" bottom-left opens "Your settings". Set Day to Tuesday, clicked "Save schedule" -> "Schedule saved." and "Next email: Tuesday, Nov 24 at 9:00 AM PST". Then "Send me a test" -> "Test queued. It should arrive in a minute." I can't verify my inbox from here.
### Think-aloud log
- [21:11:27] (think-aloud) Guessing the user block at the bottom-left is where personal settings live -> "Your settings" page with "Weekly ideas email". Found on first try. Screenshot: shots/026-t8a.png
- [21:11:34] (think-aloud) Odd: "This setting is only for you. Other admins choose for themselves." but "This schedule applies to every admin in your company." So my Tuesday change moves it for everyone. I would want a warning before saving; none given. Also "uses 3 credits a week for your company". Skeptic note.
- [21:11:37] (think-aloud) Select Tuesday -> "Save schedule" button enabled -> click -> "Schedule saved.", next email date updated. Screenshot: shots/027-t8b.png
- [21:11:45] (think-aloud) "Send me a test" (cloud icon, no credit label) -> clicked; nothing visible changed at first because the confirmation is below the fold (page just shifted). Scrolled and found "Test queued. It should arrive in a minute." Credits unchanged at 412. Screenshots: shots/028-t8c.png, shots/029-t8d.png
### Questionnaire
Ease: 6/7. Confidence: 5/7. Confusing: personal vs company-wide schedule wording; confirmation message for the test appears below the button, off-screen; "Preview" vs "Send me a test" similar; cloud icons suggest AI/credits on both. Would change: warn that the schedule change affects all admins; show toast near the button; say explicitly the test is free.
## T10: Recover from an error
Start: 21:12:07, end: 21:12:40, driver commands: 7
Outcome in my own words: Partly. Fresh AI drafts never came: "Try again" (twice) and "Generate drafts" (10 credits) all returned "Dipbot is busy right now. Nothing was counted against your limit. Try again in a moment." Credits stayed at 412 of 500. I did get ideas anyway because the two ready-made cards at the top ("Thursday Trivia Showdown", "Lunch Break 5K Jog") remained on the page.
### Think-aloud log
- [21:12:07] (think-aloud) Red/pink box: "Dipbot is busy right now. Nothing was counted against your limit. Try again in a moment." Good, plain, and it answers my credit worry. Buttons "Back to choices" and "Try again". The idea cards stay above. Screenshot: shots/030-t10a.png
- [21:12:13] (think-aloud) Click "Try again" -> looks identical, no spinner I could see, no "tried again at ..." text; unsure whether anything happened. Tried a second time, same. Screenshot: shots/031-t10b.png
- [21:12:21] (think-aloud) "Back to choices" -> my answers are kept ("Interests Fitness, Games; Goal Team bonding; Group Team, Indoors; Budget Under $15, After work"). Nice, nothing lost. Screenshot: shots/032-t10c.png
- [21:12:31] (think-aloud) "Generate drafts 10 credits" -> same error again, credits 412 unchanged. At this point I stop retrying and use the existing idea cards. Screenshot: shots/033-t10d.png
### Questionnaire
Ease: 5/7. Confidence: 4/7. Confusing: no sign that "Try again" did anything (same message, no timestamp/progress); "Try again in a moment" does not say how long; no hint to use the ready ideas above as a fallback. Would change: show a "Retrying..." state and attempt count; point to the existing ideas; keep the "nothing counted" line.

## Overall
Most annoying: In T4 the office address box said "No matches. Keep typing or enter the address yourself." yet gave no way to accept my own address, and Enter submitted the entire event form. Close second: no way to add one person (T6), only a file import with an @acme.com restriction.
Liked: The Audit log (T7): dense table, search with "/" shortcut, category filter, and it logged my own actions. Also honest wording like "DIP doesn't send email" and "Nothing was counted against your limit".
