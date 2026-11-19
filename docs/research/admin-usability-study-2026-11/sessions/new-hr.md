# Session: new-hr (simulated participant)
Persona: Dana, 38, HR generalist at a 250-person logistics company, made DIP admin yesterday, careful, reads labels, worried about public mistakes.
Setup: Desktop browser 1440x900, English; signed in with "Sign in as admin" (ignored "Preview as organizer").

Note on screenshots: all paths are under scratch/r1/new-hr/shots/ (file name given below).

## T1: How is the team engaging
Start: 20:13:05, end: 20:13:11, driver commands: 3 (goto, shot, scroll+shot)
Outcome in my own words: "Of 30 members, 18 joined at least one event in the last 30 days, with 208 RSVPs and 74% average attendance at the latest 3 completed events. This week's Fitness challenge has 41 of 128 participants done (32%), and 4 submissions wait for review." Caveat: the numbers are for the last 30 days, not "this week", and there is no week switch, so I had to blend two time frames.
### Think-aloud log
- [20:13:05] (think-aloud) I land on Overview. Lots of tiles; I read the subtitle "How your company uses DIP over the last 30 days." My manager said "this week", so I look for a week filter. -> `goto /overview/`, `shot` -> tiles Members 30, Active last 30 days 18, RSVPs 208, Average attendance 74%. Screenshot: 002-t1a.png
- [20:13:11] (think-aloud) No date filter anywhere. I scroll to see if there is a weekly section. I find "This week's theme: Fitness" with Participants 128 / Completed 41, "People" and "Top members by points". -> `scroll down 700`, `shot` -> more charts. Screenshot: 003-t1b.png
- [20:13:12] (think-aloud) "Active, last 30 days 18" and "Members who joined an event" - fine. "Participants 128" is bigger than "Members 30", which makes no sense to me (maybe multiple submissions?). I will not mention it to the manager. I settle on a two-sentence answer using 30-day numbers and say so.
### Questionnaire
Ease: 5/7. Confidence: 4/7. Confusing: Everything is 30 days but my question was "this week"; "Participants 128" in the Fitness card is larger than total Members 30; I could not tell what "Active accounts 29" vs "Active, last 30 days 18" really mean at first glance. Would change: Add a "This week" / "Last 30 days" switch and one plain sentence at the top summarising engagement; explain "Participants" vs "Members".

