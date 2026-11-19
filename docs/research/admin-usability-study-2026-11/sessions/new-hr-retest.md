# Session: new-hr (re-test) (simulated participant)
Persona: Dana, 38, HR generalist, first day as DIP admin. Setup: Desktop 1440x900, English.

## T2: Create and publish an event
Start: 21:51:53, end: 21:53:46, driver commands: ~38 (over the 25 budget because of a misclick and the address step)
Outcome in my own words: I created "Board-game night", Fri Nov 27, 5-8 PM, 30 spots, tag Games, cover "Rolling dice". It shows in the Events list as "Upcoming" with a toast "Created "Board-game night"". I believe it is published, because the page said "Members see it in the app as soon as it's created", but there was no explicit "Publish" word anywhere so I am only fairly sure.
### Think-aloud log
- [21:51:53] (think-aloud) Login page, two buttons. I am an admin so "Sign in as admin". "Preview as organizer" is unclear. -> `shot`/`click "Sign in as admin"` -> Overview.
- [21:52:07] (think-aloud) Events list, big blue "New event" button, easy. -> `click "New event"` -> form.
- [21:52:11] (think-aloud) "Everything is required unless it says optional." Good. Title and description first. -> `type` -> ok. Tags "(optional)", I picked Games.
- [21:52:31] (think-aloud) I need the date. Scrolled; the calendar is far down the page. I clicked an old list number and hit the "Music" tag by mistake and the page jumped to the top (my driver misclick, not the site). Un-toggled Music.
- [21:52:42] (think-aloud) Clicked Friday Nov 27 ("next Friday", but Nov 20 is also a Friday, so a bit ambiguous). -> date set, Starts says "10:00 PM" by default, odd default for a social event.
- [21:52:47] (think-aloud) Typed 5:00 PM in Start time; end stayed at 11:00 PM and duration became "6h". I changed End to 8:00 PM. -> ok. Clock dial is nice but I did not need it.
- [21:52:54] Capacity said 20, changed to 30. Fine.
- [21:53:00] Venue name "Office", City "Pittsburgh" typed by me. Did not touch street address (it says "Search an address or place", it did not look required).
- [21:53:07] -> `click "Create event"` -> stayed on page with red box "Fix these to create the event": "Cover image: Pick a cover image." and "Street address: Add the street address." Clear and clickable, I liked it. I had missed the cover image completely because I had scrolled past it; it is not marked optional but nothing flagged it earlier.
- [21:53:13] Searched covers "game", picked "Rolling dice". Cover shows with a checkmark. The red error box stayed visible after I fixed it (slightly worrying, was it fixed?).
- [21:53:24] Clicked the error link "Street address: Add the street address." -> focus jumped to the street field. Nice. Typed "500 Grant Street" -> dropdown with "500 Grant Street, Pittsburgh, PA" and "Google Maps".
- [21:53:38] Picked the suggestion. City changed to "Pittsburgh, PA", but the street field still showed a red "Add the street address." under "500 Grant Street". Confusing, it looks filled. I just tried Create anyway.
- [21:53:45] -> `click "Create event"` -> back on Events list, toast "Created "Board-game night"." Listed Fri Nov 27 5:00 PM to 8:00 PM, Office, Pittsburgh PA, Free, 0 / 30, Upcoming. Screenshot: scratch/r2/new-hr/shots/017-t2p.png
### Questionnaire
Ease: 5/7. Confidence: 5/7. Confusing: no "Publish" step or word, so I had to trust the subtitle line "Members see it in the app as soon as it's created"; the cover image and street address were required but I only learned that after submitting; the stale red "Add the street address." under a filled street field; the 10:00 PM default start time and that changing start left end at 11 PM; calendar is far down a very long page below 174 covers; "next Friday" ambiguity is mine.
Would change: put cover required marker up front or default one; clear the error as soon as it is fixed; default times like 5 PM; say "Created and visible to everyone" in the toast; a "Published" status instead of "Upcoming".

