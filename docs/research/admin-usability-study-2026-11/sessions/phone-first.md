# Session: phone-first (simulated participant)
Persona: Priya, 29, operations lead at a retail chain, does admin on her phone one-handed between store visits, occasional admin.
Setup: Phone 390x844 touch screen, English, signed in with "Sign in as admin" (start page /login/). Screenshots in scratch/r1/phone-first/shots/ (001 to 052).

## T1: How is the team engaging
Start: 20:13:12, end: 20:13:17, driver commands: 6 (incl. sign-in)
Outcome in my own words: "18 of 30 members were active in the last 30 days, with 208 RSVPs and 74% average attendance at the latest events. 3 people are invited but have not joined yet." I trust it; I did not check the chart.
### Think-aloud log
- [20:13:05] (think-aloud) Login page, big dark "Sign in as admin" button, I tap it. -> `shot start` / `click "Sign in as admin"` -> Overview opened. Screenshot: shots/001-start.png
- [20:13:12] (think-aloud) Tiles with numbers, good for a phone. "Active, last 30 days 18" next to "Members 30" answers my question. "Active accounts 29" under Members vs 18 active is slightly confusing. -> `shot` -> readable. Screenshot: shots/002-t1a.png
- [20:13:15] (think-aloud) Scroll for more; chart and "Needs attention" list. The chart has "View as table", I ignore it. -> `scroll down 700` -> Needs attention: "4 Submissions to review", "3 Invited, not joined yet". Screenshot: shots/003-t1b.png
### Questionnaire
Ease: 6/7. Confidence: 5/7. Confusing: "Active accounts" (29) vs "Active, last 30 days" (18) vs 30 members; the page says "this week" is not offered, it is "last 30 days", my manager asked about this week. Would change: a plain sentence summary at the top, and a week view.

## T2: Create and publish an event
Start: 20:13:19, end: 20:23:07, driver commands: about 50 (well over the 25 limit, see capacity mix-up)
Outcome in my own words: I created "Board-game night" on Fri Nov 27, 5:00 to 8:00 PM, tagged Games. It showed as "Upcoming", so I think members can see it. There is no separate publish button; the page said "Members see it in the app as soon as it's created." I fixed capacity to 30 via Edit.
### Think-aloud log
- [20:13:19] (think-aloud) Events list, big "New event" button. -> `goto /events/` / `click "New event"` -> form opened. Screenshot: shots/004-t2a.png, 005-t2b.png
- [20:13:22] (think-aloud) "Members see it in the app as soon as it's created." Hm, so is there a publish step? I just go on. Title, Description, tags. -> `type Title`, `type Description` -> OK.
- [20:13:41] (think-aloud) Today is Wed Nov 18, I read "next Friday" as Nov 27. The calendar is big and scrolling inside it fights with the page scroll; the cover-image box also swallows my scroll: I scroll and the photo grid moves instead of the page. Very annoying one-handed. -> `scroll down` x3 -> stuck in the cover gallery. Screenshots: shots/006 to 008
- [20:14:03] (think-aloud) Gave up scrolling and pressed Tab 12 times to jump forward; the page followed focus. -> `press Tab 12` -> landed on "Venue name". Screenshot: shots/009-t2f.png
- [20:14:12] (think-aloud) Start time says "9:00 PM", end "10:00 PM", with a clock dial. I type 5:00 PM; duration jumps to "5h" because the end stayed 10 PM. I set the end to 8:00 PM. -> `type "Start time"`, `type "End time"` -> OK. Screenshots: shots/010 to 011
- [20:14:25] (think-aloud) Capacity says 20; I type 30. -> `type "Capacity" 30` -> I did not look at it. Tap "Create event". -> `click "Create event"` -> page jumped to the cover section with pink "Pick a cover image." I had not seen cover was required. Screenshot: shots/013-t2j.png
- [20:14:32] (think-aloud) Search for a cover: "dice", pick "Rolling dice". The old pink "Pick a cover image." stays visible even after I picked one. -> `click "Rolling dice"` -> selected. Screenshot: shots/017-t2n.png
- [20:14:50] (think-aloud) Create again -> jumped to the street address: "Add the street address." and "Add the city or area." More hidden required fields. The address box says "No matches. Keep typing or enter the address yourself." so I typed the city by hand. -> `type "Street address"`, `type "City / area"` -> OK. Screenshots: shots/018 to 020
- [20:15:09] (think-aloud) Create -> back to Events with toast "Created “Board-game night”." -> `click "Create event"` -> list. Screenshot: shots/021-t2r.png
- [20:15:15] (think-aloud) Card says "Going 0 / 2030" -> I did not expect 2030. My "30" was added to the existing 20 instead of replacing it. Status "Upcoming". -> `scroll down` -> saw it. Screenshot: shots/022-t2s.png
- [20:15:28] (think-aloud) Tap "Edit"; nothing happens for a while, I tap again, no feedback; the edit page loaded about 15 s later. -> `click "Edit Board-game night"` -> eventually "Edit event". Screenshot: shots/024-t2u.png
- [20:16:01] (think-aloud) Capacity now reads "203030". I select all and type 30 -> "30". "Save changes" -> toast "Saved changes to “Board-game night”." Screenshots: shots/025-t2v.png, 026-t2w.png
### Questionnaire
Ease: 3/7. Confidence: 5/7. Confusing: required fields (cover image, street address, city) only appear after tapping "Create event"; scrolling trapped in the cover grid; capacity "20" is a prefilled value that my typing merged into (2030); not clear if there is a publish step; "Edit" gave no feedback while loading. Would change: show required marks up front, no nested scroll areas on mobile, select the whole number when focusing capacity, and say clearly "This will be live now" on the button.

