# Dipbot Suggest theme (stretch, weekly themes from the company's own data)

Status: designed and built November 19, 2026; not deployed. No call to a real model (OpenAI or Jev) was made while building it: every test and screenshot uses fakes, the emulator demo agent or the portal mock. Reuses the [daily ideas](dipbot-daily-ideas.md) tool loop and aggregates. Owner actions and switches: [AI events runbook](../../ops/ai-events.md#dipbot-suggest-theme).

## Goal

On the New theme page an admin presses "Suggest theme | 2 credits" at the top right. Dipbot fills the form in place, without leaving the page: the theme picture, title, description (what members do and post), tags and a free week. It knows what the company's members are interested in (buckets only) and what the company already did (past and scheduled weekly themes, recent events), so it does not repeat itself. "Another idea" cycles 2 to 3 alternatives for free; Undo puts everything back.

## Callable

`suggestThemeV1` (`SuggestThemeRequest` -> `SuggestThemeResponse`), admin only (`ai.generate`). The company comes from the caller's server membership; the supplied `companyId` must equal it.

| Request | |
| --- | --- |
| `contractVersion`, `companyId`, `requestId` (UUID) | Required. A replay of the `requestId` returns the stored answer, free (`replay: true`); the same id with a different hint, fields or language is `REQUEST_REUSED`; a run still in progress is `REQUEST_IN_PROGRESS` |
| `hint` | Optional, at most 200 characters. Links, emails and phone numbers are refused (`AI_PROMPT_REJECTED`); free OpenAI moderation screens it (flagged: `AI_PROMPT_REJECTED`; moderation down: `AI_UNAVAILABLE`, fail closed). Nothing is charged for a refused hint. The hint is never stored, logged or audited |
| `fields` | Optional, which fields the admin wants filled (`title`, `description`, `tags`, `week`, `illustration`); prompt only |
| `locale` | `en` (default) or `es`: the language of the model-written text and of the server's own why lines. Catalog fallback titles and descriptions stay English (catalog content) |

| Response | |
| --- | --- |
| `suggestion`, `alternatives` (up to 3) | `ThemeSuggestion`: `title` (at most 60), `description` (at most 400), `tagIds` (1 to 4 catalog ids, the picture's tag first), `themeKey` (one of the nine pictures), `weekStart` (Monday "YYYY-MM-DD" of a free week, Eastern weeks like the portal), `why` (1 to 3 lines), `reasonBasis`, optional `fitLabel` (`perfect`, `great`, `good`), `source` (`agent` or `catalog`) |
| `outcome` | `suggested` (at least one model theme survived, charged) or `fallback` (catalog only, free) |
| `credits`, `creditsCharged`, `replay` | The balance after the run; 2 or 0 |

## Flow

1. **Read only.** Authorize, the switches (deployment `AI_THEME_SUGGEST_ENABLED`, the company AI rule through `effectiveLimits`, and `aiSettings/current.themeSuggestEnabled`; any off: `AI_THEME_SUGGEST_DISABLED`), a replay, and out of credits (`AI_CREDITS_EXHAUSTED`) before anything else runs.
2. **Hint.** Contact data refused, then moderation (see above).
3. **Snapshot.** The daily ideas signals (past 180 days of events with attendee counts, upcoming 28 days, member count, interest counts now and a month ago, the tag catalog) plus the company's weekly themes from 27 weeks back to 13 weeks ahead (`companies/{c}/challenges`, one single-field range on `startDate`, no composite index). Free weeks: the next 12 Mondays (from next week) that no theme overlaps.
4. **Claim** (one transaction): the replay again, the daily caps (per company `AI_THEME_SUGGEST_DAILY_LIMIT`, default 40; per admin `AI_DAILY_GENERATIONS_PER_ADMIN`, which is `Infinity` in production; both `AI_THEME_SUGGEST_LIMIT`), the dollar headroom, the 2-credit reservation (`themeSuggest_{uid}_{requestId}`), and the request document with a 90 s lease. A retried crashed request is neither counted nor charged again.
5. **Agent** (`application/themeAgent.ts`): the daily ideas loop with six read-only tools; `getPastThemes`, `getTagUsage`, `getAvailableWeeks`, `getPastEvents` and `getThemeCatalog` (no titles) are prefetched into the conversation, then at most 2 more calls, 4 turns (the last forces the answer), one bounded retry for a malformed answer, a 25 s deadline. The user turn carries a do-not-repeat list of past and scheduled theme titles and recent events. The hint goes in as a delimited data block, never as instructions.
6. **Validate and repair** (`domain/themeValidate.ts`): clean text and clamp lengths, drop links and contact data, catalog tags only (the picture's own tag first, at most 4), a week only from the free list (else the first free week), the moderation verdict per theme (fail closed: moderation down drops every model theme), no repeats (below), number grounding of every why line (below). Fewer than 3 left: topped up from the theme catalog (one per picture, ranked by the prior, never a repeat).
7. **Rank and label**: one decision call (Jev, then the OpenAI mini model, then the prior only) asks per theme how well it matches the interests, how different it is from recent themes and events, and how many coworkers would join; the composite with the prior gives the fit label (none without company data).
8. **Settle** (one transaction): spend added to `aiUsage` and `aiUsagePlatform` (never a generation), credits refunded when no model theme survived, the answer stored on the request document for replays, a content-free audit entry when a model ran. A failed settle refunds and frees the lease.

## Tools (read-only, aggregates only)

| Tool | Returns |
| --- | --- |
| `getTagUsage` | Interests with 5+ members as buckets (5 to 9, 10 to 19, 20+), monthly growth when both counts are at the floor (same tool as daily ideas) |
| `getPastThemes` | Past themes (up to 26 weeks): title, picture, tags, week, weeks ago, participation as a bucket only when 5 or more joined; and scheduled themes |
| `getPastEvents` | Recent company events: title, theme, weekday, time of day, attendees, capacity, fill percent, cost bucket (same tool as daily ideas) |
| `getAttendanceTrends` | Mean fill by weekday, time of day and theme (cells under 2 events omitted) |
| `getAvailableWeeks` | Free Mondays in the next 12 weeks and the taken weeks with the theme's title |
| `getThemeCatalog` | Up to 12 curated weekly themes for the season (`domain/themeCatalog.ts`, 27 themes, 3 per picture) |

No tool returns names of people, emails, per-member data or exact interest or participation counts. Tools read the snapshot only; an invented `companyId` argument is stripped.

## No duplicates

Embedding-free, in `themeValidate.ts`. Titles are normalized (lowercase, accents removed, punctuation dropped, English and Spanish stop words such as "week", "theme", "challenge", "semana" removed, a light plural strip) and compared by token overlap (Jaccard).

- A suggestion is dropped when it is 0.6 or more similar to any theme that started in the last 26 weeks or is scheduled, or 0.75 or more similar to an event that ended in the last 42 days.
- Suggestions are also never similar to each other (0.6), and the catalog top-up uses a different picture for each.
- The ranking prefers a picture not used in the last 8 weeks.

## Privacy

Aggregates only: interest and participation counts leave the tools as buckets at or above the floor of 5 members, never exact counts, names or emails. The ranking state is the daily ideas state (buckets, recent titles) plus recent theme titles. Theme and event titles are company-owned content already shown in the portal. Logs (`ai.themeSuggest`) and the audit entry (`ai.themeSuggested` / `ai.themeSuggestFailed`, summary keys of the same names) carry counts, tool names, provider, model, tokens, credits and outcome, never the hint, prompts, tool results or theme text. Stored per request (`companies/{c}/aiThemeSuggestions/{uid}_{requestId}`, 24 h TTL): the input hash, status, lease and the validated suggestions (derived data) for replays.

## Credits and cost

2 credits per run (`CREDIT_COSTS.themeSuggest`, `creditCost.themeSuggest` in the contract), reserved in the claim and refunded exactly once when no model theme survives (outage, deadline, malformed twice, everything a repeat or flagged). Catalog-only answers (no model configured, the dollar budget too low) are free. A replay is free. Worst case: 5 turns at 8,000 input and 1,500 output tokens on `gpt-4o-mini` is $0.0105 (`themeWorstCaseMicros`) plus the ranking providers (about $0.0025), so about $0.013 reserved; typical about 3 turns and 7,000 input tokens, about $0.0015 plus a Jev ranking call.

## Portal

- `/themes/new/`: a `DipbotAction` "Suggest theme | 2 credits" in the page header (collapses to "Suggest" on phones), for admins while Dipbot and theme suggestions are on (`themeSuggestEnabled` on `getEventIdeaContextV1`, free). Disabled with the reset date as the reason when the balance is under 2 credits. Not on the edit page: an existing theme's fields are all the admin's own.
- Pressing it fills the form in place. A card at the top of the form says what Dipbot suggested and why (fit label, why lines), what it filled, what it kept, and offers Another idea (cycles the alternatives, free), Undo, Close and "Refine with a hint (optional)" with "Suggest again | 2 credits". Filled fields carry a calm "Dipbot suggested this" tag until the admin edits them.
- **Overwrite rule (design review decision):** Dipbot fills only the fields the admin has not changed by hand. A field the admin changed is kept and listed ("Kept what you entered: title."), with "Replace mine too" as the explicit confirmation. Undo restores the form as it was before the first fill. A suggestion marks the form as edited, so the unsaved-changes guard and the draft autosave see it.
- States: loading (a status line in the card, the button busy), error (the shared error alert with Try again, which reuses the same `requestId` so a lost answer is never charged twice), out of credits (warning with the reset date), catalog fallback note ("No credits were used"). A polite live region announces what was filled and an Undo.
- Mock mode: `?themeSuggest=slow|error|busy|limit|fallback|long`, `?ai=nocredits`, `?ai=off`.

## Tests

`gcp/tests/unit/ai-suggest-theme.test.ts`: auth denial (member, organizer, another company, signed out, strict request), tenant isolation (tools ignore an invented `companyId`, the history source is asked for the caller's company only), privacy (buckets at the floor, no exact counts or names, the hint not in logs, audit or storage), the no-duplicate rule (themes, scheduled themes, recent events, each other), tag repair, number grounding, free weeks, credits charge and refund (model failure, everything a repeat, moderation flagged or down), out of credits, kill switches (deployment, company AI off, per-company switch), daily caps (company and per admin), idempotency (replay, reused id, in progress, crashed run taken over without a second charge), the deterministic catalog fallback, the demo agent, the pricing ceilings. `apps/admin/src/components/__tests__/ThemeSuggest.test.tsx`: fills in place, keeps the admin's edits until Replace mine too, Undo, Another idea without a new request, hint and retry with the same request id, the error alert without codes, out of credits, hidden for organizers and when off, Spanish, and the wire parser.
