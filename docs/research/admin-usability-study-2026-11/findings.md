# Admin portal usability study, November 2026: findings (round 1)

Six simulated participants (Sonnet agents, one per persona, see [script.md](script.md)) used the mock-mode portal at
`624acb8e` through the study driver. Sessions: [sessions/](sessions/). Read the honesty note in the script first:
these are model participants, so treat every finding as a hypothesis, weigh frequency over intensity, and confirm
the big ones with real admins.

## How to read the numbers

- Outcome is coded by the moderator against the script's criteria, not taken from the participant's own verdict.
  Where the two disagree it is called out (T3).
- "Steps" are the participant's own count of driver commands for the task (the driver log could not be split
  reliably because participants used `goto` to escape blocked pages, see artifacts below). Wall-clock times are not
  reported: six agents ran in parallel against one dev server, so minutes measure model latency and queueing, not
  the UI.
- Ease is the post-task SEQ (1 to 7, 7 = very easy).

## Per-task results

| Task | Participants | Success | Partial | Fail | Median steps | Mean ease | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 Engagement this week | P1 P2 P3 P5 P6 | 5 | 0 | 0 | 4 | 5.4 | All answered with 30-day figures plus the theme card; all noted the page has no "this week". |
| T2 Create and publish an event | P1 P2 P3 P4 P5 | 4 | 0 | 1 | 30 (28 to 50) | 3.0 | P2 gave up after three rounds of "surprise" errors. Every participant was unsure the event was "published". |
| T3 Dipbot idea to a draft | P1 P3 P5 P6 | 4 | 0 | 0 | 7 | 4.8 | Success by the criteria (prefilled editor), but all four said they **had not** made a draft and were afraid to press Create event. Confidence 3 to 4. |
| T4 Office and venue | P1 P2 P4 P6 | 0 | 0 | 4 | 22 | 1.3 | Nobody saved the office. Partly a mock-data gap (below), partly the UI. Three of four pressed Enter and submitted the whole event form. |
| T5 Review a submission | P2 P3 P4 P5 | 4 | 0 | 0 | 13 | 5.0 | All requested changes with a note. Count mismatch (Overview 4 vs "13 pending") hurt trust (mock artifact). |
| T6 Add a coworker, resend an invite | P1 P2 P5 P6 | 0 | 4 | 0 | 14 | 2.3 | Nobody could add one person (only a file import). All resent an invite but were surprised it sends nothing. |
| T7 Who changed an event | P3 P4 P6 | 3 | 0 | 0 | 7 | 5.3 | Found quickly; unsure whether "added an attendee" counts as a change (the seed has no event edits). |
| T8 Weekly email day and test | P1 P2 P4 P6 | 4 | 0 | 0 | 9 | 5.3 | All four flagged the contradictory "only for you" vs "every admin" copy; three missed the test confirmation. |
| T9 Switch language | P1 P3 P4 P5 | 4 | 0 | 0 | 9 | 5.3 | Found by guessing "my name"; Language is the last section of Your settings. |
| T10 Recover from a Dipbot error | P2 P3 P5 P6 | 0 | 4 | 0 | 6 | 4.5 | Message understood and trusted ("nothing was counted"); "Try again" looked like it did nothing; all fell back to the ready ideas. |

Overall: 32 of 41 task attempts succeeded by the criteria; failures concentrate in three flows (office and venue,
adding a person, event creation for the impatient persona). Personas: P1 new-hr, P2 office-mgr, P3 es-speaker,
P4 keyboard-sr, P5 phone-first, P6 power-user.

## Issues, ranked

Severity scale from the script (4 critical to 1 low). "Who" lists personas who hit it; quotes are from the session
logs, which name the screenshot for each step (screenshots stay in the scratch directory; see the note at the end).

