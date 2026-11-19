# Session: office-mgr (simulated participant)
Persona: Marcus, 45, office manager at a 60-person design studio; busy, impatient, skims, clicks the first plausible thing.
Setup: Desktop browser 1440x900, English; signed in with "Sign in as admin" (Alex Admin).

Shots dir: scratch/r1/office-mgr/shots/

## T1: How is the team engaging
Start: 20:13:05, end: 20:13:15, driver commands: 4
Outcome in my own words: "18 of our 30 people joined an event in the last 30 days, with 208 RSVPs and about 74% average attendance. On this week's Fitness challenge, 41 of 128 participants have finished." Not a true "this week" number, the page is all "last 30 days"; I blended two cards.
### Think-aloud log
- [20:13:05] (think-aloud) Overview should answer this; I want a "this week" figure. -> `goto /overview/`, `shot` -> tiles all say "last 30 days". Screenshot: .../002-t1.png
- [20:13:11] (think-aloud) Header says "How your company uses DIP over the last 30 days", not this week. The "This week's theme" card further down might be closer. -> `scroll down 600` -> theme card: Participants 128, Completed 41, "Day 3 of 7". Screenshot: .../003-t1b.png
- [20:13:15] (think-aloud) Good enough, I'll answer with 18/30 active, 208 RSVPs, 74% attendance, plus the challenge numbers. Unsure which is "the" engagement number.
### Questionnaire
Ease: 5/7. Confidence: 4/7. Confusing: everything is "last 30 days" while my manager asked about this week; "Active, last 30 days: Members who joined an event" vs "29 active accounts" under Members, two meanings of "active". Would change: add a "this week" toggle and a one-line summary at the top.

