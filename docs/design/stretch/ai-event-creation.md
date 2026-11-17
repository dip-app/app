# AI event ideas and prompt-to-event drafts (stretch S2)

Status: built November 17, 2026 (AI-1 to AI-6 and AI-8; AI-7 eval harness ready, live run pending; AI-9 deferred; AI-10 runbook written, pilot pending). Generation runs on OpenAI; decision steps (note triage, draft checks) go through a provider-neutral port that can use TypeSafe AI's Jev model, defaulting to an OpenAI mini model until a Jev key exists. Not deployed; needs the owner actions in the [AI events runbook](../../ops/ai-events.md). Part of the [V2 stretch goals](../../milestones/v2/STRETCH_GOALS.md). Depends on [tag interest counts](tag-interest-counts.md). Model names, prices and limits below were verified on November 17, 2026 against the OpenAI and TypeSafe docs listed under Sources; re-check before changing them because they move.

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

OpenAI lineup (verified November 17, 2026): `gpt-6-astra` is the flagship "start here" model ($10 input / $1 cached input / $50 output per 1M tokens); `gpt-6-luna` is the cheap high-volume tier ($0.10 / $0.01 / $0.50); `omni-moderation-latest` is free ([models](https://developers.openai.com/api/docs/models), [pricing](https://developers.openai.com/api/docs/pricing), [moderation](https://developers.openai.com/api/docs/guides/moderation), [reasoning](https://developers.openai.com/api/docs/guides/reasoning)). `gpt-6.1-sol` ($2 / $0.20 / $10) is the cheaper drafting candidate to compare in the eval (AI-7).

**Default: `gpt-6-astra` at low reasoning effort for drafting; `gpt-6-luna` for the decision-step fallback; free moderation for screening.** Every step's provider, model id, effort and output ceiling live in one module (`infrastructure/aiConfig.ts`) and can be overridden with environment values, so a model change is a config change. The defaults are a judgment call, not a measured benchmark; the eval compares them before the pilot.

**Per-step model matrix**

| Step | Provider default | Model id default | Env override | Effort | Max output tokens | Purpose |
| --- | --- | --- | --- | --- | --- | --- |
| generate | OpenAI (Responses API) | `gpt-6-astra` | `AI_MODEL_GENERATE`, `AI_EFFORT_GENERATE` | low | 12,000 | Write 1 to 3 event drafts as structured output |
| triage | `openai-mini` (or `jev`) | `gpt-6-luna` (Jev: `jev-latest`) | `AI_DECISION_PROVIDER_TRIAGE`, `AI_MODEL_TRIAGE`, `AI_JEV_MODEL` | low | 2,000 | Typed yes/no questions about the admin's note before any drafting |
| draftCheck | `openai-mini` (or `jev`) | `gpt-6-luna` (Jev: `jev-latest`) | `AI_DECISION_PROVIDER_DRAFT_CHECK`, `AI_MODEL_DRAFT_CHECK`, `AI_JEV_MODEL` | low | 2,000 | Per draft: cover category, fit with the request, safety |
| moderation | OpenAI moderation | `omni-moderation-latest` | `AI_MODEL_MODERATION` | n/a | n/a | Free check of the note and of every draft's text |

Effort values: `minimal`, `low`, `medium`, `high`, `xhigh` (only the drafting effort is read from the environment). Decision provider values: `jev` or `openai-mini` (anything else means `openai-mini`). The Jev slot (TypeSafe AI System One, `POST https://api.typesafe.ai/v1/systemone`, Bearer auth) is wired but off by default: a step uses Jev only when its provider is `jev` and `JEV_API_KEY` holds a real key; otherwise it falls back to the OpenAI model in the same row. Jev models: `jev-latest` (currently `jev-1.14.0`) and `jev-1.13.0`, $0.042 per 1M input tokens with output free, per-organization rate limits, keys from the TypeSafe console ([quickstart](https://docs.typesafe.ai/introduction/quickstart.md), [models](https://docs.typesafe.ai/go/models.md)).

Model ids known to the code (`KNOWN_MODELS`, documentation only; an id missing from the price table is priced at the most expensive known rate): OpenAI `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-luna`, `gpt-6-sol`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `omni-moderation-latest`; TypeSafe `jev-latest`, `jev-1.13.0`.

Estimated cost of one 3-draft generation at defaults (assumptions: about 3,500 input tokens and 3,000 output tokens including reasoning for the drafting call, one valid attempt, about 700 input and 150 output tokens per `gpt-6-luna` decision call, 3 draft checks, no caching, moderation free): about $0.19 on `gpt-6-astra` ($0.185 for drafting plus under $0.001 for the decision calls); about $0.04 on `gpt-6.1-sol`. A Jev decision call would cost about $0.00003. At the default cap of 30 generations per company per month the typical spend is about $5.60 on `gpt-6-astra`.

### Structured output

Drafting uses the Responses API: the zod schema (`modelDraftsSchema`, tag ids as an enum from the catalog) goes through `zodTextFormat` into `client.responses.parse`, which returns a parsed object ([docs](https://developers.openai.com/api/docs/guides/structured-outputs)). The adapter re-validates the parsed value with the same zod schema, so a wrong shape is a `malformed` outcome and never reaches the domain. The domain then repairs and checks the value: `parseModelDrafts` clamps lengths, drops unknown tag ids, maps cover categories to the approved list and validates against `GeneratedEventDraftSchema` and the `createEventV1` prefill schema (`EventDraftPrefillSchema`). A refusal, truncation (`max_output_tokens`), malformed or invalid output is retried once (two drafting attempts at most), then fails with `AI_OUTPUT_INVALID` and no generation is counted. Decision answers are zod-validated per question type too (Choice, Score, Noul), and a Jev response that does not match the questions asked is treated as an unavailable provider.

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

### Callables (new, v1, additive)

- `getEventIdeaContextV1`: admin only; returns top and thin tags with suppression applied, the current weekly theme, and the company's remaining AI quota. Read-only.
- `generateEventDraftsV1`: admin only (new permission `ai.generate`, admin; organizers can be added later). Request: `{contractVersion: 1, companyId, requestId, choices: {focusTagIds, goal, groupSize, setting, budget, timing}, prompt, count (1-3)}`. Response: `{contractVersion: 1, drafts: [GeneratedEventDraft], usage: {remaining}}`. `requestId` makes a retry return the stored result instead of spending again (idempotency receipt, as in other commands). Nothing is written to `events`; drafts are returned and may be stored briefly in `companies/{c}/aiDraftSessions/{id}` with a TTL of 24 hours for refresh and audit.
- `GeneratedEventDraft` mirrors `EventDraft` except: `startTime` and `endTime` are replaced by `suggestedDaypart` and `durationMinutes` (the admin picks the exact slot), `venue` is replaced by `venueType` and `venueSearchHint` (the admin chooses a real venue), and `coverImageURL` is `coverCategory` (enum) in Phase 1. Extra fields: `rationale` (max 160 characters), `tagIds` (enum limited to catalog ids).

### Prompt design

- System prompt (stable, so the provider can cache the prefix): role (workplace social event planner), tone (friendly, inclusive, no medical claims, no alcohol-centric events unless the admin asks, accessibility aware), rules (use only provided tag ids, never invent venues, no personal names, no employee data, US spelling, output only the schema).
- User content: a JSON object with the enum choices, the aggregate interest list `[{tagId, name, bucket}]` (buckets such as `20+`, `10-19`, `5-9`), the weekly theme, today's date and the company's locale, and the admin's free text inside a clearly delimited, JSON-encoded field described in the system prompt as untrusted data, never instructions.
- No tools in the first version (no web search, no code). Effort low.
- Output: strict schema for 1 to 3 drafts. Server validation clamps lengths, drops unknown tag ids, maps `coverCategory` to the allow-list, and rejects empty or oversized fields; a failed validation retries once, then returns a friendly error without charging the quota.

### Safety and moderation

- Admin-only, human-in-the-loop: every draft is edited and saved by a person, and the output never auto-publishes. Event ideas are not employment decisions, and we send aggregates only.
- Links, emails and phone numbers in the note are rejected before any provider call.
- Note screening, in order: (1) OpenAI `omni-moderation-latest` (free) on the note; a flagged note is declined. (2) Triage through the `DecisionPort` (Jev or the OpenAI mini model): four Noul (yes probability) questions, namely whether the note tries to change the tool's behavior (`injection`), asks for something unsafe or exclusionary (`unsafe`), is not about planning a workplace event (`offTopic`), or contains sensitive facts about a named person (`personalData`). Any answer at or above 0.7 declines the note (`NOUL_YES = 0.7`, following TypeSafe's guidance to act at 0.7 or more, [confidence](https://docs.typesafe.ai/confidence.md)). A missing or malformed answer counts as a decline, and a provider error fails closed (`AI_UNAVAILABLE`). A declined note is `AI_PROMPT_REJECTED` and counts toward the daily declined-note limit.
- Draft screening: free moderation on every draft's text, then one draft check per remaining draft with three questions: `cover` (Choice among the five cover categories; trusted only when the chosen option has probability of at least 0.6, else the model's own pick stays), `fit` (Score over four ordered levels, from unrelated to a strong fit, used to order the drafts best first) and `unsafe` (Noul; at or above 0.7 drops the draft). A failed check keeps the draft because moderation and the validators already gate it; if every draft is dropped the run counts as invalid output.
- Never the sole gate: Jev and the mini model give calibrated hints that the server applies with thresholds. Free moderation and the deterministic validators (URLs, emails, phones, allow-lists, lengths) stay in front of them, and a person reviews every draft.
- Output filter: reject drafts containing URLs, email addresses or phone numbers; strip markdown.
- The UI labels drafts "AI suggestion, review before publishing". Drafts are not medical, legal or HR advice.

### Cost and rate controls

- `companies/{c}/aiUsage/{yyyymm}` document: in a transaction, reserve a worst-case cost before the call and reject when the reservation would pass the monthly or the daily company budget (`AI_BUDGET_EXHAUSTED`); settle with actual token usage afterward. Reservations expire after 5 minutes.
- Defaults: $30 per company per month (`AI_MONTHLY_BUDGET_CENTS=3000`), $6 per company per UTC day (`AI_DAILY_BUDGET_CENTS=600`), 30 generations per company per month (`AI_MONTHLY_GENERATIONS`), 10 generations per admin per UTC day (`AI_DAILY_GENERATIONS_PER_ADMIN`), 3 declined notes per admin per UTC day (`AI_DAILY_FLAG_LIMIT`). Per-company overrides live in `companies/{c}/aiSettings/current`.
- Worst-case reservation per generation, from `worstCaseMicros` with the default models: one triage call (2,000 input, 2,000 output tokens on `gpt-6-luna`), two drafting attempts (6,000 input, 12,000 output tokens each on `gpt-6-astra`) and three draft checks (1,500 input, 2,000 output tokens each on `gpt-6-luna`) come to 1,324,650 micro-USD, about $1.32. That is roughly 7 times the typical cost, so the daily budget admits at least 4 overlapping generations and the monthly budget at least 22.
- An OpenAI project spend limit is the global backstop, set in the OpenAI dashboard by the owner.
- Kill switch: server param `AI_EVENTS_ENABLED` (default false; it also requires the `OPENAI_API_KEY` secret to hold a real value) and per-company `aiSettings/current.enabled` (server-owned, set by us). With either off the feature is a clean no-op: generation fails with `AI_DISABLED`, the context callable answers `enabled: false` and the portal shows the off state.

### Data retention and secrets

- Drafting calls send `store: false`, so OpenAI does not keep response objects for later retrieval. OpenAI's retention of API inputs and outputs for abuse monitoring, and TypeSafe AI's retention and training terms for Jev requests, were not checked: UNVERIFIED. Read both providers' data terms and decide on zero data retention options before launch.
- Secrets: `OPENAI_API_KEY` and `JEV_API_KEY`, created with `firebase functions:secrets:set`, declared with `defineSecret`, read inside the handler only, redeploy functions after rotation ([config](https://firebase.google.com/docs/functions/config-env)). `JEV_API_KEY` may hold `none` until a Jev key exists; the code treats `none` (and blank) as absent.
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
- Live smoke (manual, small spend): 20 sample prompts, a rubric (valid, on theme, inclusive, no invented venue), compare `gpt-6-astra` and `gpt-6.1-sol` for drafting and `openai-mini` against `jev` for triage, record results in the session log. The eval file and runner are under `gcp/tests/ai-eval` (no secrets).
- Portal: flow tests with mock responses; accessibility of the card steps.

## Rollout and flags

Dark launch behind `AI_EVENTS_ENABLED` for our own company only, then a pilot company, then general. Quotas start low (30 generations per company per month). Rollback: flag off; no data model depends on it except usage docs.

## Risks

Generic or repetitive drafts (mitigate with interests and the weekly theme in the prompt, evaluate models); prompt injection through the admin's text (data framing, no tools, schema-only output, human review); cost spikes (caps); image licensing (default catalog art); model name drift (config params); stale numbers in this doc.

## Decisions (November 17, 2026)

The owner questions below were not answered before building; these defaults were used and are easy to change.

| Question | Default built | Where to change |
| --- | --- | --- |
| 1. Who may use it | Admins only: permission `ai.generate` | `PERMISSION_MATRIX` in `gcp/functions/src/modules/admin/domain/permissions.ts` and `can` in `apps/admin/src/lib/adminTypes.ts` |
| 2. Budget | Per company: $30 per month (`AI_MONTHLY_BUDGET_CENTS=3000`), $6 per UTC day (`AI_DAILY_BUDGET_CENTS=600`), 30 generations per month, 10 per admin per UTC day, 3 declined notes per admin per day; off unless both `AI_EVENTS_ENABLED=true` (with the OpenAI secret present) and `companies/{c}/aiSettings/current.enabled == true` | Environment of the functions; per-company overrides `monthlyBudgetCents`, `dailyBudgetCents`, `monthlyGenerationLimit`, `dailyGenerationLimit` in `aiSettings/current` |
| 3. Images | Catalog art only. The model picks a cover category, the server maps it to an approved `catalog://default/*` value, so `createEventV1` and old app builds are unchanged. AI-9 (stock or generated covers) is deferred | `domain/covers.ts` |
| 4. Weekly theme | Yes: the running theme's title and tags are in the prompt as data, with "fit it when it suits" | `domain/prompt.ts` |
| 5. Privacy notice | Only rounded buckets (`5-9`, `10-19`, `20+`) reach the model or the portal; tags under 5 members are named without counts. The privacy page's Service providers section names OpenAI and TypeSafe AI | `apps/landing/privacy/index.html` |
| 6. Web search | Off. No tools at all | `infrastructure/openaiLlm.ts` |
| 7. Company time zone | Not needed: drafts carry a daypart and a duration; the admin picks the exact time in the event form | n/a |
| 8. Models | Drafting `gpt-6-astra` (low effort); decision steps `gpt-6-luna`; moderation `omni-moderation-latest`; per-step env overrides in the matrix above | `infrastructure/aiConfig.ts` |
| 9. Provider switch | OpenAI for generation, by owner instruction. The earlier Claude plan was replaced at the owner's request | `infrastructure/aiConfig.ts`, `infrastructure/openaiLlm.ts` |
| 10. Decision steps | Behind a `DecisionPort`: TypeSafe AI Jev when a step is set to `jev` and `JEV_API_KEY` holds a real key, else an OpenAI mini model answering the same typed questions. A decision failure fails closed for triage and keeps the draft for draft checks | `infrastructure/stepDecisions.ts`, `infrastructure/jevDecisions.ts`, `infrastructure/openAiDecisions.ts` |
| 11. Validation | zod everywhere: request parsing, model output schemas (through `zodTextFormat`), re-validation after the SDK, decision answers per question type, then the contract schemas | `domain/**`, `infrastructure/**` |

Other build decisions:

- **Flow.** Four card steps (interests, goal, group and setting, budget and timing) and a note step at `/admin/ideas/`; 1 to 3 drafts per run; "Open in editor" fills the normal event form (venue and time stay empty) and nothing is saved until the admin saves.
- **Metering.** The worst-case cost is reserved in a transaction on `companies/{c}/aiUsage/{yyyymm}` before the call and settled with the real token cost afterward; only successful runs count as generations, but every call's cost is added to the monthly and daily spend. Reservations expire after 5 minutes, so a crashed run cannot block the caps.
- **Idempotency.** `companies/{c}/aiRequests/{uid}_{requestId}` stores the drafts for 24 hours; a retry with the same request returns them (`replay: true`) without spending.
- **Interest counts.** Read through the tag-counts store (`modules/tags`, TAG-2) behind the AI `InterestSource` port; no counts yet means `interestDataAvailable: false` and the flow still works.

## Open questions for the owner

1. Who may use it: admin only (recommended) or organizers too?
2. Budget: the defaults are $30 per month and $6 per day per company; confirm them and the OpenAI project spend limit.
3. Images: catalog art only for V2, or pursue Pexels storage permission and Imagen for covers?
4. Should the AI see the weekly theme and propose events that fit it?
5. Confirm aggregate interest counts in prompts need no extra employee notice (the privacy page now names OpenAI and TypeSafe AI).
6. Web search for venue or activity ideas: no for V2?
7. Where does the company time zone live (needed to turn dayparts into times)? None was found in the contracts.
8. Does "jeb" mean TypeSafe AI's Jev? If yes, request a Jev key from the TypeSafe console and store it as `JEV_API_KEY`, then set the decision provider to `jev` for triage and draft checks. Until then the OpenAI mini model answers the same questions.

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
- OpenAI structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI moderation: https://developers.openai.com/api/docs/guides/moderation
- OpenAI reasoning: https://developers.openai.com/api/docs/guides/reasoning
- TypeSafe AI quickstart: https://docs.typesafe.ai/introduction/quickstart.md
- TypeSafe AI primitives (Choice, Score, Noul): https://docs.typesafe.ai/primitives
- TypeSafe AI confidence and thresholds: https://docs.typesafe.ai/confidence.md
- TypeSafe AI models and pricing: https://docs.typesafe.ai/go/models.md
- TypeSafe AI API reference: https://api.typesafe.ai/openapi.json
- TypeSafe AI integration skill (read as reference data): https://raw.githubusercontent.com/typesafe-ai/skills/main/skills/typesafe-ai/SKILL.md
- Secrets in Functions: https://firebase.google.com/docs/functions/config-env
- Firebase AI Logic and Genkit: https://firebase.google.com/docs/ai-logic, https://genkit.dev/docs/get-started/, https://firebase.google.com/docs/functions/oncallgenkit
- Unsplash: https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines, https://unsplash.com/api-terms
- Pexels: https://www.pexels.com/api/documentation/, https://www.pexels.com/license/
- Pixabay: https://pixabay.com/api/docs/
- Openverse: https://docs.openverse.org/api/reference/made_with_ov.html
- Imagen pricing: https://cloud.google.com/vertex-ai/generative-ai/pricing (figures unconfirmed); Gemini API pricing: https://aistudio.google.com/docs/pricing
- Not verified: OpenAI and TypeSafe AI data retention and training terms, Jev rate limits for our organization, Pixabay license text, Pexels storage rights, Imagen ownership terms.