## T3: Get ideas from the assistant
Start: 21:54:05, end: 21:54:30, driver commands: 8
Outcome in my own words: I found the assistant ("Dipbot" in the sidebar), saw two ready ideas, clicked "Use this idea" on "Thursday Trivia Showdown" and got a New event form pre-filled (title, description, tags, cover, capacity 24). I did NOT save it: there is no "Save as draft", only "Create event", which the page says shows it to members immediately. So I am not sure I made a "draft event"; I have a pre-filled form that is unsaved. I stopped there.
### Think-aloud log
- [21:54:05] (think-aloud) Overview page has many numbers; nothing called "assistant" or "ideas". -> `goto /overview/`, `shot` -> I guess "Dipbot" with the cloud icon in the left menu.
- [21:54:11] -> `click "Dipbot"` -> page titled Dipbot: "Work with Dipbot to plan your next event: answer four quick questions, add a note, and get drafts to review." Good, matches. Top has "Ideas for you" with two cards, "Use this idea" and "Customize with Dipbot". Below, tabs 1 Interests, 2 Goal, 3 Group, 4 Budget, 5 Ask, a "Next" button. A lot at once; I was unsure whether I must answer the questions first. Credits "412 of 500 this month", "Refresh ideas 3 credits" make me nervous about spending credits. Screenshot: scratch/r2/new-hr/shots/019-t3b.png
- [21:54:17] (think-aloud) The first idea looks fun and shows no credit cost. -> `click "Use this idea"` -> New event form with blue banner "Dipbot filled this in. Nothing is saved yet. Pick a venue and time, check the details, then press Create event." Reassuring and clear. Title, description, cover "Chess in the dark" with badge "Dipbot picked this". Screenshot: scratch/r2/new-hr/shots/020-t3c.png
- [21:54:24] (think-aloud) I want to save it as a draft, not publish yet. -> `scroll down`, `shot` -> only "Create event" and "Cancel". Subtext "Members see it in the app as soon as it's created." So no draft concept. I would not click it without picking venue/time and being ready to publish. Stopped. Time still defaults to Wed Nov 18 10:00 PM, which would be a past/odd time. Screenshot: scratch/r2/new-hr/shots/021-t3d.png
### Questionnaire
Ease: 6/7. Confidence: 4/7. Confusing: the word "assistant" is not used, I had to guess it was "Dipbot"; "draft" vs "Create event" (no way to save without publishing); the Dipbot page shows a lot (ideas, 5 step tabs, credits) at once; difference between "Use this idea" and "Customize with Dipbot" and whether either costs credits.
Would change: a visible "Save as draft" or say clearly there are no drafts; label Dipbot as "Dipbot (event ideas assistant)"; show the credit cost on each action next to the button.

## T4: Office location and venue
Start: 21:54:44, end: 21:55:12, driver commands: 14
Outcome in my own words: I set the office to 600 Grant Street, Pittsburgh, PA through the "Dipbot venues" box, then added the title "Team lunch" and pressed "Find venues near your office". I got a list: Point State Park (0.8 mi), Strip District Bowl (1.1 mi), Smallman Galley, each with "Use". I did not click Use (task only said find). Done.
### Think-aloud log
- [21:54:44] (think-aloud) New event page. Venue stuff is far down, so I scrolled to the bottom. -> `goto`, `scroll down` -> saw "Where" section and a "Dipbot venues" box: "Set your office address to find venues nearby." with a field "Search your office address". Easy to spot, wording matches my task. Screenshot: scratch/r2/new-hr/shots/022-t4a.png
- [21:54:50] -> `type "Search your office address" "600 Grant Street"` -> dropdown "600 Grant Street, Pittsburgh, PA" with "Google Maps". Good.
- [21:54:56] -> click the suggestion -> box now says "Near 600 Grant Street, Pittsburgh, PA, within [5 mi]" and "Change office". Button "Find venues near your office, 1 credit" is greyed with text "Add a title so Dipbot knows what to look for." Slight confusion: the box above says nothing about needing a title and I had to read the small grey hint. Screenshot: scratch/r2/new-hr/shots/024-t4c.png
- [21:55:02] (think-aloud) Title is at the top of the page. -> `type "Title" "Team lunch"`, scrolled back down -> button now active (the hint is gone).
- [21:55:09] -> `click "Find venues near your office"` -> list of venues with distance and tags like "Fits the theme" and "Close to the office". Good. But a park and a bowling alley for a "team lunch"; I would have liked to say lunch/food. Screenshot: scratch/r2/new-hr/shots/026-t4e.png
### Questionnaire
Ease: 6/7. Confidence: 6/7. Confusing: the find button is greyed until a title is typed, and the reason is only a small hint, in a part of the page far from the Title field; results are not about food even though my title said lunch; the office setting is on the event form, so I was not sure it is saved for the whole company or just this event.
Would change: tell me the office is saved for everyone; make the hint more prominent (or let me search without a title); respect "lunch" in venue ranking.

