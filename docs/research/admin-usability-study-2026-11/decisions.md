# Admin portal usability study, November 2026: design decisions

Candidate fixes for the High and Medium issues in [findings.md](findings.md) plus quick wins, critiqued by a fresh
design-auditor agent before anything was built (it read the findings, the session logs and the code). Its job was to
check that each idea answers the observed confusion, propose alternatives and decide. Constraints given: no contract
or backend changes, V1 scope, English copy changes only where the study justifies them, kit components and en/es
catalogs.

| # | Issue | Candidate | Decision | Why, and what was built |
| --- | --- | --- | --- | --- |
| C1 | I1 errors in rounds | Error summary listing every error as a link; focus the summary; mark optional fields | **Accepted, extended** | The validator already returns every error; only the count was shown. Built: alert "Fix these to create the event" ("to save your changes" when editing) with one link per field ("Cover image: Pick a cover image."), venue keys de-duplicated, server field errors in the same list; submit focuses the summary. "Tags (optional)", "Price (USD) (optional)" and a line under the title "Everything is required unless it says optional." |
| C2 | I2 "draft" | New Dipbot banner copy, a line by Create event; "Create and publish" considered | **Accepted; rename rejected** | "Publish" would introduce an unpublish idea that does not exist. Banner: "Dipbot filled this in. Nothing is saved yet. Pick a venue and time, check the details, then press Create event." Line by the button (create only): "Members see it in the app as soon as you create it. You can edit or cancel it later." The create-failed message no longer says "draft". |
| C3 | I3 office and Enter | Enter never submits from the combobox popup; never in pick-only (office) mode; office-specific empty message; mock suggests typed street addresses | **Changed** | Also block implicit Enter submission from any text field of the event form (Enter in a stray field nearly published an event). Office empty message: "No matches. Try the street number and name, then pick your office from the list." Mock: a typed "number + street" query is offered as a suggestion and resolvable by id, as Google Places would. A separate office setting outside the event form: **rejected** (no company settings surface exists; new surface, not V1). |
| C4 | I4 add one person | "Add person" dialog on Roster running the existing import dry run and apply for one row | **Changed** | Fair reuse of the import callables (no new endpoint). Primary "Add person", outline "Import people". Fields: Name, Work email (hint "Must end in @domain"), Role (Member default). A dry-run "update" or "unchanged" is not applied ("already on the roster"), so a single add can never silently change someone's role. On create: toast and the new row. The invite message is offered through the existing "Get invite message" action on the row, since only that callable produces it. |
| C5 | I5 one click | First click sets a one-day event at once; a later click extends | **Accepted with a rule** | Extending ends when focus leaves the calendar or the time dial is used, so returning later cannot build a range by accident. Help: "Click a day for a one-day event. Click a later day to make it longer. ..." Summary: "{date}, one day. Click a later day to make it longer." |
| C6 | I6 resend | Rename to say it gives a message | **Changed** | The click already opens the message dialog, so the button is "Get invite message"; the misleading "Resend recorded" toast is removed (the dialog is the outcome); copied toast: "Invite message copied. Send it to {name} yourself."; table: "Message shared {count}×". |
| C7 | I7 weekly email | Non-contradicting scope lines; test result as a toast | **Accepted, plus the page subtitle** | "Only you get this email; other admins turn it on for themselves." / "Times are in {zone}. The day and time are shared by every admin who gets this email." / saved: "Schedule saved for every admin who gets this email." Page subtitle "Preferences that belong to you, not to your company" also contradicted the page: now "Your email and language preferences." Test result is a toast. |
| C8 | I8 phone scroll trap | Let scroll chain, shorter grid | **Changed** | Chaining only helps at the end of 174 covers. On phones the cover library has no inner scroller: it shows a first set of tiles (always including the selected one) and "Show more covers". Desktop unchanged. |
| C9 | I9 focus | Keep focus after actions; Review moves focus to the next person | **Changed** | Root cause was native `disabled` on the pressed button. Weekly email buttons use the kit's `loading` (keeps focus) and `aria-disabled` for "nothing to save". Review: after Approve or Request changes, focus goes to the next person's heading with "Now showing {name}'s submission."; an empty queue focuses the empty state. Filter-change focus (Audit) not covered. |
| C10 | I12 language | Language section first in Your settings | **Accepted** | Built. The auditor noted it does not fix guessing that settings live under your name; left as is (the nav already labels the link "Your settings" for assistive tech and as a tooltip). |
| C11 | I13 "Presupuest" | Fix truncation | **Accepted** | Step tabs size to their label with a 100 px minimum. |
| C12 | mock counts | Overview "to review" counts from the seeded submissions | **Accepted (mock only)** | Removes a false finding in round 2. |
| C13 | I10 part | "29 active accounts" vs "Active, last 30 days" | **Accepted (cheap part only)** | The Members tile's subline no longer says "active". The weekly range itself stays rejected. |

Changes after review of the built fixes (audit round 1 FAIL, round 2 PASS): the summary drops the field name when the
message already starts with it ("Title must be 1 to 120 characters."); "Check the details above."; the last "resend"
strings became "Message shared {count}× so far.", "Get their invite message from the roster" and "get an invite
message"; the Overview mock seeds only this week's and the latest past theme (65 across five themes doubled the card).
After the round 2 re-test: editing a field clears its error and its summary line (two participants saw a stale
"Add the street address."), and the venues hint says "Add a title at the top of the form ...".

Rejected before review and confirmed by the auditor: a weekly range on Overview (needs new aggregates), a real draft
or unpublished state (contract change), sending invite email (product decision), audit detail formatting (I14, low,
needs server keys), Dipbot retry feedback (I11; #333 changed error alerts during the study, so it was re-tested
instead of reworked).