## T2: Create and publish an event
Start: 20:13:16, end: 20:14:48, driver commands: about 28
Outcome in my own words: "I created 'Board-game night' for Fri Nov 27, 5 to 8 PM, 30 spots, at 'Office, Pittsburgh', tagged Games, dice cover. It shows in the Upcoming list at 0 / 30. There is no separate 'publish' step; the page says members see it as soon as it's created, so I believe it is live, but I never saw the word 'published'."
### Think-aloud log
- [20:13:16] (think-aloud) Events list, I see a "New event" button at the top right. -> `goto /events/`, `list` -> found link "New event".
- [20:13:19] (think-aloud) New event form is very long. The subtitle says "Members see it in the app as soon as it's created." I am slightly worried: is there a draft? I fill Title and Description first. -> `click "New event"`, `shot` -> empty form. Screenshot: 004-t2a.png
- [20:13:29] (think-aloud) Typed title and description. Tag Games seems right. -> `type`, `type`, `click Games` -> ok.
- [20:13:48] (think-aloud) I scroll to the calendar. Today is Wed Nov 18 so "next Friday" is Nov 27 (or Nov 20? I pick the 27th, unsure). I try clicking the text "27". -> `click "27"` -> MISCLICK: it toggled the "Music" tag and jumped me to the top of the page. Screenshot: 007-t2d.png
- [20:13:53] (think-aloud) Oops, Music is highlighted and I did not choose it. I click it again to undo, and use list numbers for the calendar. -> `click Music`, `scroll`, `list` -> found "Friday, November 27, 2026" as number 88.
- [20:13:58] (think-aloud) I click Nov 27. The text says "Fri, Nov 27 chosen as the start. Now choose the end date, or click it again for a one-day event." Confusing: I just want one day. -> `click 88`, `shot`. Screenshot: 008-t2e.png
- [20:14:02] (think-aloud) Click again -> "Fri, Nov 27, one day". OK. Start time says 9:00 PM; I type 5:00 PM. End stays 10:00 PM so duration jumps to 5h, I set 8:00 PM. -> `click 88`, `type 99 "5:00 PM"`, `type 102 "8:00 PM"`, Tab -> works. Screenshot: 009-t2f.png
- [20:14:13] (think-aloud) Capacity 20 -> 30. Venue name "Office". Then I scroll down; only "Create event" and "Cancel". No publish button. -> `type 114 "30"`, `type 108 "Office"`, `scroll` -> form bottom. Screenshot: 010-t2g.png
- [20:14:23] (think-aloud) I click Create event. Nothing happens visibly at the bottom; the page jumped up and a tiny red line says "Pick a cover image." Nothing said earlier that a cover was required. -> `click "Create event"` -> validation error. Screenshot: 011-t2h.png
- [20:14:29] (think-aloud) I pick "Rolling dice" as cover (fits board games). Click Create again. -> `click "Rolling dice"`, `scroll`, `click "Create event"` -> new errors: "Add the street address." "Add the city or area." Screenshot: 012-t2i.png
- [20:14:39] (think-aloud) Errors appear one round at a time (cover first, then address). I type "500 Grant Street" from the "Near 500 Grant Street, Pittsburgh, PA" text. A drop-down says "No matches. Keep typing or enter the address yourself." Then I type the city. -> `type "Street address"`, `press Escape`, `type "City / area" "Pittsburgh"`. Screenshot: 013-t2j.png
- [20:14:47] (think-aloud) Click Create event -> Events list with toast "Created "Board-game night"." Listed as Upcoming 0 / 30. -> `click "Create event"`. Screenshot: 014-t2k.png
- [20:14:48] (think-aloud) It is there, but I did not see "published". I will assume created = visible to everyone, as the page said.
### Questionnaire
Ease: 3/7. Confidence: 5/7. Confusing: No "publish" step or word, so I am not sure it is live; the cover image, street address and city were required but not marked as required, and errors came in two rounds; the calendar needs two clicks for one day and the hint text confused me; clicking the text "27" hit a tag button instead (my driver, but the page also scrolled to the top); the form is very long (cover library with 174 pictures before the date). Would change: Mark required fields with an asterisk; show all errors at once next to the Create button; make a single click on a day mean a one-day event; add an explicit "Save as draft" and "Publish" pair; keep the page position after an error.

## T3: Get ideas from the assistant
Start: 20:14:53, end: 20:15:18, driver commands: about 7
Outcome in my own words: "I found Dipbot in the sidebar, which already showed two ideas. I clicked 'Use this idea' on 'Thursday Trivia Showdown', and it opened a pre-filled New event form. It is NOT a saved draft: there is no 'Save draft' button, only 'Create event', which would make it live straight away. I did not create it because the date and venue were empty and I was afraid of publishing a half-finished event. So I only half completed the task."
### Think-aloud log
- [20:14:56] (think-aloud) "Assistant" in the sidebar: Dipbot is the only thing that looks like it. -> `goto /overview/`, `click "Dipbot"` -> page /ideas/ with 2 idea cards and a 5-step questionnaire (Interests, Goal, Group, Budget, Ask). Screenshot: 015-t3a.png
- [20:15:05] (think-aloud) I never asked for ideas; they are just there ("Updated yesterday"). Good. I pick Trivia, "Use this idea". There is also "Customize with Dipbot" and the questionnaire; I skip them. -> `click "Use this idea"` -> /events/new/?from=ai pre-filled form. Screenshot: 016-t3b.png
- [20:15:16] (think-aloud) The banner says "Filled from a Dipbot draft. Pick a venue and time, review everything, then save." So "draft" here means a pre-filled form. I scroll for a Save draft button: none. Date defaults to today, 9 PM, and no venue. -> `scroll down` -> only "Create event" / "Cancel". Screenshot: 017-t3c.png
- [20:15:18] (think-aloud) I do not dare click Create event because members will see it right away. I stop here.
### Questionnaire
Ease: 4/7. Confidence: 3/7. Confusing: "Dipbot" is not obviously "the assistant"; the word "draft" on the banner but no way to save a draft; "Create event" publishes immediately, so "draft event" cannot happen; the idea cards say "Use this idea" but I did not know what that would do. Would change: Real draft state (saved but hidden from members), and a button "Save as draft"; name the sidebar item "Dipbot (event ideas)".

