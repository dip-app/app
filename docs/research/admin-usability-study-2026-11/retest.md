# Admin portal usability study, November 2026: round 2 (re-test of the fixes)

Fresh participant agents (new context, same personas and briefs, same driver with the round-1 driver bugs fixed) ran
the tasks touched by the fixes against the fix branch (`fix/admin-usability-round1`). Sessions:
[sessions/*-retest.md](sessions/). One scenario detail changed on purpose: T6 gives Jordan's work address
(`jordan.lee@acme.com`), because round 1's `example.com` address was a study artifact (the mock company's domain is
`acme.com`).

## Coverage, and what is missing

| Persona | Planned | Completed |
| --- | --- | --- |
| P1 new-hr | T2 T3 T4 T6 | all four |
| P3 es-speaker | T2 T3 T9 T10 | all four |
| P6 power-user | T3 T4 T6 T10 | all four |
| P4 keyboard-sr | T2 T4 T5 T8 | T2 only |
| P2 office-mgr | T2 T4 T6 T8 | none |
| P5 phone-first | T2 T3 T6 T9 | none |

The office-mgr, phone-first and the rest of the keyboard-sr runs were stopped by an API safety filter (a false
positive on these role-play briefs; it also hit two round-1 agents). Each was retried once and stopped again at the
first step, so they were not retried further. **Not re-tested with participants:** the Review focus move (C9, T5),
the weekly email copy and toast (C7, T8), the phone cover library (C8) and the office-manager path. Those fixes rest
on the design audit (PASS) and unit tests only.

## Before and after, same personas

Ease is SEQ 1 to 7. Outcomes coded against the script's criteria.

| Task | Personas | Round 1 outcome | Round 2 outcome | Mean ease r1 -> r2 | Notes |
| --- | --- | --- | --- | --- | --- |
| T2 Create an event | P1 P3 P4 | 3 S | 3 S | 3.3 -> 4.3 | No one reported "errors in rounds" this time; the summary listed everything at once. Two still learned the cover and address were required only after pressing Create (the note "Everything is required unless it says optional" was not noticed). Two saw a stale red "Add the street address." under a filled field: **fixed after this round** (editing a field now clears its error), not re-tested. Nobody saved the wrong date. |
| T3 Dipbot idea to draft | P1 P3 P6 | 3 S, all unsure | 3 S | 4.7 -> 5.7 (confidence 3.3 -> 4.3) | The banner now says nothing is saved yet. P6 called it clear. P1 and P3 still wanted a "Save as draft", which the product does not have (and the task wording asked for a draft). |
| T4 Office and venue | P1 P6 | 2 F | 2 S | 1.5 -> 5.5 | Both saved the office and got venue results. Most of the gain is the mock now offering typed street addresses, as Google does; the UI part (no Enter submit, pick-only message) had no complaints. New friction: "Find venues" stays disabled until a title is typed and the hint was far from the Title field (hint now says "at the top of the form"; not re-tested). |
| T6 Add a person, resend | P1 P6 | 2 P (nobody could add) | 2 S | 2.5 -> 5.0 | Both found "Add person" on Roster and added Jordan. Both expected the add on Members first. "Get invite message" was understood, but P1 still found "DIP doesn't send email" surprising. |
| T9 Language | P3 | S | S | 4 -> 6 | Language is first in Your settings now; P3 still wants a switch outside settings (and on the login page). |
| T10 Dipbot error | P3 P6 | 2 P | 2 P | 4.5 -> 4.5 | Unchanged by design (no fix this round): "Try again" still shows no sign it ran, and nothing points to the ready ideas above. |

Small samples (two or three model participants per task): read the direction, not the size.

## Did the fix address the need?

| Fix | Verdict | Evidence |
| --- | --- | --- |
| C1 error summary | Mostly. The "rounds" confusion is gone; "required only after submit" remains for some. | new-hr-retest T2, es-speaker-retest T2 |
| C1 follow-up: clear errors on edit | Built after round 2 (two participants hit stale errors). | Not re-tested |
| C2 draft wording | Partly. Clearer, but the need for a real draft state is real and out of scope (contract). | new-hr-retest T3, power-user-retest T3 |
| C3 office and Enter | Yes for the observed failure. | new-hr-retest T4, power-user-retest T4 |
| C4 add one person | Yes. | new-hr-retest T6, power-user-retest T6 |
| C5 one-click date | Yes; nobody needed a second click. | keyboard-sr-retest T2, new-hr-retest T2 |
| C6 invite wording | Yes for the button; "DIP doesn't send email" is still a surprise (product decision). | power-user-retest T6 |
| C10 language first | Yes for finding it once in settings; no global switch. | es-speaker-retest T9 |

## Screens (mock mode, before and after)

| What | Before | After |
| --- | --- | --- |
| New event, Create pressed on an empty form (1440) | [before](img/before-errors-1440.jpg): "Fix 6 fields to continue." only | [after](img/after-errors-1440.jpg): every field listed and linked, optional fields marked |
| Same at 390 | [before](img/before-errors-390.jpg) | [after](img/after-errors-390.jpg) |
| Office typed "600 Grant Street", Enter (1440) | [before](img/before-office-1440.jpg): no match, Enter submitted the event form | [after](img/after-office-1440.jpg): suggestion offered, form not submitted |
| Cover library on a phone (390) | [before](img/before-covers-390.jpg): inner scroller that swallowed the page scroll | [after](img/after-covers-390.jpg): six tiles in the page flow, "Show 12 more covers" |
| Add a person (1440) | (no way to add one person) | [after](img/after-addPerson-1440.jpg): dialog with the domain rule and field errors |

Design audit: two rounds by a fresh auditor agent; round 1 FAIL on four items (repeated labels in the summary,
"below" vs "above", three leftover "resend" strings, Overview review counts), round 2 PASS.

## Still open (not resolved in this round)

1. **No draft or unpublished state** for events (contract change). The copy now tells the truth; the need remains.
2. **"Try again" after a Dipbot failure gives no feedback** and does not point to the ready ideas (I11). Belongs with
   the error-alert work that landed in #333.
3. **Members has no "Add person"** (both re-test participants looked there first). A link from Members to Roster's add
   is the next small step.
4. **Office setting lives at the bottom of the event form**; no company settings page exists (rejected as a new surface).
5. **Required fields before submit**: the one-line note is not noticed by everyone; consider marking the cover and the
   address sections more strongly if real users confirm it.
6. **Spanish**: tags and cover names are catalog content in English; mock Dipbot text is English.
7. Not re-tested: C7, C8, C9 and the office-manager and phone personas (see coverage).