## T6: Add a coworker, resend an invite
Start: 21:55:27, end: 21:56:26, driver commands: ~24
Outcome in my own words: I added Jordan Lee (jordan.lee@acme.com, Member) from Roster > Add person. He shows as "Invited". Then in the "Invited" tab I took Nico Farrow (oldest invite, Nov 6), clicked "Get invite message" and "Copy message". The site does not send email; I must paste the text to him myself (Slack/email). I have not sent it, only copied it. I think I completed both parts, but "resend" really means "copy and send it yourself", which I only understood from the text in the dialog.
### Think-aloud log
- [21:55:27] (think-aloud) Overview. People stuff, so "Members" in the menu. -> `click "Members"` -> nothing happened (matched the "Members 30" stat card, not the menu link). Mildly confusing, a card that looks like a link but is not.
- [21:55:36] -> `list`, click Members link -> Members page: filters, table, "Export CSV". No "add" button anywhere. Description says "Admins can open a person to edit their details." I was unsure whether adding happens here. Screenshot: scratch/r2/new-hr/shots/028-t6b.png
- [21:55:46] (think-aloud) The overview said "Get their invite message from the roster", so try Roster. -> `click "Roster"` -> big "Add person" button top right, also "Import people". Also a big blue box "5 people have signed in but aren't on the roster... Add existing members to the roster". That box worried me (did I have to do something?). I ignored it. Screenshot: scratch/r2/new-hr/shots/030-t6d.png
- [21:55:52] -> `click "Add person"` -> dialog "Add a person": "They're added as Invited and get this role when they sign in with this email. DIP doesn't email them; you send the invite message yourself." Fields Name, Work email ("Must end in @acme.com."), Role (Member). Clear. Screenshot: scratch/r2/new-hr/shots/031-t6e.png
- [21:56:03] -> typed name/email, dialog "Add person" -> toast "Added Jordan Lee to the roster as Invited. Use Get invite message on their row to send the invite." Invited count 3 -> 4. Very helpful next-step hint. Screenshot: scratch/r2/new-hr/shots/032-t6f.png
- [21:56:09] (think-aloud) Now "resend to someone invited but not joined". -> `click "Invited (4)"` -> Jordan, Nico, Priya, Tomas, each with "Get invite message" and red "Revoke". I looked for the word "Resend" and did not find it; "Get invite message" is the closest. I was careful to avoid "Revoke". Screenshot: scratch/r2/new-hr/shots/033-t6g.png
- [21:56:18] -> `click` "Get the invite message for Nico Farrow" -> dialog "Invite message for Nico Farrow": "DIP doesn't send email, so share this message with nico.farrow@acme.com yourself. Message shared 1x so far." with ready text and "Copy message". Clear. Screenshot: scratch/r2/new-hr/shots/034-t6h.png
- [21:56:24] -> `click "Copy message"` -> toast "Invite message copied. Send it to Nico Farrow yourself." and row now says "Message shared 1x, last Nov 18, 2026". Good tracking. I wondered why it said "1x so far" before I copied it (it still said 1x afterward). Screenshot: scratch/r2/new-hr/shots/035-t6i.png
### Questionnaire
Ease: 5/7. Confidence: 6/7. Confusing: "Members" menu has no add button and "Roster" is a second people list, so I had to guess which one; no "Resend" word, "Get invite message" is what to press; DIP doesn't send emails at all, which I did not expect from an invite (I only learned this from small print in the dialog); the "5 people have signed in but aren't on the roster" box looks urgent and unrelated; "Message shared 1x" count did not seem to change after copying; "Copy message" does not confirm anything was actually delivered.
Would change: put "Add person" (or a link to the roster) on the Members page; rename or subtitle the button "Resend invite (copy message)"; explain once, near the top of Roster, that invites are sent by you; make the stat card clearly non-clickable or make it a link.

## Overall
Most annoying: the event form is very long with the calendar and the required cover image hidden far down, and there is no draft state or visible "publish" step, so I was never fully sure what members could see. Also the stale red error on the street address after I had filled it.
Liked: the "Fix these to create the event" summary with links that jump to the field, the blue "Nothing is saved yet" banner on Dipbot ideas, and the clear toasts that told me the next step after adding a person.