## T4: Office location and venue
Start: 20:15:28, end: 20:36:40, driver commands: about 25 (including a failed goto and a discard dialog)
Outcome in my own words: "I did not manage it. I typed the office address into the 'Search your office address' box, but the dropdown only said 'No matches. Keep typing or enter the address yourself.' and there was no way to confirm what I typed, and no button to find venues appeared. I gave up."
### Think-aloud log
- [20:15:28] (think-aloud) I try the start page while still on an unsaved form. -> `goto /events/new/?office=unset` -> ERROR ERR_ABORTED (three times).
- [20:15:39] (think-aloud) A dialog "Discard your changes? The event you started won't be saved." appeared behind my Cancel click; I did not see it until a screenshot. -> `click "Cancel"`, `shot`, `click "Discard changes"`. Screenshot: 019-t4b.png
- [20:16:03] (think-aloud) Now on the page. I scroll to the bottom. "Dipbot venues: Set your office address to find venues nearby." with a "Search your office address" field. -> `goto`, `scroll`, `shot`. Screenshot: 020-t4c.png
- [20:24:00] (think-aloud) I type "600 Grant Street, Pittsburgh". Dropdown: "No matches. Keep typing or enter the address yourself. Google Maps". How do I "enter it myself"? No Save button. -> `type 86`, `shot`. Screenshot: 022-t4e.png
- [20:24:11] (think-aloud) I press Enter hoping it saves. It submitted the WHOLE event form: red banner "Fix 6 fields to continue." Scary: if the form had been full, it would have published. -> `press Enter`. Screenshot: 023-t4f.png
- [20:24:25] (think-aloud) My text is still in the box but no change. Tried "600 Grant St" and "Grant Street Pittsburgh PA": still "No matches". Pressed Tab: nothing. No "Find venues" button ever appears. -> `type 79` x2, `press Tab`. Screenshots: 026-t4i.png, 027-t4j.png
- [20:36:35] (think-aloud) I give up; a normal person would stop here and ask IT. I leave via Cancel.
### Questionnaire
Ease: 1/7. Confidence: 1/7. Confusing: The office box wants a Google Maps match but finds none, and says "enter the address yourself" with no way to do that; Enter submits the event form instead of saving the office; there is no confirmation or Save button for the office; the venue search never appears. The Discard dialog appears without warning. Would change: A clear "Save office" button; accept a typed address; Enter should not submit the whole form; show a message if address search is unavailable.

## T6: Add a coworker, resend an invite
Start: 20:36:43, end: 21:02:34, driver commands: about 14 (a goto hung for ~16 minutes)
Outcome in my own words: "Adding Jordan: I could not do it. The only way I found is 'Import people', a spreadsheet upload with a template, and it says email 'must end in @acme.com' while Jordan's is @example.com. I did not try it. Resend: I did it for Nico Farrow in the Roster, Invited tab. DIP does not send email itself; it shows a message I copy and paste to Nico myself. The row now says 'Resent 1x, last Nov 18, 2026'."
### Think-aloud log
- [20:36:43] (think-aloud) Overview has "Invited, not joined: 3 - Resend the invite message from the roster". Goto hung for a long time (did nothing but wait). -> `goto /overview/` -> background timeout.
- [20:53:06] (think-aloud) "Members" in the sidebar sounds like where I add someone. -> `click "Members"` -> page shows list only, with "Export CSV" at the top right. No Add button. Screenshot: 028-t6a.png
- [20:53:19] (think-aloud) Try "Roster". -> `click "Roster"` -> page text "Invited people were added in advance..." plus a blue box: "5 people have signed in but aren't on the roster... Add existing members to the roster". That is not Jordan. Screenshot: 030-t6c.png
- [21:00:02] (think-aloud) The only "add" candidate is the blue "Import people" button. It sounds like a bulk upload. -> `click "Import people"` -> "Add or update many people from a spreadsheet... Drop a .csv or .xlsx file here" plus "Download template". Also "must end in @acme.com". For one coworker this is heavy; I give up on adding Jordan. Screenshot: 031-t6d.png
- [21:00:12] (think-aloud) Back to Roster, tab "Invited (3)" -> Nico, Priya, Tomas, each with "Resend invite" and a red "Revoke". -> `click "Roster"`, `click "Invited (3)"`. Screenshot: 032-t6e.png
- [21:02:22] (think-aloud) I choose Nico (earliest). Click "Resend invite" -> dialog "DIP doesn't send email, so share this message with nico.farrow@acme.com yourself. The resend is recorded (1x)." I expected it to just send. -> `list`, `click 23`. Screenshot: 033-t6f.png
- [21:02:28] (think-aloud) "Copy message" -> toast "Invite message copied." Nico's row: "Resent 1x, last Nov 18, 2026". -> `click "Copy message"`. Screenshot: 034-t6g.png
### Questionnaire
Ease: 2/7. Confidence: 2/7 (for adding Jordan 1/7; for resending 5/7). Confusing: There is no "Add person" anywhere; "Members" is read-only; the word "Roster" vs "Members" vs "Import people"; "Resend invite" does not actually resend anything, the toast "Resend recorded" sounded like it sent; the "5 people have signed in but aren't on the roster" banner distracted me; the email rule "must end in @acme.com". Would change: A plain "Add person" button on Roster (name, email, role); make "Resend invite" label say "Copy invite message"; explain the Members vs Roster difference.