## T3: Get ideas from the assistant
Start: 20:23:51, end: 20:24:20, driver commands: 8
Outcome in my own words: I found "Dipbot" in the menu, it showed "Ideas for you" and I tapped "Use this idea" on "Thursday Trivia Showdown". It opened a pre-filled New event form: "Filled from a Dipbot draft. Pick a venue and time, review everything, then save." I did not save, because there is only "Create event" and it would go live. I am not sure whether this counts as a "draft event"; I think partially done.
### Think-aloud log
- [20:23:55] (think-aloud) Menu has no word "assistant"; "Dipbot" with a little cloud looks right. -> `click "Open menu"`, `click "Dipbot"` -> /ideas/. Screenshot: shots/027-t3a.png
- [20:24:02] (think-aloud) "Ideas for you" cards with reasons ("Games drew 14 of your last 20 signups"), nice. Wizard tabs below (Interests, Goal, Group, Budget) I skip. -> `shot` Screenshot: shots/028-t3b.png
- [20:24:09] (think-aloud) "Use this idea" -> New event form pre-filled. The words "draft" and "Create event" do not match; I fear saving publishes it. -> `click "Use this idea"` -> /events/new/?from=ai. Screenshots: shots/029-t3c.png, 030-t3d.png
- [20:24:25] (think-aloud) Trying to leave this unsaved form: the start page would not load (the address jump was blocked) and I got stuck for a while; I left through the menu later. -> `goto /overview/` failed twice (ERR_ABORTED).
### Questionnaire
Ease: 5/7. Confidence: 3/7. Confusing: "draft" language vs "Create event" that goes live; "Pick a venue and time" implies a draft state that does not exist; could not leave the page easily. Would change: a real "Save as draft" button.

## T5: Review a challenge submission
Start: 20:24:32, end: 20:59:59, driver commands: about 20
Outcome in my own words: I asked Avery Kim to change her submission ("Only 2 of 3 workouts logged. Please add the third and resubmit.") and the toast confirmed "Requested changes from Avery Kim. They can resubmit while the week is open." Pending went from 13 to 12.
### Think-aloud log
- [20:36:13] (think-aloud) Menu has "Review submissions" under Challenges; tapping it opens "Challenges" first, not the review. Fitness card says "13 pending" but the Overview said 4 submissions to review: do these numbers match? -> `click "Review submissions"` -> /challenges/. Screenshot: shots/033-t5c.png
- [20:36:29] (think-aloud) Clicking the text "Review submissions" timed out since two things have that name; I use the list, then the link "Review submissions for Fitness". -> `list`, `click 4` -> review page. Screenshot: shots/035-t5e.png
- [20:53:05] (think-aloud) A list of people with "2 of 3 workouts", and one selected below with "Approve · 50 points" / "Request changes". I see no photo or proof, so I cannot tell if it "fits the theme". The list box scrolls separately from the page again. -> `scroll down 500` Screenshot: shots/036-t5f.png
- [20:53:12] (think-aloud) 2 of 3 workouts is under the goal, so I ask for changes. Dialog "Request changes from Avery Kim?" with a required note. -> `click "Request changes"`, `keys ...` -> text in. Screenshot: shots/037-t5g.png
- [20:59:58] (think-aloud) Two buttons are named "Request changes" (page and dialog); I pick the dialog one. -> `click 25` -> toast and next person. Screenshot: shots/038-t5h.png
### Questionnaire
Ease: 5/7. Confidence: 6/7. Confusing: no proof or detail for a submission, only counts; 13 pending vs 4 in Overview; hidden J and K shortcuts text means nothing on a phone. Would change: show the evidence, link Overview "Submissions to review" straight to the review page.

