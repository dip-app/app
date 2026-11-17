# Admin weekly suggested-events email (stretch S6)

Status: built November 17, 2026 behind `EMAIL_ENABLED` and the AI events switches (both off), nothing deployed. Part of the [V2 stretch goals](../../milestones/v2/STRETCH_GOALS.md). Builds on [AI event ideas](ai-event-creation.md) (decision port, Jev adapter, budget guard), [tag interest counts](tag-interest-counts.md), [email](email.md) (outbox, templates, unsubscribe) and the shared [notification preferences](notification-preferences.md). Issues: parent #244, SUG-1 #245 to SUG-5 #249.

## Goal

Once a week, each admin who opted in gets a short, calm email with 3 to 5 event ideas for the coming weeks, chosen from a curated catalog and ranked for their company, each with a one-line pitch, a friendly fit label for strong matches, one or two "why" lines grounded in the company's own data, and a button that opens the portal event editor already filled in.

- As an HR admin, I turn the weekly ideas email on in the portal (default off), pick the day and hour, preview it and send myself a test.
- As an HR admin, I see why an idea was picked ("3 more teammates picked Music this month", "Your last hike filled 24 of 30 spots") and start creating it with one click.
- As the company, nothing personal reaches a model, spend is capped by the AI budget, and the email respects every email switch and the unsubscribe flow.

## Flow

