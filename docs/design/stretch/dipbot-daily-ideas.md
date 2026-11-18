# Dipbot daily ideas (stretch, AI from scratch with data tools)

Status: designed and built November 18, 2026; not deployed. Extends [AI event creation](ai-event-creation.md) and reuses the [weekly suggestions](admin-suggestions-email.md) aggregates. Owner actions and switches: [AI events runbook](../../ops/ai-events.md#dipbot-daily-ideas).

## Goal

The Dipbot page opens with a short row of 4 to 6 event ideas made for this company from scratch, refreshed at most once a day. An admin starts an event from one in one click ("Use this idea") or tunes it in the wizard ("Customize with Dipbot"). Ideas are written by a cheap model that is given read-only data tools over the company's own aggregates, then validated, ranked by Jev and given a cover by the server.

## Flow

1. **Snapshot.** The callable authorizes the caller (`ai.generate`) and loads one snapshot for the caller's company: the weekly suggestions signals (past 180 days of events with attendee counts and capacity, upcoming 28 days, weekly challenge themes, member count, interest counts now and about a month ago) reduced with `summarize`, plus the tag catalog. `companyId` comes from the request and is checked against the verified membership; the tools never take a company argument.
2. **Agent loop** (`application/ideaAgent.ts`). The model gets short instructions, a one-line company context (season, data level) and six tools. Each turn it either calls tools or returns the final structured answer. Limits: 6 tool calls in total, 4 turns (the last turn forces the answer with `tool_choice: none`), 25 second deadline (aborts the provider call), each tool result capped at 3,000 characters by dropping rows. Tool arguments are parsed with zod (unknown keys such as an invented `companyId` are stripped; bad arguments return an error object to the model and still count).
3. **Validate and repair** (`domain/ideaValidate.ts`). Zod parse of the final answer; one bounded retry turn on a malformed answer ("Return only the JSON object"); then per idea: clean text and clamp lengths, drop links and contact data, map tags to catalog ids with the theme tag first, align weekday and daypart (weekend dayparts on Saturday or Sunday), clamp duration to 15 minute steps, drop repeats of an event held in the last 42 days or already scheduled (title keywords), at most 2 per theme and no duplicate titles. **Number grounding:** every number in the why line must appear in the outputs of the tools called in this run (a percentage counts when the fill ratio rounds to it); otherwise the line is replaced with a server-built reason. When fewer than 4 ideas survive, the list is topped up from the deterministic catalog ranking.
4. **Schedule.** The server, not the model, picks `startsAt`: the first matching weekday from 2 to 28 days ahead whose date has no scheduled event (else the least busy one), at the daypart's default local time (morning 9:30, lunch 12:00, afternoon 15:00, after work 17:30, weekend day 10:00, weekend evening 18:00) in the company time zone.
5. **Rank and label** (one decision call through the provider chain: Jev, then the OpenAI mini model, then the prior only). The weekly email's questions (interest, freshness, appeal, weekly theme) are asked per idea over the same aggregate state; the composite with the prior gives Perfect fit, Great choice or Good match (no percentages, no label when the company has no data). `reasonBasis` is `company_data` only when the why line survived grounding and the company data level is not `none`; otherwise the line is the generic catalog pitch.
6. **Cover.** Static cover library, lexical shortlist (`rankCovers`) per idea, first cover not used by another idea; no extra model call. The live Pixabay search and import stay admin-triggered in the editor ("Let Dipbot choose" and the photo search): an unattended daily run never imports outside photos, so ideas always use approved library covers.
7. **Store.** `companies/{c}/aiCache/ideas` (server-only, deny-all rules): ideas, fingerprint, `generatedAt`, `checkedAt`, provider and model, tool names, credits charged, `autoRunDay`, `manualRefreshes {day, count}`, the lease, and the last `requestId`.

## Tools (read-only, aggregates only)

| Tool | Arguments | Returns |
| --- | --- | --- |
| `getPastEvents` | `sinceDays` 7 to 180 (default 90), `theme?`, `limit` 1 to 20 (default 12) | Company-owned event titles with theme, tags, weekday, time bucket, attendee count, capacity, fill percent, cost bucket. Never descriptions, venues, creators or attendee names |
| `getTagUsage` | none | Interests at or above the privacy floor of 5 members as buckets (5 to 9, 10 to 19, 20+), with month-over-month growth when a month-old count exists (only when both counts are at the floor) |
| `getUpcomingCalendar` | `days` 7 to 28 (default 28) | Scheduled event counts per day and per week, busiest and quietest week, the weekly challenge themes |
| `getAttendanceTrends` | none | Mean fill percent and event count by weekday, by time bucket and by theme (cells with fewer than 2 events are omitted) |
| `getIdeaCatalog` | `theme?` | Up to 12 curated ideas (id, title, pitch, theme, tags, typical cost bucket, group range) that fit the season, as inspiration |
| `getAvailableCoverLabels` | `theme?` | Up to 20 cover library labels, so titles match an available picture |

No tool returns emails, names of people, per-member data or exact interest counts. Event titles are company-owned content, shown already in the portal.

## Refresh policy and credits

- **Load** (`mode: load`, every page visit): returns the stored ideas immediately (`fresh` or `stale`) and never calls a model. With nothing stored it returns the free catalog fallback. It sets `autoRefreshDue` when (a) nothing was ever generated for the company, or (b) the stored ideas are older than `AI_IDEAS_MAX_AGE_HOURS` (default 24) and today's local day has not had an auto run, and credits (3) and the dollar budget allow it.
- **Auto** (`mode: auto`, started once by the portal in the background when `autoRefreshDue`): the server re-checks everything inside a 90 second lease on the cache document (one run per company at a time). If the fingerprint of the inputs is unchanged it only moves `checkedAt` (outcome `extended`, free, no model call). Otherwise it runs the model once and records `autoRunDay` (one auto run per company per local day, whatever the outcome).
- **Refresh** (`mode: refresh`, the button): needs a `requestId` (a replay returns the stored answer, outcome `unchanged`, never charged twice), at most `AI_IDEAS_MANUAL_PER_DAY` (default 3) per company per local day (error `AI_IDEAS_REFRESH_LIMIT`), and 3 credits (error `AI_CREDITS_EXHAUSTED` before any model call).
- **Credits:** a run costs 3 credits (`CREDIT_COSTS.ideas`). They are reserved in the lease transaction and refunded exactly once when no model idea survives validation (outage, deadline, malformed twice): failures are free. Exhausted credits never auto-run: the stored ideas or the free fallback show.
- **Dollar guard:** the run is skipped (fallback, no charge) unless the company's month and day budget and the platform ceiling can cover the worst case: 5 model turns at 10,000 input and 3,000 output tokens plus one decision call. Actual spend is added to `aiUsage` and `aiUsagePlatform` after the run, never as a generation.
- **No scheduler.** A daily job would spend credits for companies whose admins never look. The lazy rule above costs at most one run per company per day, only on a visit and only when the inputs changed.
- **Fingerprint** (material change): the interest buckets above the floor, recent-event count bucket and the leading theme, weekday and time bucket by fill, the upcoming 4-week counts as buckets, the active weekly theme titles, the month, the catalog and consideration versions and an algorithm version.

## Switches

`AI_IDEAS_ENABLED` (default on whenever `AI_EVENTS_ENABLED` is on; `false` hides the section) and `companies/{c}/aiSettings/current.ideasEnabled` (default true). Both off paths return `enabled: false` without errors. `AI_IDEAS_MAX_AGE_HOURS` (default 24), `AI_IDEAS_MANUAL_PER_DAY` (default 3). The ideas model is `AI_MODEL_IDEAS` (default `gpt-4o-mini`, which supports function calling and strict structured outputs in the Responses API; replace before its January 14, 2027 shutdown like the other steps).

## Privacy, safety and logs

Model input is aggregates and company-owned event titles only. Tools are tenant-scoped by construction (they read the snapshot only). Output is validated against the contract and the catalogs; links, emails and phone numbers are dropped. Logs (`ai.ideas`) and the audit entry (`ai.ideasGenerated`) carry counts, tool names, provider, model, tokens, credits and outcome, never prompts, tool results or idea text. Admin audit entries show credits, never money.

## Portal

A compact "Ideas for you" section at the top of `/admin/ideas/`, above the wizard: header (Dipbot mark, title, "Updated yesterday", collapse chevron remembered per browser, and at the end of the row an outline "Refresh ideas" button with the credit hint), then a horizontal row of 4 to 6 image-led cards (cover flush left, one-line title, one-line why, small chips for day and time, duration and cost, the fit label, "Use this idea" and a quieter "Customize with Dipbot"). About 220px tall with the header; collapsed it is one row. Loading uses compact skeleton cards; no data shows "Not enough activity yet, here are starter ideas"; out of credits keeps the stored ideas and disables the button with a hint. Loading the page makes one `load` call and at most one `auto` call; nothing refetches on wizard step changes.

## Tests

Fakes only (no OpenAI, Jev or Pixabay calls): tool tenant scoping (an invented `companyId` is ignored), result size caps, no personal data in any tool output, number grounding, the tool-call and turn limits and the deadline, malformed output with one retry then fallback, cache freshness and fingerprint extension, the lease, the daily auto rule, manual refresh limit and idempotency, credit reserve and refund, exhausted credits, kill switches, and the portal (cards, refresh, collapse state, no refetch on step changes).