## T2: Create and publish an event
Start: 20:13:17, end: 20:14:35, driver commands: about 36 (over the 25 budget; stopped, event NOT created)
Outcome in my own words: I could not finish. After filling title, description, tag, date, time and capacity, "Create event" refused three times for things I had not been told were required (cover image, street address, city). I gave up before creating it. There is no separate "Publish" step; the header says "Members see it in the app as soon as it's created", which I only found by reading.
### Think-aloud log
- [20:13:17] (think-aloud) Events list, I want "New event". -> `goto /events/`, `list` -> found "New event" link. Screenshot: .../004-t2.png
- [20:13:20] -> `click 14` -> New event form, long page. Screenshot: .../005-t2b.png
- [20:13:30] (think-aloud) Title and description first. -> `type 15`, `type 16` -> filled.
- [20:13:36] -> `click "Games"` -> Games tag on. I wanted "Social" too but skipped it.
- [20:13:43] (think-aloud) Capacity says 20, I type 30. -> `type "Capacity" 30` -> field showed "2030"; my 30 was appended to the default 20. Noticed it only later in a list. (Possibly a driver quirk; later `type 114 30` replaced it fine.)
- [20:13:50] (think-aloud) I clicked "27" thinking it was the calendar day. -> `click 27` -> that was a stale number and hit the "Music" tag instead, and the page jumped to the top. Screenshot: .../008-t2f.png. My error, but the list numbers are easy to get wrong when the page is this long.
- [20:13:57] -> `click "Music"` (untick).
- [20:14:02] (think-aloud) Calendar help: "Click a start date, then an end date. Click the same day twice for a one-day event." Odd for a Friday party. -> `click 88` twice -> Fri Nov 27 selected, "Fri, Nov 27, one day". I assumed "next Friday" = Nov 27; it could have been Nov 20 (confusing, not the page's fault).
- [20:14:12] (think-aloud) Time defaults to 9:00 PM; I need 5 PM. The "After work 5:30 to 7:30 PM" chip is close but not what I asked. -> `type 99 "5:00 PM"` -> start 5:00 PM, end stayed 10:00 PM (5 h duration, clock turned big). Screenshot: .../010-t2h.png
- [20:14:19] -> `type 102 "8:00 PM"`, `type 108 "Office"` -> ok.
- [20:14:27] (think-aloud) No Publish button, just "Create event". -> `click "Create event"` -> nothing happened visibly; page scrolled up. Red text far from the button: "Pick a cover image." Screenshot: .../012-t2j.png
- [20:14:33] -> clicked "Rolling dice" cover, `click "Create event"` -> now red "Add the street address." and "Add the city or area." Screenshot: .../013-t2k.png. Third separate surprise; I stopped.
### Questionnaire
Ease: 2/7. Confidence: 2/7 (not sure it is live; it is not). Confusing: "Cover image" is required but not marked; "Street address" and "City / area" required but not marked, and I typed "Office" in Venue name thinking that was enough; errors appear one batch at a time and the first was off-screen from the button; the page is very long with 174 covers in the middle; "Dipbot suggests" and "Generate suggestions 10 credits" and "Let Dipbot choose 1 credit" all look like paid things I do not understand. Would change: mark required fields, show all errors at once and scroll to the first, put Create event somewhere always visible, offer "Use office address" for events at the office, make "Create" vs "Publish" explicit.

## T4: Office location and venue
Start: 20:14:43, end: 20:23:03, driver commands: about 20 (gave up)
Outcome in my own words: I never managed to set the office. The office box only shows "No matches. Keep typing or enter the address yourself." for "600 Grant Street, Pittsburgh", "600 Grant" and "600 Grant Street, Pittsburgh, PA 15219". I could not find a way to "enter it yourself". No venues found.
### Think-aloud log
- [20:14:43] -> `goto /events/new/?office=unset` -> error twice (ERR_ABORTED); the old unsaved form was blocking. -> `click "Cancel"` -> dialog "Discard your changes? The event you started won't be saved." (clear) -> `click "Discard changes"` -> `goto` worked. Screenshot: .../015-t4b.png
- [20:15:03] (think-aloud) Scrolled down a long way before I saw it. At the bottom, box "Dipbot venues": "Set your office address to find venues nearby." with a field "Search your office address". Screenshot: .../016-t4c.png
- [20:15:16] -> `type 86 "600 Grant Street, Pittsburgh"` -> dropdown: "No matches. Keep typing or enter the address yourself." Google Maps. Screenshot: .../018-t4e.png
- [20:15:28] (think-aloud) "Enter the address yourself": I'll press Enter. -> `press Enter` -> it submitted the whole event form: "Fix 6 fields to continue." Title must be 1 to 120 characters, etc. Screenshot: .../019-t4f.png. Annoying.
- [20:15:55] -> `type 79 "600 Grant"` -> "No matches". Screenshot: .../020-t4g.png
- [20:22:45] -> `type 79 "600 Grant Street, Pittsburgh, PA 15219"` -> "No matches". Screenshot: .../021-t4h.png. I gave up. Also noticed the earlier event form said "Near 500 Grant Street" (a different office), but I would not have known this is where to change it ("Change office" link).
### Questionnaire
Ease: 1/7. Confidence: 1/7 (office not set). Confusing: the office setting lives inside an event form, scrolled to the bottom; "No matches. Keep typing or enter the address yourself." with no visible manual field or button; Enter submits the whole event form. Would change: a real office setting in a settings page; a manual "Use this address" option when search finds nothing; Enter should not submit.

## T5: Review a challenge submission
Start: 20:24:07, end: 20:36:38, driver commands: 13
Outcome in my own words: Opened this week's Fitness challenge, looked at Avery Kim's entry (note "Morning stretch routine, every day." but the photo was a cafe interior), asked for changes with a short note. Got a toast "Requested changes from Avery Kim. They can resubmit while the week is open." and Avery dropped from the Pending list.
### Think-aloud log
- [20:24:14] -> `click "Review submissions"` (left nav) -> Challenges table, every row says "13 pending". Screenshot: .../022-t5a.png
- [20:24:20] (think-aloud) 13 pending on every row, yet the Overview said "3 to review" on the theme card and 4 in "Needs attention", later 64. Which number is true? -> `click 14` (stale number, error) -> `list` -> `click 15` (this week's row) -> review page. Screenshot: .../024-t5c.png
- [20:24:55] (think-aloud) Clear page: big "Approve · 50 points" and "Request changes". Photo does not match a fitness theme. -> `click "Request changes"` -> dialog "What should they change? (required)". Screenshot: .../025-t5d.png
- [20:36:30] -> `keys` note, `list`, `click 38` -> toast confirmation. Screenshot: .../026-t5e.png
### Questionnaire
Ease: 6/7. Confidence: 6/7. Confusing: "13 pending" on every challenge versus 3 or 4 on the Overview; the six keyboard shortcut chips (J, K, A, R) take space. Would change: make the pending counts consistent; mention the member sees my note.

## T6: Add a coworker, resend an invite
Start: 20:36:43, end: 21:02:11, driver commands: about 14 (first half failed, second half worked)
Outcome in my own words: I could NOT add Jordan Lee. Members has no add button; Roster's blue "Import people" opens a spreadsheet-only upload and says emails "must end in @acme.com" (Jordan is example.com). I did resend an invite for Nico Farrow, but the page says "DIP doesn't send email, so share this message with nico.farrow@acme.com yourself", so nothing was actually sent.
### Think-aloud log
- [20:36:43] -> `goto /overview/` (command hung in the background but page loaded).
- [20:53:05] (think-aloud) People section, "Members" first. -> `click "Members"` -> list of 30 people with only "Export CSV". Screenshot: .../028-t6b.png
- [20:53:18] -> `click "Roster"` -> Roster, top right blue "Import people", a banner "5 people have signed in but aren't on the roster... Add existing members to the roster". Screenshot: .../030-t6d.png. The banner looked like the add button but is about someone else.
- [20:53:20] -> `click "Import people"` -> "Add or update many people from a spreadsheet." "Drop a .csv or .xlsx file here", "Download template", "Email... must end in @acme.com". Screenshot: .../032-t6f.png. I do not want a spreadsheet for one person. Gave up adding Jordan.
- [21:00:15] -> `click "Roster"`, `click "Invited (3)"` -> three people each with "Resend invite" and "Revoke". Screenshot: .../033-t6g.png
- [21:02:03] -> `click 23` (Nico Farrow) -> dialog "Invite message for Nico Farrow. DIP doesn't send email, so share this message with nico.farrow@acme.com yourself. The resend is recorded (1x)." plus toast "Resend recorded for Nico Farrow. Copy the message to share it." Screenshot: .../034-t6h.png. Surprised, expected an email.
- [21:02:09] -> `click "Copy message"` -> I assume it's copied.
### Questionnaire
Ease: 2/7. Confidence: 1/7 for adding Jordan, 3/7 for the resend. Confusing: no single "Add person" anywhere; "Import people" only takes files; "Add existing members to the roster" sounds like the add button; "Resend invite" does not resend anything; "Resend recorded" toast sounds like it worked; Members (30) vs Roster Everyone (29). Would change: an "Add person" form with name and email; make the resend wording "Copy invite message"; explain acme.com-only.

## T8: Weekly ideas email
Start: 21:02:15, end: 21:02:41, driver commands: about 10
Outcome in my own words: Changed the day from Monday to Tuesday, saved ("Schedule saved." next email now Tuesday, Nov 24 9:00 AM PST), then "Send me a test" gave "Test queued. It should arrive in a minute." (visible only after scrolling).
### Think-aloud log
- [21:02:15] (think-aloud) "Ideas" sounds like Dipbot. -> `click "Dipbot"`, `read` -> idea cards and a wizard, no email settings.
- [21:02:19] (think-aloud) Settings are usually under my name. -> `click "Alex Admin"` -> Your settings, "Weekly ideas email". Screenshot: .../035-t8a.png
- [21:02:28] -> `list`, `select 16 Tuesday`, `click "Save schedule"` -> "Schedule saved." Screenshot: .../036-t8b.png
- [21:02:34] -> `click "Send me a test"` -> no visible change at first (message was below the fold). Screenshot: .../037-t8c.png -> `scroll down` -> "Test queued. It should arrive in a minute." Screenshot: .../038-t8d.png
### Questionnaire
Ease: 4/7. Confidence: 5/7. Confusing: weekly ideas email is under my name, not under Dipbot; "This setting is only for you. Other admins choose for themselves." versus "This schedule applies to every admin in your company." contradict each other; after "Send me a test" nothing visible near the button; "Dry run: nothing is sent" vs "Send me a test" is jargon-ish. Would change: put the confirmation next to the button, clarify who the schedule changes for.

## T10: Recover from an error
Start: 21:02:46, end: 21:03:15, driver commands: about 10
Outcome in my own words: The assistant said "Dipbot is busy right now. Nothing was counted against your limit. Try again in a moment." I tried "Try again" twice and "Generate drafts" once, same message each time. In the end I took a ready idea ("Thursday Trivia Showdown") via "Use this idea", which opened a pre-filled new-event form. I did not get freshly generated ideas.
### Think-aloud log
- [21:02:46] -> `goto /ideas/?step=results&ai=error`, `shot` -> the error text is clear and the credits reassurance is nice. Screenshot: .../039-t10a.png
- [21:02:53] -> `click "Try again"` -> same message, no sign anything happened (no spinner). Screenshot: .../040-t10b.png
- [21:03:00] -> `click "Try again"` again, `click "Back to choices"` -> form shows my earlier answers kept (Interests Fitness, Games; Budget Under $15, After work). Screenshot: .../041-t10c.png
- [21:03:07] -> `click "Generate drafts"` (10 credits) -> same error. Screenshot: .../042-t10d.png
- [21:03:14] (think-aloud) The ideas at the top are still there. -> `click "Use this idea"` -> New event, "Filled from a Dipbot draft. Pick a venue and time, review everything, then save." Screenshot: .../043-t10e.png
### Questionnaire
Ease: 5/7. Confidence: 4/7. Confusing: "Try again" gives no feedback so I could not tell if it re-ran; no hint that the cards on top are a fallback. Would change: show a spinner and a retry count, and say "meanwhile, here are your last ideas".

## Overall
Most annoying: Creating the event: three separate silent requirements (cover image, street address, city) with the error text far from the button; and not being able to add one person without a spreadsheet.
Liked: Review submissions (big clear Approve / Request changes, a note box, a toast) and the "Discard your changes?" dialog.
