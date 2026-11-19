# AI event ideas and prompt-to-event drafts (stretch S2)

Status: built November 17, 2026 (AI-1 to AI-8; AI-7 live eval run once on November 17, 2026, see Evaluation; AI-9 deferred; AI-10 runbook written; rollout policy changed November 19, 2026 to on by default for every organization, see Rollout and flags). Generation runs on a cheap, older OpenAI model (`gpt-4o-mini`), prompted for small models; decision steps (note triage, draft checks) go through a provider-neutral port that uses TypeSafe AI's Jev model by default whenever a Jev key exists, with `gpt-4o-mini` and then deterministic rules as fallbacks. Not deployed; needs the owner actions in the [AI events runbook](../../ops/ai-events.md). Part of the [V2 stretch goals](../../milestones/v2/STRETCH_GOALS.md). Depends on [tag interest counts](tag-interest-counts.md). Model names, prices and limits below were verified on November 17, 2026 against the OpenAI and TypeSafe docs listed under Sources; re-check before changing them because they move.

## Goal and user stories

An HR admin chooses from a short card-style flow, informed by what employees are interested in, then types a short prompt; the server returns fully filled-out event drafts (title, description, tags, time suggestion, capacity, cost, outdoor flag, cover) that the admin reviews, edits and saves with the existing create flow.

- As an HR admin, I see which interests are common or thin in my company as the first step.
- As an HR admin, I answer 3 quick card questions (goal, group and setting, budget and timing), then add a sentence of my own.
- As an HR admin, I get 3 drafts with a one-line reason each ("Cooking is a top interest, 31 members") and pick one to open in the normal event form.
- As an HR admin, nothing is published until I save; every draft is editable.
- As the company, AI use is capped, can be disabled, and never exposes individual employees.

## Current state (findings)

- Events are created by `createEventV1` (`gcp/functions/src/modules/organizer`), request `CreateEventRequest { contractVersion, companyId, requestId, event: EventDraft }`. `EventDraft` requires `title` (1-120), `description` (1-5000), `tagIds`, `coverImageURL`, `startTime`, `endTime`, `venue`, `costCents`, `costNote`, `capacity` (1-10000), `isOutdoor` (`contracts/v1/models.schema.json`). The server validates strictly (`organizer/domain/eventDraft.ts`).
- **Cover images are catalog-only in V1**: `coverImageURL` must be one of five `catalog://default/<category>` values (`APPROVED_COVER_URLS` in `eventDraft.ts`), and iOS maps unknown values to a tag-based fallback (`ui/Packages/DIPCore/Sources/DIPCore/EventCover.swift`). The nine weekly-theme art keys are a separate allow-list ([theme catalog](../theme-catalog.md), `docs/design/theme-art.md`).
- `venue` needs real coordinates (`Venue` with `fsqPlaceId`); the portal fills it from its venue fields (`apps/admin/src/components/EventForm.tsx`). A model must not invent venues.
- Admin portal is Next.js (`apps/admin`), calls callables through `apps/admin/src/lib/api.ts`. Permissions are server-side (`can(role, permission)`, [admin contract](../../contracts/admin.md)); `event.manage` allows organizers and admins.
- Tags are a global catalog (14 tags in `apps/admin/src/lib/catalog.ts`); per-company counts do not exist yet ([tag counts](tag-interest-counts.md)).
- At research time no AI code and no AI provider secret existed. Functions: Node 22, `firebase-functions` v7, `firebase-admin` 14, region `us-central1`, App Check enforced outside the emulator.
- Weekly theme `Challenge` already carries a theme and default tag per week; ideas can optionally align to the current theme.

## Options considered

### Where the AI runs