## T6: Add a coworker, resend an invite
Start: 21:00:07, end: 21:02:41, driver commands: about 20
Outcome in my own words: I could NOT add Jordan Lee: only a spreadsheet "Import people" exists, and it says emails "must end in @acme.com" (Jordan's is example.com). I did resend an invite to Nico Farrow (invited, not joined), but "DIP doesn't send email, so share this message with nico.farrow@acme.com yourself" and I copied the message; I still have to paste it somewhere.
### Think-aloud log
- [20:53:5x] (think-aloud) Roster page. "Import people" and "Add existing members to the roster" (a blue box about 5 people who signed in; unrelated to my task and confusing). No "Add person". -> `click "Roster"` Screenshot: shots/039-t6a.png
- [21:02:02] (think-aloud) "Import people" = "Add or update many people from a spreadsheet", needs a file; not doing a spreadsheet on my phone for one person. Scrolled for a single add: none. -> `click 3`, `scroll down 800` Screenshots: shots/041, 042
- [21:02:26] (think-aloud) Back to the roster, tab "Invited (3)", Nico Farrow with "Resend invite" and "Revoke" next to each other (close together, one-thumb risk). -> `click "Invited (3)"` Screenshot: shots/044-t6f.png
- [21:02:33] (think-aloud) Resend -> dialog "DIP doesn't send email, so share this message ... yourself. The resend is recorded (1×)." I expected an email to go out. Tap "Copy message" -> "Invite message copied." Screenshots: shots/045, 046
### Questionnaire
Ease: 2/7. Confidence: 2/7 (Jordan not added); 5/7 for the resend but not sure it counts. Confusing: no way to add one person; "Resend invite" does not send anything; "Add existing members to the roster" banner. Would change: an "Add person" form (name and email), and say "Copy invite message" instead of "Resend invite".

## T9: Switch language
Start: 21:02:45, end: 21:03:16, driver commands: 9
Outcome in my own words: Settings (tap my name "Alex Admin" in the menu) has a Language dropdown at the bottom. I chose Español, the whole page changed instantly with "Idioma guardado.", then I chose English and it went back. Done.
### Think-aloud log
- [21:02:48] (think-aloud) No language option in the menu; I guess my profile and tap "Alex Admin". -> `click "Alex Admin"` -> "Your settings". Screenshot: shots/047-t9a.png
- [21:02:54] (think-aloud) Settings starts with the weekly email; language is way down at the bottom. -> `scroll down 900` -> "Language ... Same as this browser (English)". Screenshot: shots/048-t9b.png
- [21:03:02] (think-aloud) Options: English, Español and "Pseudo (layout test)" (strange for a user). -> `select 8 "Español"` -> instant, toast "Idioma guardado." Screenshot: shots/049-t9c.png
- [21:03:14] (think-aloud) Language box at the bottom again, now "Idioma". -> `select 7 "English"` -> back in English. Screenshot: shots/050-t9d.png
### Questionnaire
Ease: 6/7. Confidence: 7/7. Confusing: language buried under the email settings; "Pseudo (layout test)". Would change: a language item in the menu near my name; remove the test option.

## T10: Recover from an error
Start: 21:03:18, end: 21:03:32, driver commands: 6
Outcome in my own words: The message was clear ("Dipbot is busy right now. Nothing was counted against your limit. Try again in a moment."), but "Try again" (tapped twice) did nothing visible. I got ideas anyway because the "Ideas for you" cards at the top still worked ("Use this idea"). Never got new suggestions from the wizard.
### Think-aloud log
- [21:03:19] (think-aloud) Pink message, buttons "Back to choices" and "Try again". -> `goto` / `shot` Screenshot: shots/051-t10a.png
- [21:03:24] (think-aloud) Tap "Try again" -> nothing changed, no spinner or message; tapped again, same. -> `click "Try again"` x2 Screenshot: shots/052-t10b.png
- [21:03:32] (think-aloud) The cards above (Thursday Trivia, Lunch Break 5K Jog, Cookie Decorating ...) are my workaround. -> `read` -> same error remains.
### Questionnaire
Ease: 4/7. Confidence: 5/7. Confusing: Try again gives no sign it worked or failed; the ideas I need are sitting above the error and I would not notice if I did not look. Would change: show "Trying again..." and a count of tries; point to the ideas above in the message.

## Overall
Most annoying: nested scrolling (cover grid) on the New event form and required fields that only show up after tapping Create, with a capacity number that merges with the old value (20 became 2030).
Liked: the Overview tiles and "Ideas for you" cards with a reason on each; the language switch just worked with a clear confirmation.