| # | Sev | Issue | Who | Evidence |
| --- | --- | --- | --- | --- |
| I1 | 3 | **Required fields are not marked and the error banner only counts.** "Fix 2 fields to continue." sits at the top; focus jumps to the first field (cover) and the other errors are a screen away, so people experienced "errors in rounds" (cover, then street, then city). The validator returns all errors at once; the UI hides that. | P1 P2 P3 P4 P5 | P2: "three separate silent requirements ... with the error text far from the button" (gave up). P4: "`read` only revealed 'Pick a cover image.' I did not know what the second error was until I resubmitted." |
| I2 | 3 | **"Draft" promises a save state that does not exist; Create event publishes at once.** The Dipbot banner says "Filled from a Dipbot draft ... then save" and the only button is "Create event". | P1 P3 P5 P6 (T3), all of T2 | P6: "a draft should not go live" (stopped). P1: "I do not dare click Create event because members will see it right away." The task wording ("draft event") primed this; the banner's "draft ... save" confirmed it. |
| I3 | 3 | **Office address cannot be entered by hand, yet the field says "enter the address yourself"; Enter submits the whole event form.** The office needs a picked place; the shared combobox message is written for the free-text Where field. | P1 P2 P4 P6 | P4: "Pressed Enter hoping to save -> it submitted the whole event form: alert 'Fix 6 fields to continue.'" P1: "Scary: if the form had been full, it would have published." |
| I4 | 3 | **No way to add one person.** Members is read-only; Roster's only add path is "Import people" (CSV or XLSX). | P1 P2 P5 P6 | P2: "I do not want a spreadsheet for one person." P5: "not doing a spreadsheet on my phone for one person." |
| I5 | 3 | **A single click on a day does not set the date.** While the calendar waits for an end date the form still holds the old date; the hint asks for a second click "for a one-day event". Someone who clicks once and moves on saves the wrong day. | P1 P2 P4 (P3 P5 hesitated) | P4: "Had to go back and press Enter on Nov 27 again to finish the one-day range." P1: "Confusing: I just want one day." |
| I6 | 2 | **"Resend invite" sends nothing.** The dialog explains it, but the button and the toast ("Resend recorded") read as sent. | P1 P2 P5 P6 | P2: "'Resend invite' does not resend anything; 'Resend recorded' toast sounds like it worked." |
| I7 | 2 | **Weekly email scope copy contradicts itself and the test result is off-screen.** "This setting is only for you" next to "This schedule applies to every admin in your company"; "Test queued" renders below the fold. | P1 P2 P4 P6 | P6: "my Tuesday change moves it for everyone. I would want a warning." P2: "after 'Send me a test' nothing visible near the button." |
| I8 | 2 | **Phone: the cover grid traps the page scroll** (nested 320 px scroller with `overscroll-behavior: contain`). | P5 | "I scroll and the photo grid moves instead of the page. Very annoying one-handed." |
| I9 | 2 | **Keyboard focus is dropped after actions** (settings save and test, filter changes) and, in Review, lands on the next person's "Request changes" button with no announcement. | P4 | "Focus is on a 'Request changes' button which now belongs to the NEXT submission ... risk of acting on the wrong person." |
| I10 | 2 | **Overview has no "this week" view; "active" means two things** ("29 active accounts" vs "Active, last 30 days 18"). | P1 P2 P3 P5 P6 | P1: "Everything is 30 days but my question was 'this week'." |
| I11 | 2 | **"Try again" after a Dipbot failure shows no sign it ran.** | P2 P3 P5 P6 | P6: "no spinner I could see ... unsure whether anything happened." (The `?ai=error` scenario fails every retry by design, so only the missing feedback is a finding.) |
| I12 | 1 | **Language is the last section of Your settings**, reached by guessing that settings live under your name. | P1 P3 P4 P5 | P3: "I would not find it if I did not read English." Everyone succeeded. |
| I13 | 1 | **Spanish: the "Presupuesto" step tab is truncated** to "Presupuest" in the Dipbot wizard. | P3 | es-speaker T3 log. |
| I14 | 1 | **Audit details show internal keys** ("Action key: attendee.add · Reference: ...") and targets are not linked. | P6 P4 | P6: "raw developer text; the header promises 'and why' but there is no reason." |
| I15 | 1 | **Screen-reader noise**: the cover library exposes 174 radios in element lists; Review's detail pane comes after every list item. | P4 | "14 Tab presses" to reach Approve. |

### Not product issues (study, mock or driver artifacts)

- **T4 mock data:** the offline places provider only knew eight canned Pittsburgh places, so "600 Grant Street" never
  appeared. Live Google Places would have offered it. This inflated T4's failure; I3 (copy and Enter) stands on its
  own.
- **T6 email domain:** the scenario used `jordan.lee@example.com`; the mock company's domain is `acme.com`, so any
  add would have been refused for that address. The missing single add (I4) stands on its own.
- **Pending counts:** the mock Overview reported 3 + 1 to review before the review page seeded 13 per theme. Mock only.
- **"Pseudo (layout test)"** in the language list is offered only outside live mode.
- **Dipbot idea text in English on the Spanish UI** is mock server content. Interest names are catalog content (not
  translated by design).
- **Default start time "9:00 PM"**: the editor defaults to the next full hour; the study ran in the evening.
- **Driver:** `type` by label text clicked the label and appended to the field (capacity "2030"); stale element
  numbers caused two misclicks; native "Leave site?" prompts were auto-dismissed, so `goto` from a dirty form failed
  (participants then found the in-app "Discard your changes?" dialog). Fixed in the driver for round 2.
- **Slow first loads** (several seconds on Edit and Review): dev-server compilation, not the static build.
- **Agent interruptions:** the keyboard-sr participant was stopped twice by an API safety filter (false positive);
  its second attempt wrote a complete log for all six tasks before the stop. The power-user participant was stopped
  once at its first step and re-run from scratch.

## Themes and root causes

1. **Forms hide their own rules** (I1, I5): the event editor knows every requirement but shows them only after submit,
   and the calendar's two-step range model leaks into the common one-day case. Root cause: designed around validation
   correctness and range editing, not the first-time path "one evening event".
2. **Words promise behavior the product does not have** (I2, I6, I3's "enter it yourself", I7): "draft", "resend",
   "enter the address yourself", "only for you". Root cause: copy written per component and reused (the address
   message is shared by two fields with different rules) or describing the backend action ("recorded") instead of the
   outcome for the admin.
3. **Missing or buried entry points for common jobs** (I4, I12, the office inside the event form): navigation follows
   backend objects (roster, import, members) rather than jobs ("add a person", "set the office").
4. **Feedback lands where the user is not looking** (I1 banner, I7 test line, I9 focus, I11 retry).
5. **Small-screen and assistive-tech specifics** (I8, I9, I15).

## Out of scope for this round's fixes

I10 (a weekly range needs new insight aggregates), a real draft state (contract change: events have no unpublished
status), DIP sending invite email (product decision), I14 (needs server summary keys; low severity), I11 (the
error-alert work in #333 landed during the study; re-checked in round 2 instead of reworked here). Decisions and
reasons: [decisions.md](decisions.md); round 2 results: [retest.md](retest.md).

Screenshots: participants' full screenshot sets stay in the session scratch directory (not committed); a few before
and after captures of the fixes are in [img/](img/).