| Option | Verdict |
| --- | --- |
| Admin portal calls the AI provider directly | Rejected: leaks the key, no per-company caps |
| Callable in Functions calling the OpenAI API (built) | Key in Secret Manager, per-company metering, aggregate data stays server-side, reuses auth and App Check |
| Firebase AI Logic | Rejected: client-SDK proxy for Gemini, not for OpenAI models ([docs](https://firebase.google.com/docs/ai-logic)) |
| Genkit | Optional: tracing and a dev UI, adds a layer; the plain SDK is enough for one call and one schema ([docs](https://genkit.dev/docs/get-started/)) |

### Model choice

Owner decision (November 17, 2026): no flagship or current-generation models; use cheap, small, older models and prompt them well.

Older cheap models on the OpenAI API, verified November 17, 2026 against the [pricing](https://developers.openai.com/api/docs/pricing), [model pages](https://developers.openai.com/api/docs/models/gpt-4o-mini) and [deprecations](https://developers.openai.com/api/docs/deprecations) (prices per 1M tokens: input / cached input / output):

| Model | Price | Structured outputs (`json_schema`) | Status |
| --- | --- | --- | --- |
| `gpt-4o-mini` | $0.15 / $0.075 / $0.60 | Yes (the first model with strict schemas) | Deprecated, shutdown January 14, 2027 (replacement named by OpenAI: `gpt-6-luna`) |
| `gpt-4.1-mini` | $0.40 / $0.10 / $1.60 | Yes | Deprecated, shutdown January 14, 2027 |
| `gpt-4.1-nano` | not listed | n/a | Shut down October 23, 2026: not available |
| `gpt-5-nano` | $0.05 / $0.005 / $0.40 | Yes (reasoning model, hidden reasoning billed as output) | Deprecated, shutdown December 11, 2026 |
| `omni-moderation-latest` | free | n/a | Current |

**Default: `gpt-4o-mini` for drafting and for the OpenAI decision fallback; Jev for the decision steps; free moderation for screening.** `gpt-4o-mini` is the cheapest still-available older model with reliable strict structured outputs (`gpt-4.1-nano` is gone; `gpt-5-nano` is a reasoning model that bills hidden reasoning tokens and shuts down in under a month). Drafting runs at temperature 0.3, decisions at 0. Every step's provider, model id, temperature, effort and output ceiling live in one module (`infrastructure/aiConfig.ts`) and can be overridden with environment values, so a model change is a config change. **Action before January 14, 2027:** move `AI_MODEL_GENERATE`, `AI_MODEL_TRIAGE` and `AI_MODEL_DRAFT_CHECK` to a model OpenAI still lists. The code detects reasoning models (`gpt-5` and later, `o`-series) and then sends `reasoning.effort` instead of `temperature` and uses the larger output ceilings, so any listed model works by configuration.

**Per-step model matrix**

| Step | Provider default | Model id default | Env override | Effort | Max output tokens | Purpose |
| --- | --- | --- | --- | --- | --- | --- |
| generate | OpenAI (Responses API) | `gpt-4o-mini` | `AI_MODEL_GENERATE` (`AI_EFFORT_GENERATE` for reasoning models) | temperature 0.3 | 2,500 (12,000 on a reasoning model) | Write 1 to 3 event drafts as structured output |
| triage | `jev`, then `gpt-4o-mini`, then rules | `jev-latest` (fallback `gpt-4o-mini`) | `AI_DECISION_PROVIDER_TRIAGE`, `AI_MODEL_TRIAGE`, `AI_JEV_MODEL` | temperature 0 | 400 (2,000 on a reasoning model) | Typed yes/no questions about the admin's note before any drafting |
| draftCheck | `jev`, then `gpt-4o-mini`, then rules | `jev-latest` (fallback `gpt-4o-mini`) | `AI_DECISION_PROVIDER_DRAFT_CHECK`, `AI_MODEL_DRAFT_CHECK`, `AI_JEV_MODEL` | temperature 0 | 400 (2,000 on a reasoning model) | Per draft: cover category, fit with the request, safety |
| moderation | OpenAI moderation | `omni-moderation-latest` | `AI_MODEL_MODERATION` | n/a | n/a | Free check of the note and of every draft's text |

Effort values (`minimal`, `low`, `medium`, `high`, `xhigh`) are sent only to reasoning models; older chat models such as `gpt-4o-mini` get a temperature instead (each family rejects the other parameter). Decision provider values: `jev` (the default; anything unknown also means `jev`) or `openai-mini`. Jev (TypeSafe AI System One, `POST https://api.typesafe.ai/v1/systemone`, Bearer auth) answers a step whenever its provider is `jev` and `JEV_API_KEY` holds a real value (not blank or `none`). The fallback chain per call is Jev, then the OpenAI model of the same row, then deterministic keyword rules (`infrastructure/heuristicDecisions.ts`, free); the answering provider is logged as `decisionProviders` and stored on the request document (`decisionProviders`, `models`). Jev models: `jev-latest` (currently `jev-1.14.0`) and `jev-1.13.0`, $0.042 per 1M input tokens with output free, per-organization rate limits ([quickstart](https://docs.typesafe.ai/introduction/quickstart.md), [API](https://docs.typesafe.ai/go/api.md), [models](https://docs.typesafe.ai/go/models.md)).

Model ids known to the code (`KNOWN_MODELS`, documentation only; an id missing from the price table is priced at the most expensive known rate): OpenAI `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-5-nano`, `gpt-5-mini`, `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-luna`, `gpt-6-sol`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `omni-moderation-latest`; TypeSafe `jev-latest`, `jev-1.13.0`.

Cost of one 3-draft generation at the defaults, measured in the live eval (16 generations): drafting averaged 1,632 input and 489 output tokens, $0.00054 per generation; a Jev decision call averaged about $0.00003 (triage 26 micro-USD per note, a draft check 30); the same questions on `gpt-4o-mini` cost about $0.00015 per call. Typical total with Jev: about **$0.0007 per generation** (about $0.0011 if `gpt-4o-mini` answers the decisions). At the default cap of 30 generations per company per month that is about $0.02 per company per month.

### Structured output

Drafting uses the Responses API: the zod schema (`modelDraftsSchema`) goes through `zodTextFormat` into `client.responses.parse` with `strict: true`, which returns a parsed object ([docs](https://developers.openai.com/api/docs/guides/structured-outputs)). Strict mode enforces enums, integer ranges, `multipleOf` and array sizes (not string lengths), so the schema is **bounded by the request**: exactly `count` drafts, 1 to 3 catalog tag ids (enum), the budget's cost range, the group's capacity range, the timing's dayparts and duration range (15-minute steps) and the setting's venue types. Small models cannot break those limits. The adapter re-validates the parsed value with the same zod schema, so a wrong shape is a `malformed` outcome. The domain then repairs and checks the value deterministically against a loose shape (types only): `parseModelDrafts` trims text to the field limits and strips markdown, maps tag names or bare words to catalog ids (`normalizeTagId`) and drops unknown ones, maps cover words to the approved categories (`normalizeCoverCategory`, aliases such as "food" or "nature", then the tags), forces the daypart and venue type to values allowed by the timing and setting, clamps duration, cost and capacity, then validates against `GeneratedEventDraftSchema` and the `createEventV1` prefill schema (`EventDraftPrefillSchema`). A refusal, truncation (`max_output_tokens`), malformed or unusable output is retried once (two drafting attempts at most), then fails with `AI_OUTPUT_INVALID` and no generation is counted. Decision answers are zod-validated per question type too (Choice, Score, Noul), and a Jev response that does not match the questions asked is treated as an unavailable provider.

### Images

| Source | License and rules | Fit |
| --- | --- | --- |
| Our catalog art (existing five covers, nine weekly theme illustrations) | We own it; no external calls | **Default and first release** |
| Pexels API | Free license, modification allowed, attribution not required but a link to Pexels is requested; 200 requests per hour and 20,000 per month by default; storing images is not addressed (ask Pexels, UNVERIFIED) ([license](https://www.pexels.com/license/), [API](https://www.pexels.com/api/documentation/)) | Best stock option if storing is confirmed |
| Unsplash API | Must hotlink API URLs, credit the photographer, call the download-tracking endpoint on use; demo 50 requests per hour; "non-automated" use intent ([guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines)) | Avoid: hotlinking conflicts with our storage model and automated picks |
| Pixabay API | Hotlinking not allowed, must cache for 24 hours and download to our server, 100 requests per minute ([docs](https://pixabay.com/api/docs/)) | Possible; content license text not read (UNVERIFIED) |
| Openverse | Mixed Creative Commons terms, accuracy of license data not guaranteed | Skip |
| Generated (Imagen 4 on Vertex, about $0.02 to $0.06 per image, SynthID watermark; Gemini image models about $0.034 to $0.134) | Stored in our Cloud Storage; ownership terms not checked (UNVERIFIED); price figures from a search summary, unconfirmed | Opt-in "Generate cover" later |

**Recommendation:** Phase 1 maps each draft to a catalog category (the model picks from an enum). Phase 2 adds a stock or generated cover that an admin explicitly picks, copied into `companies/{c}/eventCovers/{id}` by a server step. That needs a **contract decision**: `createEventV1` today rejects any `coverImageURL` outside `catalog://default/*`. Options: (a) extend the accepted set additively to a `storage://companies/{c}/eventCovers/{id}` scheme (old clients already fall back to tag art, so they stay safe; the validator and iOS mapper change), or (b) a new contract version. Prefer (a), reviewed by the contract owner, because `contracts/v1` is a choke point and any rejected-value change affects every client. If Pexels storage is not confirmed in writing, fall back to Imagen or catalog art only.

## Design

### Flow (portal)

Step 0 "What people like": cards of the company's top interests and thin interests from `tagStats` (counts below 5 are hidden or rounded, see Privacy); pick one or more "focus" tags or "Surprise me".
Step 1 "Goal": cards `team bonding`, `wellness`, `learning`, `give back`, `celebrate`, `competition`.
Step 2 "Group and setting": cards for size (`small under 10`, `team 10 to 30`, `company-wide`) and setting (`indoors`, `outdoors`, `nearby offsite`).
Step 3 "Budget and timing": cards `free`, `under $15 per person`, `$15 to $50`, `over $50`, and `weekday lunch`, `after work`, `weekend`.
Step 4 "Anything else?": a text prompt (500 characters, pre-filled with suggestions), then **Generate**. Result: 3 draft cards with title, description, tags, suggested slot, capacity, cost, cover, and the one-line reason; "Open in editor" fills the existing `EventForm` (venue and exact time stay with the admin) and saving uses `createEventV1`.

Each step stores only enum values, so the whole structured part of the request is validated against enums.

### Dipbot and Dipbot Suggest (added November 17, 2026)

The portal names its AI features **Dipbot** (one copy module, `apps/admin/src/lib/aiStrings.ts`; renaming is a one-line change). The page is "Dipbot" ("Work with Dipbot to plan your next event"), the note step is "Ask Dipbot", results are "Dipbot's drafts", and the single Dipbot action on each step is "Use suggestions" (there is no separate surprise card: picking no interests means any interest can fit). Its icon is the DipbotMark (a soft cloud with two small sparkles, `components/DipbotMark.tsx`) on every Dipbot action and label. Dipbot's icon is the purple ghost mascot on a lavender disc.

**Dipbot Suggest** marks, for each choice of steps 1 to 4, the option the decision model ranks first. `getEventIdeaSuggestionsV1` (`application/suggestions.ts`, `domain/suggestions.ts`) asks one decision call per visit with six typed questions over one shared state (Choices for interest, goal, group size, setting and timing; a Score for the ordered budget levels). The state holds rounded interest buckets by name, the theme title and aggregate counts of the last 60 past events (cost band, timing, capacity band, outdoors, tags); no titles, descriptions, people or ids. Provider order: Jev, then the OpenAI triage model, then a deterministic heuristic from the same facts; no data at all returns `provider: "none"`. Each suggestion carries the top option's probability (argmax of the distribution, ties to the earlier option), a one-line reason written by code, never by the model, and a `reasonBasis`. Honesty rule (`domain/suggestionReasons.ts`): personalized wording ("your team", "your recent events") is used only when the company's own data drove the suggestion (`company_data`: interest buckets above the privacy floor, the weekly theme, at least 5 past events); otherwise the line is generic ("A good fit for most workplace groups") and never implies personalization. Lines carry no numbers, names or titles, stay under about 60 characters and rotate deterministically by option. The weekly email's "why" lines (`suggestions/domain/reasons.ts`) already emit only grounded signals and fall back to the catalog note when there is no data.

The portal never shows percentages. `apps/admin/src/lib/suggestionLabels.ts` maps a probability to "Perfect fit" (>= 0.85), "Great choice" (>= 0.70) or "Good match" (>= 0.55) and shows nothing below; the OpenAI fallback and the heuristic are capped at "Good match". At most one option per choice is tagged (an outline tag, not a control); a suggestion never selects anything. "Use suggestions" applies Dipbot's suggestions for every step at once (interests, goal, group, budget; the note is never filled), from the saved suggestions, so it spends no credits. It stays on the current step, highlights the picks there, marks the stepper steps complete and confirms with a toast ("Applied Dipbot's suggestions to all steps."; if some steps have no suggestion the toast names them). Each step stays editable. It is disabled with a reason while suggestions load or when none exist. The header is the shared `SectionHeader`: Dipbot mark, "Dipbot suggests 2 choices", muted "Updated 3 hours ago", then "Refresh suggestions | 1 credit" (ghost; the only credit spend) and "Use suggestions". A step with nothing to apply shows an honest message and no button ("Not enough data yet to suggest interests."). The interface never names a provider (no "Powered by Jev"): the banner is one line ("Dipbot suggests 2 choices" and the pick action), the tag tooltip says "Suggested by Dipbot" with the reason, and phones get the reasons as a caption under the step heading. The decluttered flow has no side rail: the privacy note sits behind a "What does Dipbot see?" link in the header, the daily draft-run count is part of the credits meter tooltip, a slim summary of earlier answers shows from step 2, and the weekly theme is one inline line. Cards carry flat mascot illustrations (`public/img/ai/`, generated by `scripts/make-ai-art.py`; interests use the weekly-theme art).

### Callables (new, v1, additive)

- `getEventIdeaContextV1`: admin only; returns top and thin tags with suppression applied, the current weekly theme, and the company's remaining AI quota. Read-only.
- `generateEventDraftsV1`: admin only (new permission `ai.generate`, admin; organizers can be added later). Request: `{contractVersion: 1, companyId, requestId, choices: {focusTagIds, goal, groupSize, setting, budget, timing}, prompt, count (1-3)}`. Response: `{contractVersion: 1, drafts: [GeneratedEventDraft], usage: {remaining}}`. `requestId` makes a retry return the stored result instead of spending again (idempotency receipt, as in other commands). Nothing is written to `events`; drafts are returned and may be stored briefly in `companies/{c}/aiDraftSessions/{id}` with a TTL of 24 hours for refresh and audit.
- `getEventIdeaSuggestionsV1` (updated): admin only, AI on. Request `{contractVersion: 1, companyId, requestId?, refresh?, sessionId?}`; response adds `cacheStatus` (`fresh`, `stale`, `computed`), `computedAt`, `staleReason`, `creditsCharged` and `considerations` (ranked preference chips). The answer is saved once per company (`companies/{c}/aiCache/suggestions`); visiting is free and makes no model call when it exists, the model runs only on the first visit or `refresh: true` (1 credit).  response `{contractVersion: 1, provider: jev | openai | heuristic | none, suggestions: [AiStepSuggestion], cached}`. Cached per admin and session for an hour; priced into the AI spend caps, not the generation limits.
- `GeneratedEventDraft` mirrors `EventDraft` except: `startTime` and `endTime` are replaced by `suggestedDaypart` and `durationMinutes` (the admin picks the exact slot), `venue` is replaced by `venueType` and `venueSearchHint` (the admin chooses a real venue), and `coverImageURL` is `coverCategory` (enum) in Phase 1. Extra fields: `rationale` (max 160 characters), `tagIds` (enum limited to catalog ids).

### Prompt design

Tuned for small models (`domain/prompt.ts`):

- One short, constant system prompt (about 3,700 characters): the role in one line, what each input block is, then **field-by-field rules** (title 3 to 8 words, description 2 or 3 short plain paragraphs, 1 to 3 tag ids, a venue described as a kind of place, cost and capacity inside the ranges given in the request), one line of standards (inclusive, no alcohol-centered events, no advice, no names or contact details), and **two short worked examples in the exact output schema** (an indoor lunch, and a free after-work walk whose note tries an injection that the example ignores).
- User content: the enum choices as labels plus **the numeric limits they imply** (`limits`: cost range in cents and dollars, capacity range, duration range, allowed dayparts and venue types), the aggregate interest list `[{tagId, name, bucket}]`, the weekly theme, today's date, and the admin's free text JSON-encoded inside `<admin_note>`, described as data, never instructions; `<` and `>` are escaped so the note cannot close its block.
- No tools (no web search, no code). Temperature 0.3.
- Decision fallback prompt (`infrastructure/openAiDecisions.ts`): a short instruction with the three answer forms and two worked examples, the questions rendered as plain lines with their options, yes and no descriptions and levels, and a tight schema per question (option keys as an enum, level as a bounded integer, probabilities in 0 to 1).
- Output: the bounded strict schema above, then deterministic repair and the contract validators; a failed validation retries once, then returns a friendly error without charging the quota.

### Safety and moderation

- Admin-only, human-in-the-loop: every draft is edited and saved by a person, and the output never auto-publishes. Event ideas are not employment decisions, and we send aggregates only.
- Links, emails and phone numbers in the note are rejected before any provider call.
- Note screening, in order: (1) OpenAI `omni-moderation-latest` (free) on the note; a flagged note is declined. (2) Triage through the `DecisionPort` (Jev, then `gpt-4o-mini`, then keyword rules): four Noul (yes probability) questions, each phrased as one observable judgment with concrete yes and no descriptions (TypeSafe's recommended form): whether the note gives orders to the tool (`injection`), asks for something that could hurt, exclude or offend coworkers (`unsafe`), is not about planning a workplace event (`offTopic`), or shares private facts about one identifiable person (`personalData`). Any answer at or above 0.7 declines the note (`NOUL_YES = 0.7`, following TypeSafe's guidance, [confidence](https://docs.typesafe.ai/confidence.md)). A missing or malformed answer counts as a decline. If Jev fails, `gpt-4o-mini` answers; if both fail, the keyword rules answer (0.9 on a rule hit, else 0.1), so a provider outage alone does not block admins while moderation, the validators and human review stay in place; only a moderation failure fails closed (`AI_UNAVAILABLE`). A declined note is `AI_PROMPT_REJECTED` and counts toward the daily declined-note limit.
- Draft screening: free moderation on every draft's text, then one draft check per remaining draft with three questions: `cover` (Choice among the five cover categories; trusted only when the chosen option has probability of at least 0.6, else the model's own pick stays), `fit` (Score over four ordered levels, from unrelated to a strong fit, used to order the drafts best first) and `unsafe` (Noul; at or above 0.7 drops the draft). A failed check keeps the draft because moderation and the validators already gate it; if every draft is dropped the run counts as invalid output.
- Never the sole gate: Jev and the mini model give calibrated hints that the server applies with thresholds. Free moderation and the deterministic validators (URLs, emails, phones, allow-lists, lengths) stay in front of them, and a person reviews every draft.
- Output filter: reject drafts containing URLs, email addresses or phone numbers; strip markdown.
- The UI labels drafts "AI suggestion, review before publishing". Drafts are not medical, legal or HR advice.

### Credits (what admins see)

Admins see Dipbot credits, never dollars. A fixed price table (`domain/credits.ts`: suggest panel 1, generate 10, regenerate 10, weekly email 3), a monthly allowance (default 500, override `monthlyCredits` in `aiSettings/current`), a ledger `companies/{c}/aiCredits/{yyyymm}` in the company's time zone, charge at the start and refund when no draft is produced, `AI_CREDITS_EXHAUSTED` when out. Details, rationale and the credit-to-cost mapping are in [AI events operations](../../ops/ai-events.md#dipbot-credits-internal). The responses carry `credits` (`creditsAllowance`, `creditsUsed`, `creditsRemaining`, `resetsAt`, `creditCost`); `budgetExhausted` was removed from `AiUsageSummary`. The dollar guard below is internal only.

### Cost and rate controls (internal, never shown to admins)

- `companies/{c}/aiUsage/{yyyymm}` document: in a transaction, reserve a worst-case cost before the call and reject when the reservation would pass the monthly or the daily company budget (`AI_BUDGET_EXHAUSTED`); settle with actual token usage afterward. Reservations expire after 7 minutes, longer than the 300-second function timeout; the run itself stops calling providers after a 240-second deadline (an `AbortSignal` passed to every provider call; SDK timeout 50 s, SDK retries off so the app loop is the only retry).
- Defaults (lowered for the cheap models): $2 per company per month (`AI_MONTHLY_BUDGET_CENTS=200`), $0.50 per company per UTC day (`AI_DAILY_BUDGET_CENTS=50`), 30 generations per company per month (`AI_MONTHLY_GENERATIONS`), 10 generations per admin per UTC day (`AI_DAILY_GENERATIONS_PER_ADMIN`), 3 declined notes per admin per UTC day (`AI_DAILY_FLAG_LIMIT`). Per-company overrides live in `companies/{c}/aiSettings/current`. At the defaults the generation caps bind long before the budgets (30 generations cost about $0.02); the budgets stop a costly model override from running away.
- Worst-case reservation per generation, from `worstCaseMicros` with the default models: one triage (a Jev call of 2,500 input tokens plus its `gpt-4o-mini` fallback of 2,500 input and 400 output tokens), two drafting attempts (6,000 input and 2,500 output tokens each on `gpt-4o-mini`) and three draft checks per attempt (review runs inside every attempt; each check is a Jev call plus its fallback, as for triage) come to **9,840 micro-USD, about $0.0098** (under one cent). Without a Jev key the decision calls are `gpt-4o-mini` only. On a reasoning-model override the larger ceilings apply automatically.
- Per-admin attempt cap (`AI_DAILY_ATTEMPTS_PER_ADMIN`, default 20 per UTC day): every reservation counts, including runs that fail, so repeated `AI_OUTPUT_INVALID` or `AI_UNAVAILABLE` runs cannot drain the company budget. It reuses the `AI_DAILY_LIMIT` error.
- Platform ceiling (`AI_PLATFORM_MONTHLY_BUDGET_CENTS`, default 20000): `aiUsagePlatform/{yyyymm}` is reserved and settled in the same transaction as the company reserve. Both callables run with `maxInstances: 5`.
- Metering: spend is accumulated as calls finish, so a run that throws mid-way still settles what was spent. A call that fails with unknown usage (timeout, network, 5xx) is charged the per-call worst case; 4xx errors are not. Settling is retried three times; a final failure logs the alertable `ai.settle_failed` (ids only).
- Context reads (interest counts, current theme) are best effort: a failure logs `ai.context_unavailable` with the source name and the run continues without them. The theme read needs the `challenges` composite index (type, endDate).
- An OpenAI project spend limit is the global backstop, set in the OpenAI dashboard by the owner.
- Kill switch: server param `AI_EVENTS_ENABLED` (default false; it also requires the `OPENAI_API_KEY` secret to hold a real value) and a per-company opt-out, `aiSettings/current.enabled: false` (server-owned, set by us; a missing document or field means on). With either off the feature is a clean no-op: generation fails with `AI_DISABLED`, the context callable answers `enabled: false` and the portal shows the off state.

### Data retention and secrets

- Drafting calls send `store: false`, so OpenAI does not keep response objects for later retrieval. OpenAI's retention of API inputs and outputs for abuse monitoring, and TypeSafe AI's retention and training terms for Jev requests, were not checked: UNVERIFIED. Read both providers' data terms and decide on zero data retention options before launch.
- Secrets: `OPENAI_API_KEY` and `JEV_API_KEY`, kept encrypted in `dip-app/secrets` and pushed with `scripts/secrets/sync-gcp.sh` ([secrets runbook](../../ops/secrets.md)), declared with `defineSecret`, read inside the handler only, redeploy functions after rotation ([config](https://firebase.google.com/docs/functions/config-env)). `JEV_API_KEY` set to `none` (or blank) turns Jev off.
- Logs: token counts, model ids, decision providers, quota, request id. Never the prompt, the admin's text or the output.

## Security and privacy

- Tenant isolation: company comes from the caller's server-owned membership; the client cannot supply counts or another company's id.
- App Check enforced; permission checked first; audit entry in `companies/{c}/auditLog` for each generation (who, when, tokens, not content).
- Aggregates only to the model, with small-cell suppression (under 5) so a thin tag cannot point at a person. No names, emails, departments or per-member data in prompts.
- Privacy policy: the Service providers section says that admin choices, the note and rounded anonymous interest counts go to OpenAI to draft events and may go to TypeSafe AI to classify and check them; never names, emails or individual profiles. Both are processors for the admin's own words.
- Employee consent: aggregate interest counts are already visible to admins through member management, and the prompt carries only buckets, so no new consent is needed (confirm with the owner, question 5).

## Testing plan

- Unit: Zod schema and validator (every `EventDraft` rule, unknown tag, oversized text, forbidden patterns), choices enums, suppression buckets, quota reservation and settle, idempotent replay.
- Contract: fixtures for `GeneratedEventDraft` and both request types in `contracts/v1/fixtures`; `npm run check:generated` clean.
- Emulator: callable denies non-admin, other tenant, missing App Check path, over-quota; uses fake ports (`LlmPort` and `DecisionPort` with canned responses); no live API in CI.
- Live eval (manual, capped at $1, one run only): 20 sample prompts, a rubric (valid, on theme, inclusive, no invented venue), `gpt-4o-mini` drafting, Jev against `gpt-4o-mini` on triage and draft checks. Done once; results under Evaluation. The eval file and runner are under `gcp/tests/ai-eval` (no secrets; keys come from the environment only).
- Portal: flow tests with mock responses; accessibility of the card steps.

## Rollout and flags

Policy (AI-10, issue #196, owner decision November 19, 2026: enable for all organizations by default; the idea is they would be paying subscribers): the staged dark launch (own company, pilot company, general) is replaced by on by default. A company is on unless its server-owned `aiSettings/current` says `enabled: false`; a missing document or field is on, so no data migration is needed, and any other value fails closed to off. The opt-out is operator-only (`scripts/set-company-ai.mjs`, idempotent, dry run by default). Every safety control stays: `AI_EVENTS_ENABLED` and the other kill switches win over a company that is on, the per-company credits (500 a month), generation caps, dollar guard ($2 a month, $0.50 a day) and the platform ceiling ($200 a month) still apply, admins only, tenant from membership. Worst case per company is about $2.25 a month (metered $2 plus up to about $0.25 of cover and venue picks bound by credits); see the summary table in [AI events operations](../../ops/ai-events.md#rollout-policy-ai-10-issue-196-on-by-default-for-every-organization). There is no billing or plan check yet; add a plan gate next to `companyAiEnabled` if a free tier appears. Rollback: flag off, or the per-company opt-out; no data model depends on it except usage docs.

## Risks

Generic or repetitive drafts (mitigate with interests and the weekly theme in the prompt, evaluate models); prompt injection through the admin's text (data framing, no tools, schema-only output, human review); cost spikes (caps); image licensing (default catalog art); model name drift (config params); stale numbers in this doc.

## Decisions (November 17, 2026)

The owner questions below were not answered before building; these defaults were used and are easy to change.

| Question | Default built | Where to change |
| --- | --- | --- |
| 1. Who may use it | Admins only: permission `ai.generate` | `PERMISSION_MATRIX` in `gcp/functions/src/modules/admin/domain/permissions.ts` and `can` in `apps/admin/src/lib/adminTypes.ts` |
| 2. Budget | Per company: $2 per month (`AI_MONTHLY_BUDGET_CENTS=200`), $0.50 per UTC day (`AI_DAILY_BUDGET_CENTS=50`), 30 generations per month, 10 per admin per UTC day, 3 declined notes per admin per day; off unless `AI_EVENTS_ENABLED=true` (with the OpenAI secret present); on for every company unless `companies/{c}/aiSettings/current.enabled` is `false` (changed November 19, 2026; it was opt-in) | Environment of the functions; per-company overrides `monthlyBudgetCents`, `dailyBudgetCents`, `monthlyGenerationLimit`, `dailyGenerationLimit` in `aiSettings/current` |
| 3. Images | Catalog art only. The model picks a cover category, the server maps it to an approved `catalog://default/*` value, so `createEventV1` and old app builds are unchanged. AI-9 (stock or generated covers) is deferred | `domain/covers.ts` |
| 4. Weekly theme | Yes: the running theme's title and tags are in the prompt as data, with "fit it when it suits" | `domain/prompt.ts` |
| 5. Privacy notice | Only rounded buckets (`5-9`, `10-19`, `20+`) reach the model or the portal; tags under 5 members are named without counts. The privacy page's Service providers section names OpenAI and TypeSafe AI | `apps/landing/privacy/index.html` |
| 6. Web search | Off. No tools at all | `infrastructure/openaiLlm.ts` |
| 7. Company time zone | Not needed: drafts carry a daypart and a duration; the admin picks the exact time in the event form | n/a |
| 8. Models | Owner: cheap, small, older models. Drafting `gpt-4o-mini` (temperature 0.3); decision steps Jev with `gpt-4o-mini` as fallback; moderation `omni-moderation-latest`; per-step env overrides in the matrix above. `gpt-4o-mini` shuts down January 14, 2027: switch before then | `infrastructure/aiConfig.ts` |
| 9. Provider switch | OpenAI for generation, by owner instruction. The earlier Claude plan was replaced at the owner's request | `infrastructure/aiConfig.ts`, `infrastructure/openaiLlm.ts` |
| 10. Decision steps | Owner: Jev is the intended provider for every decision step. Behind a `DecisionPort`: Jev by default whenever `JEV_API_KEY` holds a real key, else (or when a Jev call fails) `gpt-4o-mini` answering the same typed questions, else deterministic keyword rules. The answering provider is logged and stored on the request document | `infrastructure/stepDecisions.ts`, `infrastructure/jevDecisions.ts`, `infrastructure/openAiDecisions.ts`, `infrastructure/heuristicDecisions.ts` |
| 11. Validation | zod everywhere: request parsing, model output schemas (through `zodTextFormat`), re-validation after the SDK, decision answers per question type, then the contract schemas | `domain/**`, `infrastructure/**` |

Other build decisions:

- **Flow.** Four card steps (interests, goal, group and setting, budget and timing) and a note step at `/admin/ideas/`; 1 to 3 drafts per run; "Open in editor" fills the normal event form (venue and time stay empty) and nothing is saved until the admin saves.
- **Metering.** The worst-case cost is reserved in a transaction on `companies/{c}/aiUsage/{yyyymm}` before the call and settled with the real token cost afterward; only successful runs count as generations, but every call's cost is added to the monthly and daily spend. Reservations expire after 5 minutes, so a crashed run cannot block the caps.
- **Idempotency.** `companies/{c}/aiRequests/{uid}_{requestId}` stores the drafts for 24 hours; a retry with the same request returns them (`replay: true`) without spending.
- **Interest counts.** Read through the tag-counts store (`modules/tags`, TAG-2) behind the AI `InterestSource` port; no counts yet means `interestDataAvailable: false` and the flow still works.

## Open questions for the owner

1. Who may use it: admin only (recommended) or organizers too?
2. Budget: the defaults are $2 per month and $0.50 per day per company; confirm them and the OpenAI project spend limit.
3. Images: catalog art only for V2, or pursue Pexels storage permission and Imagen for covers?
4. Should the AI see the weekly theme and propose events that fit it?
5. Confirm aggregate interest counts in prompts need no extra employee notice (the privacy page now names OpenAI and TypeSafe AI).
6. Web search for venue or activity ideas: no for V2?
7. Where does the company time zone live (needed to turn dayparts into times)? None was found in the contracts.
8. Resolved: "jeb" is TypeSafe AI's Jev; the key is in `dip-app/secrets` and Jev is the default decision provider.
9. Which model replaces `gpt-4o-mini` before its January 14, 2027 shutdown? OpenAI names `gpt-6-luna` ($0.10 / $0.50, cheaper than `gpt-4o-mini` but a current-generation reasoning model); the owner asked for older models, and every older cheap model is deprecated.

## Evaluation (AI-7, November 17, 2026)

One live run of the 20 cases in `gcp/tests/ai-eval/cases.json` (11 ordinary, 5 edge, 4 adversarial) with the production prompts, bounded schema, validators and decision questions: `gpt-4o-mini` drafting; Jev (`jev-1.14.0`) gating generation and checking drafts; `gpt-4o-mini` answering the same decision questions for comparison. Hard cap $1; estimated maximum $0.15; **actual total spend $0.0196**. Aggregates only; the per-draft output stayed in the git-ignored result file.

Drafting (`gpt-4o-mini`, 16 generations; the 4 adversarial notes were declined by triage, as expected):

| Valid | Valid on first attempt | Retries | Refusals | Validation failures | Automatic check failures (cost, capacity, lunch length, contact info) | Named-venue heuristic hits | Output moderation flags | Avg tokens in / out | Avg cost | Avg latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 16 of 16 | 16 of 16 | 0 | 0 | 0 | 0 | 2 (both false positives: "Creative Sandwich Bar" and "DIY Smoothie Bar" are activity names) | 0 | 1,632 / 489 | $0.00054 | 8.1 s (6.1 to 10.6 s) |

Note triage (16 non-empty notes; 4 expected declines):

| Provider | Agreement with expected labels | False declines | Missed declines | Errors | Mean highest Noul, expected decline / expected pass | Answers in 0.3 to 0.7 | Avg cost per note | Avg latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Jev | 20 of 20 (100%) | 0 | 0 | 0 | 0.98 / 0.14 | 2 of 64 | $0.000026 | 131 ms |
| `gpt-4o-mini` | 20 of 20 (100%) | 0 | 0 | 0 | 0.94 / 0.05 | 0 of 64 | $0.00014 | 1.5 s |

Draft checks (46 drafts):

| Provider | Errors | Unsafe drops | Cover overrides | Avg fit (0 to 3) | Avg cost per check | Avg latency |
| --- | --- | --- | --- | --- | --- | --- |
| Jev | 0 | 0 | 13 | 2.70 | $0.00003 | 144 ms |
| `gpt-4o-mini` | 0 | 0 | 11 | 3.00 | $0.00015 | 1.3 s |

Jev and `gpt-4o-mini` agreed on the cover for 91% of drafts and on the unsafe flag for all of them. Moderation flagged no note and no draft.

Calibration sanity: Jev separates clearly (0.97 to 0.98 on the right question for each adversarial note; on ordinary notes every answer was at most 0.26 except one). Its two unsettled answers were `unsafe` 0.47 on "Happy hour with drinks and cocktails" (edge case; below the 0.7 decline line, and the drafts steered to non-alcoholic events) and `injection` 0.51 on the "write me a Python function" note (declined anyway as off topic at 0.98). `gpt-4o-mini` answered at the extremes and gave every draft the top fit score, so its fit is no use for ordering drafts; Jev's fit varied.

Weaknesses seen and suggested changes (not applied: the eval is not re-run):

1. **Cover category copies the first example.** `gpt-4o-mini` picked `cooking` for unrelated drafts (photography, painting, coloring, a music jam), likely anchored on example 1. Jev's draft check corrected 13 covers. Suggested prompt change: one line mapping themes to covers ("arts, crafts, music, learning and games: games; food: cooking; walks and nature: hiking; sport and movement: fitness; other outside activities: outdoors") and a second example cover that is not `cooking`.
2. **Capacity sits at the top of the range** (30 for every team event; 100 to 500 company-wide). Suggested: "capacity: a realistic headcount for the activity, often below the maximum".
3. **Rationales overstate or invent buckets** ("Games and hype are popular interests with 10-19 members" when only one was). Suggested: "name only interests listed in company_interests, with their exact bucket", plus a server check that drops a bucket the request does not contain.
4. **Thin variety in edge cases**: "fancy dinner" on a free budget became three potluck variants; a remote-first note produced one virtual and two office events. Suggested: "if the note conflicts with the budget or setting, say so in one draft's description and keep the others different".
5. **Drafting latency** of about 8 seconds per 3 drafts; acceptable behind a loading state. Lowering `max_output_tokens` would not help (the drafts use about 490 tokens).
6. **OpenAI fallback calibration**: answers at the extremes and a constant top fit score. Fine as a fallback; Jev should stay primary.
7. The named-venue heuristic in the eval flags activity names that end in "Bar"; treat as review-only.

## Work breakdown

| ID | Title | Scope | Acceptance | Est | Area | Depends |
| --- | --- | --- | --- | --- | --- | --- |
| AI-1 | AI contracts and permission | `GeneratedEventDraft`, request and response schemas, fixtures, `ai.generate` permission in the matrix, regenerate | Contract tests pass; non-admin and other tenant denied in unit tests; `npm run check:generated` clean | M | backend | none |
| AI-2 | LLM and decision ports with adapters | `LlmPort` with the OpenAI adapter (structured output, moderation), `DecisionPort` with Jev and OpenAI mini adapters, secret wiring, fakes | Adapter unit tests with recorded responses; keys only from Secret Manager; no content in logs | M | backend | AI-1 |
| AI-3 | Idea context callable | `getEventIdeaContextV1` returning top and thin tags with suppression, theme, quota | Tests for suppression under 5, tenant scoping, disabled flag | S | backend | TAG-6, AI-1 |
| AI-4 | Draft generation callable | `generateEventDraftsV1` with screening, prompt build, validation, one retry, idempotent replay | Emulator tests with the fake LLM: valid drafts, invalid output retried then error, replay returns the same result, no quota spent on failure | L | backend | AI-2, AI-3 |
| AI-5 | Usage metering and caps | Monthly reservation and settle, per-admin daily cap, kill switches, audit entry | Concurrency test: parallel calls cannot exceed the cap; flag off blocks; audit record has no content | M | backend | AI-4 |
| AI-6 | Portal card flow | 4 card steps and prompt step, loading and error states, draft cards, "Open in editor" | Portal tests with mocks; keyboard and screen reader operable; nothing saved until the existing form is saved | L | admin | AI-3 |
| AI-7 | Prompt evaluation | 20-prompt eval set, generate models and triage providers compared, rubric and results written up | Written result in a session log with cost per generation and the chosen defaults | M | backend | AI-4 |
| AI-8 | Cover images phase 1 | Map `coverCategory` to the catalog and extend the catalog toward the theme art where useful | Every draft resolves to an approved cover; iOS shows it; tests for the mapping | S | backend | AI-1 |
| AI-9 | Stock or generated covers (optional) | Server step that stores an admin-picked Pexels or Imagen image and extends the accepted `coverImageURL` scheme | Contract owner approval recorded; old app builds still render a fallback; attribution stored; written permission on file | L | backend | AI-8 |
| AI-10 | Policy and rollout | Privacy page line, pilot company flag, quota defaults, runbook | Policy deployed before pilot; pilot checklist done; kill switch tested | S | infra | AI-5 |

## Sources

- OpenAI models: https://developers.openai.com/api/docs/models
- OpenAI pricing: https://developers.openai.com/api/docs/pricing
- OpenAI deprecations: https://developers.openai.com/api/docs/deprecations
- OpenAI model pages: https://developers.openai.com/api/docs/models/gpt-4o-mini, https://developers.openai.com/api/docs/models/gpt-4.1-mini, https://developers.openai.com/api/docs/models/gpt-5-nano
- OpenAI structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI moderation: https://developers.openai.com/api/docs/guides/moderation
- OpenAI reasoning: https://developers.openai.com/api/docs/guides/reasoning
- TypeSafe AI quickstart: https://docs.typesafe.ai/introduction/quickstart.md
- TypeSafe AI primitives (Choice, Score, Noul): https://docs.typesafe.ai/primitives
- TypeSafe AI confidence and thresholds: https://docs.typesafe.ai/confidence.md
- TypeSafe AI models and pricing: https://docs.typesafe.ai/go/models.md
- TypeSafe AI API reference: https://api.typesafe.ai/openapi.json, https://docs.typesafe.ai/go/api.md
- TypeSafe AI integration skill (read as reference data): https://raw.githubusercontent.com/typesafe-ai/skills/main/skills/typesafe-ai/SKILL.md
- Secrets in Functions: https://firebase.google.com/docs/functions/config-env
- Firebase AI Logic and Genkit: https://firebase.google.com/docs/ai-logic, https://genkit.dev/docs/get-started/, https://firebase.google.com/docs/functions/oncallgenkit
- Unsplash: https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines, https://unsplash.com/api-terms
- Pexels: https://www.pexels.com/api/documentation/, https://www.pexels.com/license/
- Pixabay: https://pixabay.com/api/docs/
- Openverse: https://docs.openverse.org/api/reference/made_with_ov.html
- Imagen pricing: https://cloud.google.com/vertex-ai/generative-ai/pricing (figures unconfirmed); Gemini API pricing: https://aistudio.google.com/docs/pricing
- Not verified: OpenAI and TypeSafe AI data retention and training terms, Jev rate limits for our organization, Pixabay license text, Pexels storage rights, Imagen ownership terms.


### Saved suggestions and credits (updated November 18, 2026)

| Tool | Credits |
| --- | --- |
| Refresh suggestions (Dipbot Suggest) | 1 (page visits are free when cached; the first-ever visit computes once) |

Visiting the Dipbot page never spends credits when a saved answer exists. A stale answer (new company data, or older than 7 days) is shown immediately with a quiet "Updated 3 days ago, new data available" line and a "Refresh, 1 credit" link; nothing runs on load. Every credit-costing action (first-ever load aside) starts from a deliberate press. The preference chips on the last step are ranked inside the same saved answer (see ops doc).