## T8: Weekly ideas email
Start: 21:02:34, end: 21:02:59, driver commands: about 8
Outcome in my own words: "I changed the day to Tuesday and saved ('Schedule saved.', next email now Tuesday, Nov 24 at 9:00 AM PST). I clicked 'Send me a test' and got 'Test queued. It should arrive in a minute.' I cannot confirm it arrived but I believe it did."
### Think-aloud log
- [21:02:38] (think-aloud) A weekly email sounds personal, so I click my name at the bottom left. -> `click "Your settings, Alex Admin, Admin"` -> "Your settings" with a "Weekly ideas email" section at the top. Screenshot: 035-t8a.png
- [21:02:46] (think-aloud) Day dropdown Monday -> Tuesday, then "Save schedule" (it was greyed out until I changed something, good). -> `select 16 Tuesday`, `click "Save schedule"` -> "Schedule saved." Screenshot: 036-t8b.png
- [21:02:53] (think-aloud) Worry: the top says "This setting is only for you" but the Schedule box says "This schedule applies to every admin in your company." So did I just change it for everybody? I cannot tell. -> reading.
- [21:02:53] (think-aloud) "Send me a test" -> clicked; the page scrolled a bit and I saw nothing until I scrolled down: "Test queued. It should arrive in a minute." -> `click "Send me a test"`, `scroll`. Screenshots: 037-t8c.png, 038-t8d.png
### Questionnaire
Ease: 6/7. Confidence: 5/7. Confusing: Contradiction "This setting is only for you" vs "This schedule applies to every admin in your company"; the confirmation for "Send me a test" shows below the fold; "Preview" vs "Test" are two similar boxes; times in America/Los_Angeles while my company is elsewhere (unclear). Would change: Put the confirmation next to the button, and make the personal vs company-wide wording consistent.

## T9: Switch language
Start: 21:03:05, end: 21:03:25, driver commands: about 7
Outcome in my own words: "I switched to Spanish and the whole portal changed right away, with the toast 'Idioma guardado.' Then I switched back to English and the page title went back to 'Your settings'."
### Think-aloud log
- [21:03:08] (think-aloud) No language control on Overview; I remember Language under my settings. -> `click "Your settings..."`, `scroll down 800`, `list` -> "Language" select with: Same as this browser (English) / English / Español / Pseudo (layout test).
- [21:03:14] (think-aloud) "Pseudo (layout test)" is odd - I ignore it. Pick Español. -> `select 20 "Español"` -> page title "Tus ajustes", everything in Spanish, toast "Idioma guardado." Screenshot: 039-t9a.png
- [21:03:23] (think-aloud) The setting is further down and the page is now Spanish; I find it by "Idioma". Pick English. -> `scroll`, `list`, `select 19 "English"` -> back to "Your settings". Screenshot: 040-t9b.png
### Questionnaire
Ease: 6/7. Confidence: 6/7. Confusing: Language is hidden at the bottom of "Your settings" under email stuff; "Pseudo (layout test)" is a weird option for a normal user; the setting says "in this browser", so I wonder whether my colleagues are affected (it says only this browser). Would change: Put a language switch in the sidebar footer; remove or hide "Pseudo (layout test)".

## Overall
Most annoying: No real draft or publish concept plus no way to add a single person: I was afraid to press "Create event" (it goes live at once), and the office-address box in the event form accepted nothing and then Enter submitted the whole form.
Liked: Your settings page: clear sections for the weekly email, a "Preview" and a "Send me a test" button, and the language switch changed everything instantly with a clear toast.
