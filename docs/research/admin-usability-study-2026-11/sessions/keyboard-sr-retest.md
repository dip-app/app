# Session: keyboard-sr (re-test) (simulated participant)
Persona: Sam, 52, low-vision admin, screen reader + keyboard only (tree/list/focus/press/type/read; no shot, no click).
Setup: Desktop 1440x900, English. Signed in with "Sign in as admin" via Tab + Enter.

## T2: Create and publish an event
Start: 21:52:03, end: 21:55:02, driver commands: ~45 (over the 25 cap; many were single-line key presses, plus several calls batching 2-3 commands)
Outcome in my own words: Event "Board-game night" created for Fri Nov 27, 5:00 PM to 8:00 PM, 30 spots, "Our office", Pittsburgh. It appears under Upcoming (3) with "0 / 30". There was no separate publish step; the page says members see it as soon as it's created, so I believe it is published. A status line read "Created “Board-game night”."
### Think-aloud log
- [21:52:03] (think-aloud) No screenshots for me; reading the tree for the sign-in page. -> `tree` -> heading "Organize your team’s activities", buttons "Sign in as admin", "Preview as organizer". Clear.
- [21:52:05] I Tab once; focus lands on "Sign in as admin"; Enter. -> `press Tab`, `press Enter` -> Overview page.
- [21:52:10] Going to Events; tree is clear: nav groups, "New event" link, table with a caption and named columns, Edit links named "Edit Kayaking" (good).
- [21:52:15] I want "New event". Tabbing from page start goes through 17 nav links one by one (the "Skip to content" link exists, I did not try it). -> `press Tab` x ~24 -> reached "New event"; overshot once to the tab "Upcoming (2)", Shift+Tab back. Enter -> New event page. Minor: a lot of Tabs.
- [21:52:33] New event tree is huge: 174 cover radios each read out by name. I would not want to listen to that. Fields are labeled: "Title", "Description", tag buttons say "Social, 29 members interested" (nice).
- [21:52:42] Typed title and description with `type`. Fine.
- [21:52:55] Tried to arrow through covers: after Tab from the search box, focus went to "Filter by theme" select, and ArrowDown there is risky (changes the filter). Luckily the value stayed "All themes (8)".
- [21:53:05] Next Tab entered the cover radios; ArrowDown moves by grid row (jumped to "Arcade night", "Dealing cards"), not one item, and ArrowUp wrapped to "Rolling dice". Confusing. Used ArrowLeft x3 to reach "Games night" [checked]. Selecting a cover also happens just on arrow focus.
- [21:53:31] Tab: "Search more photos", "Previous month", "Today", "Next month", then calendar day "Wednesday, November 18, 2026, today, start and end date". Day buttons have full names; good. ArrowDown +7, ArrowRight x2 -> "Friday, November 27, 2026"; Enter -> "..., start and end date". Great.
- [21:53:52] Next: sliders "Start time"/"End time" (focusable, I do not know what they do) and text boxes "Start time" value="10:00 PM". Default start is 10 PM, odd.
- [21:54:09] Typed "5:00 PM" in start box. The "Starts" summary says 5:00 PM. For End I typed "8:00 PM" but read still showed "Ends 11:00 PM"; after Tab it updated to 8:00 PM. So a silent delay, committed on blur.
- [21:54:23] Where section: "Street address" combobox, "Venue name", "City / area". The page's office is "Near 500 Grant Street, Pittsburgh, PA". Typed address "500 Grant Street" -> option "500 Grant Street Pittsburgh, PA"; ArrowDown, Enter. Focus then dropped to the page body (nothing focused) — I had to find my place again. The fields filled in and a "Change the address" button appeared.
- [21:54:55] Capacity typed 30. Tabbed to "Create event", Enter -> back on Events list with "Created “Board-game night”." and the row showing "0 / 30", "Upcoming". Focus on main. 
### Questionnaire
Ease: 4/7. Confidence: 6/7. Confusing: ArrowDown in the cover grid jumps rows; Tab from cover search goes to a select where arrows change the filter; time summary does not update until I leave the field; default start time 10:00 PM; focus lost after choosing the address suggestion; no explicit "Publish" so I was unsure it was visible to others until I read "Members see it in the app as soon as you create it"; 174 covers read out in the tree. Would change: group cover choices with fewer items, or a skip past them; update time summary live; return focus to the next field after picking an address; say "Published" in the confirmation.

## Overall
(in progress)
