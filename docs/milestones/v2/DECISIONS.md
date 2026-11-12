# V2 product decisions (locked)

Owner decisions of November 11, 2026. They are closed: implement them, do not reopen them in reviews or PRs without a new owner decision recorded here.

| # | Decision | Detail and consequence |
| --- | --- | --- |
| 1 | **Tinted info cards stay.** | The soft-tinted information cards (event info rows, empty states, notices) are the design, not a leftover. Do not flatten them to plain surfaces in polish passes. |
| 2 | **No server-side rate limiting for shake to report.** | Bug reports are limited only by the client outbox (5 queued per uid, 7 days) and the create-only rules. Do not add a callable or a per-uid limits document for it. The earlier "decision pending" notes are resolved. |
| 3 | **No roster-only mode.** | A member's company is decided by their verified email's root domain (ADR 0007): a company-domain Google account is approved automatically. The roster (employee import) is a **pre-import convenience** that lists everyone it contains; people who join without being on it are **added to the roster automatically**. A roster entry never gates sign-in and there is no "only people on the roster may join" setting. |
| 4 | **Invitation "Cancelled" section.** | When a recipient has left an event they had accepted (RSVP left), that invitation moves to a **Cancelled** section of the Invitations sheet with a **Rejoin** action. After the event has passed, those entries are hidden. |
| 5 | **White text on purple.** | Text and icons placed on the brand purple (`#7B88FA`) are white, not ink. Applies to buttons, headers and chips on purple surfaces; do not "fix" it for contrast in individual screens. Other fills keep their own token pairings. |
| 6 | **US spelling.** | All user-facing copy, docs and code comments use US English (for example "organizer", "color", "canceled" in prose where not quoting a stored status value). The stored status value `cancelled` is a wire value and does not change; the UI section title is "Cancelled" per decision 4 because it is a display label chosen by the owner. |

Related open work stays tracked in [FRONTEND_PLAN](FRONTEND_PLAN.md) and [TRIAGE_V2_REMAINING](TRIAGE_V2_REMAINING.md).