1. **Scheduler** `sendAdminSuggestionsEmails` runs every hour (`0 * * * *`, UTC). For each company with `emailSettings/{c}.enabled == true` it checks the AI switches (`AI_EVENTS_ENABLED` with the company's `aiSettings/current.enabled`), reads the company time zone (`emailSettings/{c}.timeZone`, else `EMAIL_DEFAULT_TIME_ZONE`) and the schedule (`companies/{c}/suggestionsEmail/settings`: `weekday` 1 = Monday to 7, `hour` 0 to 23; default Monday 9). It is due when the local weekday matches and the local hour is at or after the configured hour (so a missed run catches up the same day).
2. **Digest, once per company-week.** `companies/{c}/suggestionDigests/{weekKey}` (`weekKey` = ISO week in the company zone, for example `2026-W48`) is created with a lease; a finished digest is reused by the job, by previews and by test sends, so a week is ranked at most once.
3. **Recipients.** Active members with role `admin` whose resolved email preference `admin_suggestions` is on. One outbox document per admin per week: `outboxId("admin_suggestions", "{companyId}-{weekKey}", uid, weekKey)`, created with `create()`, so replays never enqueue twice; the existing sender then applies `EMAIL_ENABLED`, company switch, tenant match, member status, suppression, preference and the member and company daily caps, at most once.

## Data used (all company-internal aggregates)

| Signal | Source | How it is used |
| --- | --- | --- |
| Past events (last 180 days, ended, not canceled) | `companies/{c}/events`: `title`, `tagIds`, `startTime`, `endTime`, `capacity`, `attendeeCount`, `isOutdoor`, `costCents` | Per theme: count, average fill rate, last held, best example; weekday and daypart performance; recent titles for novelty |
| Ratings and comments | none exist in the data model | Not used; noted so a later rating feature can plug in |
| Interest counts | `companies/{c}/tagStats` (tag-counts module) | Bucketed `5-9`, `10-19`, `20+`; tags under 5 named without counts |
| Interest growth | the `tagCounts` snapshot stored on the digest about four weeks earlier | "N more teammates picked X this month" when the tag has at least 5 members and grew by at least 2 |
| Calendar density | upcoming events in the next 28 days | Quiet weeks get suggested; a busy fortnight means 3 ideas and low-key ones first |
| Weekly challenge themes | `companies/{c}/challenges` with `type == "weekly"`, current and next three | Theme fit question and a "Fits the ... weekly theme" line |
| Idea catalog | `modules/suggestions/domain/catalog.ts`, 50 curated templates | Candidates with duration, group size, budget, best days and dayparts, seasonal months, venue type, cover |

Never used: names, emails, departments, per-member interests or RSVPs, photos, comments, chat.

## Ranking

1. **Deterministic prefilter** (code): seasonal fit for the month in the company zone (northern hemisphere months; a southern-hemisphere option is an open question), budget at most $50 per person, group size the company can fill (when the member count is known), not suggested in the previous 6 weeks, not the same activity as an event held in the last 6 weeks. A prior score (interest match by tag counts, theme attendance history, theme gap, weekly theme, low-key bonus on busy weeks) keeps the top 12, at most 2 per theme.
2. **Typed questions** (Jev, see below) score each of the 12 candidates on four judgments.
3. **Composite score** in code: `0.35 interest + 0.25 appeal + 0.20 freshness + 0.10 weekly theme + 0.10 history prior`, each in 0..1 (Score answers use the expected level from the level probabilities, not only the top level).
4. **Deterministic rules after ranking**: at most one idea per theme, no two with the same goal when another option is close, 5 ideas on a quiet calendar, 4 normally, 3 when the next two weeks hold 6 or more events.
5. **Fit labels** (only for strong matches, never percentages): composite at least 0.78 is "Perfect fit", at least 0.66 "Great choice", at least 0.55 "Good match", else no label. No labels at all when the company has no data yet (`dataLevel: "none"`).
6. **Pitch**: templated from the catalog's curated one-liner. No language model writes copy, so the email costs nothing beyond the ranking calls and needs no moderation.

### Jev question set

One state per request (company aggregates as named JSON fields) and, per candidate, four questions whose instructions name the idea directly (the skill's "each item in its own question" pattern). Questions are bundled in requests of at most 24 (configurable).

| Id | Type | Question (per candidate) | Levels or criteria |
| --- | --- | --- | --- |
| `c{n}_interest` | Score | How well does "{idea}" match what people at this company are interested in (`company.interests`)? | No listed interest relates to it; a small or loosely related interest relates to it; a clearly related interest has a fair number of members; one of the largest interests is exactly this kind of activity |
| `c{n}_fresh` | Score | How different is "{idea}" from the company's recent events (`company.recentEvents`)? | Nearly the same activity was held recently; a similar activity was held recently; somewhat related to a recent event; nothing like it was held recently |
| `c{n}_appeal` | Score | How many coworkers in this company would want to join "{idea}" given `company.size` and `company.pastTurnout`? | Only a few enthusiasts; a small group; a good share of the team; most of the team |
| `c{n}_theme` | Noul | Does "{idea}" fit one of the weekly challenge themes in `company.weeklyThemes`? | true: the idea clearly matches a listed theme; false: the themes are about something else or none are listed |

Seasonality, budget, repeats, capacity and calendar density are code, not questions. A missing or malformed answer for a candidate falls back to that candidate's prior score.

### Engines and fallbacks

1. **Jev** (`JevDecisions`, model `AI_JEV_MODEL`, default `jev-latest`) when `SUGGESTIONS_DECISION_PROVIDER` is `jev` (the default) and `JEV_API_KEY` holds a real key.
2. **OpenAI mini** (`OpenAiDecisions` over the configured decision model, `DEFAULT_DECISION_MODEL` in `aiConfig.ts`, `gpt-4o-mini` today) when Jev is not configured or fails and `OPENAI_API_KEY` is present.
3. **Heuristic**: the prior score alone when both are unavailable, when the AI budget cannot cover the worst case, or when a provider errors. The email still goes out; the engine is recorded on the digest and in logs.

Not enough data (fewer than 3 past events and no interest counts): the email says so in one calm line ("We don't have much activity from your team yet, so these come from our catalog of crowd favorites.") and ranks catalog ideas by season, theme variety and the weekly theme.

### Cost and the AI budget guard

The run reserves its worst case on the company's `aiUsage/{yyyymm}` document (pending key `suggest_{weekKey}`, same 5 minute expiry) and settles the actual token cost, so it shares the company's monthly and daily AI budget. It is not counted as a generation. Typical cost: Jev about 3 requests of 4,000 input tokens, about $0.0005 a week; the OpenAI mini fallback under $0.01. When the budget cannot cover the reservation the heuristic engine runs and nothing is spent.

## Why-lines (grounded, at most 2 per idea)

In priority order, only from aggregates: interest growth ("3 more teammates picked Music this month"); interest size ("Music is one of your top interests, 20+ members"); past success ("Your last outdoor event, "Sunset hike", filled 24 of 30 spots"); a gap ("No arts events in the last 8 weeks"); the weekly theme ("Fits the "Move more" weekly theme"); the calendar ("The week of Dec 1 is quiet on your calendar"); season ("A good pick for winter"). Interest counts under 5 are never shown. Event titles are the company's own (admins already see them).

## Deep links

Each idea links to `https://letsdip.work/admin/ideas/suggested/?t=<token>`. The token is `base64url(payload).base64url(HMAC-SHA256)` over `{v: 1, c: companyId, w: weekKey, i: ideaId, e: expiry}` (30 days) with the existing `EMAIL_UNSUBSCRIBE_KEY` under the purpose label `suggest-link:v1` (no new secret). The portal page calls `resolveSuggestedIdeaV1`, which verifies the signature and expiry, requires the caller to be an admin of that company (`ai.generate`), and returns a `GeneratedEventDraft` built from the catalog (title, description, tags, cover, daypart, duration, venue type and hint, cost, capacity, outdoor flag, rationale). The page hands it to the event editor through the same session hand-off as the AI ideas flow (`saveAiDraft`), so venue and exact time stay with the admin and nothing is saved until they save.

## Portal

`/admin/suggestions/` ("Weekly ideas email", admins only): an on/off switch for the admin's own `admin_suggestions` email preference, day and hour (company time zone shown), a dry-run preview of this week's email (rendered server-side, shown in a sandboxed frame, nothing sent), and "Send me a test" (enqueues one test email through the normal outbox; at most one per admin per hour; needs email enabled and the switch on).

Callables (v1, additive): `manageSuggestionsEmailV1` (`status`, `preview`, `sendTest`, `subscribe`, `unsubscribe`, `setSchedule`) and `resolveSuggestedIdeaV1`.

## Email

Template `admin_suggestions` in the email template system, category `admin_suggestions` (email only, default off, offered to everyone by the registry but only admins are ever sent it). It follows the [email style guide](email.md#email-style-guide): full-bleed header with the logo art, one heading, the greeting line, an optional data note, one card per idea (theme tile from `apps/admin/public/img/email/ideas/<theme>.png`, an opaque tile composited from the weekly theme art on its accent color; fit label pill; title; pitch; facts line; why-lines; when hint; "Start this event" link button), a primary "Open event ideas" button, the footer (reason, unsubscribe and "Manage in the admin portal", "Sent by DIP · Questions? support@letsdip.work"), then the footer banner. Tables only, inline styles, light and dark, plain-text alternative, no one-sided colored borders on rounded elements.

## Privacy

- Models get only company aggregates: bucketed interest counts by tag name, theme-level turnout and fill rates, the last 10 event titles (company-authored, truncated), weekly theme titles, company size bucket and the season. Never a name, email, department, per-member data, comment or photo.
- Jev and OpenAI requests carry no admin note at all (there is no free text in this feature).
- Logs: company id, week key, engine, counts, token usage, cost. Never titles or email content.
- The email goes only to admins of the company the data belongs to; the deep link re-checks the role and company on use.

## Rollout and flags

Needs `EMAIL_ENABLED=true`, `emailSettings/{c}.enabled`, `AI_EVENTS_ENABLED=true` with `aiSettings/current.enabled`, and the admin's opt-in. Optional: `JEV_API_KEY` (else OpenAI mini, else heuristic), `SUGGESTIONS_DECISION_PROVIDER` (`jev` or `openai-mini`). Rollback: turn any switch off; digests expire after 120 days (TTL on `expireAt`).

## Decisions (November 17, 2026)

1. Category id `admin_suggestions`, email only, default off; push does not offer it. iOS does not show it (admins manage it in the portal); the rules accept the key so the app's merge writes keep working.
2. Pitches are templated catalog copy, not model-written: cheaper, no moderation, consistent tone.
3. The schedule is per company (`companies/{c}/suggestionsEmail/settings`), set by any admin, default Monday 09:00 in the company zone.
4. Test sends require the admin's switch to be on (the normal sender enforces preferences) and are limited to one per hour.
5. Deep links reuse `EMAIL_UNSUBSCRIBE_KEY` with a purpose label rather than a new secret.

## Open questions

1. Southern-hemisphere companies: add a hemisphere or region to company settings to flip seasonal months?
2. Should organizers also be able to opt in?
3. Event ratings: when a rating feature lands, add average rating per theme to the history aggregates.
