# AI event ideas and prompt-to-event drafts (stretch S2)

Status: built November 17, 2026 (AI-1 to AI-6 and AI-8; AI-7 eval harness ready, live run pending; AI-9 deferred; AI-10 runbook written, pilot pending). Not deployed; needs the owner actions in the [AI events runbook](../../ops/ai-events.md). Part of the [V2 stretch goals](../../milestones/v2/STRETCH_GOALS.md). Depends on [tag interest counts](tag-interest-counts.md). Model names, prices and limits below were read from Anthropic's docs on November 16, 2026; re-check before building because they change.

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
- No AI or Anthropic code and no Anthropic secret exist. Functions: Node 22, `firebase-functions` v7, `firebase-admin` 14, region `us-central1`, App Check enforced outside the emulator.
- Weekly theme `Challenge` already carries a theme and default tag per week; ideas can optionally align to the current theme.

## Options considered

### Where the AI runs

| Option | Verdict |
| --- | --- |
| Admin portal calls Anthropic directly | Rejected: leaks the key, no per-company caps |
| Callable in Functions calling the Anthropic API (recommended) | Key in Secret Manager, per-company metering, aggregate data stays server-side, reuses auth and App Check |
| Firebase AI Logic | Rejected: client-SDK proxy for Gemini, not for Claude ([docs](https://firebase.google.com/docs/ai-logic)) |
| Genkit | Optional: tracing and a dev UI, adds a layer; plain SDK is enough for one call and one schema ([docs](https://genkit.dev/docs/get-started/)) |

### Model choice

Current lineup per the models page: Haiku 5.5 (`claude-haiku-5-5`, $0.10 / $0.50 per million input/output tokens up to 100K prompt tokens), Sonnet 5.5 (`claude-sonnet-5-5`, $2 / $10), Opus 5.5 (`claude-opus-5-5`, $4 / $20), Fable 5.2 (`claude-fable-5-2`, $8 / $40) ([models](https://platform.claude.com/docs/en/about-claude/models/overview), [pricing](https://platform.claude.com/docs/en/about-claude/pricing)).

**Default: Haiku 5.5 at low effort** for drafting and screening; **Sonnet 5.5** as a configurable "better drafts" tier if testing shows Haiku is too bland. Model id and effort are config params so they change without code edits. This is a judgment call, not a measured benchmark; evaluate with 20 sample prompts before choosing (AI-7).

Estimated cost of one 3-draft generation (assumptions: 2,500 input tokens, 2,000 output tokens, no web search, no caching): Haiku 5.5 about $0.001; Sonnet 5.5 about $0.025; thinking at medium effort adds about 4K output tokens (about $0.002 on Haiku, $0.04 on Sonnet). Web search would add $10 per 1,000 searches plus result tokens, so it is off in the first version. Even at 100 generations per company per month the cost is cents to a few dollars.

### Structured output

Use the stable structured outputs feature: `output_config.format = {type: "json_schema", schema}` through the TypeScript SDK `client.messages.parse()` with `zodOutputFormat()`; the parsed result is validated again by our own validator ([docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)). Constraints: every object needs `additionalProperties: false`, no recursion, and no numeric or string-length limits in the schema (the SDK moves them into descriptions), so **server-side validation is authoritative**. A new schema pays a one-time grammar compile delay; compiled grammars are cached 24 hours. Package: `@anthropic-ai/sdk` (helpers under `@anthropic-ai/sdk/helpers/zod`). Treat `stop_reason` of `refusal` or `max_tokens` as a clean error for the admin.

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

- System prompt (cached; stable, over the 512-token minimum for caching on these models): role (workplace social event planner), tone (friendly, inclusive, no medical claims, no alcohol-centric events unless the admin asks, accessibility aware), rules (use only provided tag ids, never invent venues, no personal names, no employee data, US spelling, output only the schema).
- User content: a JSON object with the enum choices, the aggregate interest list `[{tagId, name, bucket}]` (buckets such as `20+`, `10-19`, `5-9`), the weekly theme, today's date and the company's locale, and the admin's free text inside a clearly delimited, JSON-encoded field described in the system prompt as untrusted data, never instructions.
- No tools in the first version (no web search, no code). Effort low.
- Output: strict schema for 1 to 3 drafts. Server validation clamps lengths, drops unknown tag ids, maps `coverCategory` to the allow-list, and rejects empty or oversized fields; a failed validation retries once, then returns a friendly error without charging the quota.

### Safety and moderation

- Admin-only, human-in-the-loop: every draft is edited and saved by a person, and the output never auto-publishes. Anthropic's usage policy treats employment decisions as a high-risk area needing human review and bars tracking or scoring people without consent ([usage policy](https://www.anthropic.com/legal/aup)); event ideas are not employment decisions, and we send aggregates only.
- Pre-screen the admin's free text with a cheap Haiku call that returns a boolean verdict (structured), or a small allow-list check first, then generate. Treat a `refusal` stop as a flagged input. Repeat flags for a user are rate limited ([guardrails guidance](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks)).
- Output filter: reject drafts containing URLs, email addresses, phone numbers, or names of known members; strip markdown.
- Do not display model output as medical, legal or HR advice; the UI labels drafts "AI suggestion, review before publishing".

### Cost and rate controls

- `companies/{c}/aiUsage/{yyyymm}` document: in a transaction, reserve a worst-case cost before the call and reject when the reservation would pass the monthly cap; settle with actual `usage` tokens afterward. Per-admin daily cap (for example 20 generations). Global Anthropic workspace spend limit as a backstop (over the tier cap requests return 429 or 400 depending on the limit type, [rate limits](https://platform.claude.com/docs/en/api/rate-limits)).
- Start tier limits (Haiku and Sonnet 5.5): 4,000 requests per minute, so provider limits are not the constraint; our own metering is.
- Kill switch: server param `AI_EVENTS_ENABLED` (default false) and per-company `aiEventsEnabled` (server-owned, set by us). The portal hides the entry point when off.

### Data retention and secrets

- Anthropic does not retain prompts and outputs by default on Haiku and Sonnet 5.5 except where policy requires, and does not train on API data without permission; zero data retention is available by arrangement ([data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)). Confirm with the commercial terms before launch (UNVERIFIED).
- Key: `firebase functions:secrets:set ANTHROPIC_API_KEY`, `defineSecret`, read inside the handler only, redeploy functions after rotation ([config](https://firebase.google.com/docs/functions/config-env)).
- Logs: token counts, model id, quota, request id. Never the prompt, the admin's text or the output.

## Security and privacy

- Tenant isolation: company comes from the caller's server-owned membership; the client cannot supply counts or another company's id.
- App Check enforced; permission checked first; audit entry in `companies/{c}/auditLog` for each generation (who, when, tokens, not content).
- Aggregates only to the model, with small-cell suppression (under 5) so a thin tag cannot point at a person. No names, emails, departments or per-member data in prompts.
- Privacy policy: add that organizers may use an AI service to draft events from aggregated, anonymous interest counts; no personal data is sent. Add Anthropic as a processor if prompts contain any company-specific text (the admin's own words).
- Employee consent: aggregate interest counts are already visible to admins through member management, and the prompt carries only buckets, so no new consent is needed (confirm with the owner, question 5).

## Testing plan

- Unit: Zod schema and validator (every `EventDraft` rule, unknown tag, oversized text, forbidden patterns), choices enums, suppression buckets, quota reservation and settle, idempotent replay.
- Contract: fixtures for `GeneratedEventDraft` and both request types in `contracts/v1/fixtures`; `npm run check:generated` clean.
- Emulator: callable denies non-admin, other tenant, missing App Check path, over-quota; uses a fake LLM port (`LlmPort` with a canned structured response); no live API in CI.
- Live smoke (manual, small spend): 20 sample prompts, a rubric (valid, on theme, inclusive, no invented venue), compare Haiku and Sonnet, record results in the session log. Add an eval file under `gcp/tests/ai-eval` with the prompts (no secrets).
- Portal: flow tests with mock responses; accessibility of the card steps.

## Rollout and flags

Dark launch behind `AI_EVENTS_ENABLED` for our own company only, then a pilot company, then general. Quotas start low (for example 30 generations per company per month). Rollback: flag off; no data model depends on it except usage docs.

## Risks

Generic or repetitive drafts (mitigate with interests and the weekly theme in the prompt, evaluate tiers); prompt injection through the admin's text (data framing, no tools, schema-only output, human review); cost spikes (caps); image licensing (default catalog art); model name drift (config params); stale numbers in this doc.

## Decisions (November 17, 2026)

The owner questions below were not answered before building; these defaults were used and are easy to change.

| Question | Default built | Where to change |
| --- | --- | --- |
| 1. Who may use it | Admins only: permission `ai.generate` | `PERMISSION_MATRIX` in `gcp/functions/src/modules/admin/domain/permissions.ts` and `can` in `apps/admin/src/lib/adminTypes.ts` |
| 2. Budget | Per company: $5 per month (`AI_MONTHLY_BUDGET_CENTS=500`), 30 generations per month, 10 per admin per UTC day, 3 declined notes per admin per day; off unless both `AI_EVENTS_ENABLED=true` and `companies/{c}/aiSettings/current.enabled == true` | Environment of the functions; per-company overrides `monthlyBudgetCents`, `monthlyGenerationLimit`, `dailyGenerationLimit` in `aiSettings/current` |
| 3. Images | Catalog art only. The model picks a cover category, the server maps it to an approved `catalog://default/*` value, so `createEventV1` and old app builds are unchanged. AI-9 (stock or generated covers) is deferred | `domain/covers.ts` |
| 4. Weekly theme | Yes: the running theme's title and tags are in the prompt as data, with "fit it when it suits" | `domain/prompt.ts` |
| 5. Privacy notice | Only rounded buckets (`5-9`, `10-19`, `20+`) reach the model or the portal; tags under 5 members are named without counts. A privacy page line is proposed in the runbook and must ship before the pilot | [runbook](../../ops/ai-events.md) |
| 6. Web search | Off. No tools at all | `infrastructure/anthropicLlm.ts` |
| 7. Company time zone | Not needed: drafts carry a daypart and a duration; the admin picks the exact time in the event form | n/a |

Other build decisions:

- **Models.** Drafting uses `claude-sonnet-5-5` and screening uses `claude-haiku-5-5` (owner instruction; the doc's earlier Haiku-only suggestion is now the cheaper alternative to evaluate in AI-7). Both are environment values (`AI_GENERATE_MODEL`, `AI_SCREEN_MODEL`). Effort `low`, adaptive thinking (the default; it cannot be disabled on Sonnet 5.5), structured output through `output_config.format`, the stable system prompt cached, and the server-side refusal fallback (`fallbacks: "default"`) on the drafting call. Opus 5.5 is not used: the task is short and the drafts are reviewed by a person.
- **Flow.** Four card steps (interests, goal, group and setting, budget and timing) and a note step at `/admin/ideas/`; 1 to 3 drafts per run; "Open in editor" fills the normal event form (venue and time stay empty) and nothing is saved until the admin saves.
- **Screening.** A non-empty note is screened first with Haiku (verdicts ok, off_topic, unsafe, injection, personal_data); anything but ok, a refusal, or a refusal while drafting is a declined note (`AI_PROMPT_REJECTED`) and counts toward the daily flag limit. An unreadable verdict fails closed (`AI_UNAVAILABLE`). Links, emails and phone numbers in the note are rejected before any model call.
- **Metering.** The worst-case cost (screen plus two drafting attempts at `max_tokens`) is reserved in a transaction on `companies/{c}/aiUsage/{yyyymm}` before the call and settled with the real token cost afterward; only successful runs count as generations, but every call's cost is added to the monthly spend. Reservations expire after 5 minutes, so a crashed run cannot block the caps.
- **Idempotency.** `companies/{c}/aiRequests/{uid}_{requestId}` stores the drafts for 24 hours; a retry with the same request returns them (`replay: true`) without spending.
- **Interest counts.** Read through the tag-counts store (`modules/tags`, TAG-2) behind the AI `InterestSource` port; no counts yet means `interestDataAvailable: false` and the flow still works.

## Open questions for the owner

1. Who may use it: admin only (recommended) or organizers too?
2. Budget: monthly cap per company and an overall Anthropic spend limit?
3. Images: catalog art only for V2, or pursue Pexels storage permission and Imagen for covers?
4. Should the AI see the weekly theme and propose events that fit it?
5. Confirm aggregate interest counts in prompts need no extra employee notice. Should the privacy page mention AI?
6. Web search for venue or activity ideas: no for V2?
7. Where does the company time zone live (needed to turn dayparts into times)? None was found in the contracts.

## Work breakdown

| ID | Title | Scope | Acceptance | Est | Area | Depends |
| --- | --- | --- | --- | --- | --- | --- |
| AI-1 | AI contracts and permission | `GeneratedEventDraft`, request and response schemas, fixtures, `ai.generate` permission in the matrix, regenerate | Contract tests pass; non-admin and other tenant denied in unit tests; `npm run check:generated` clean | M | backend | none |
| AI-2 | LLM port and Anthropic adapter | `LlmPort`, Anthropic adapter with structured output, secret wiring, fake adapter | Adapter unit tests with recorded responses; key only from Secret Manager; no content in logs | M | backend | AI-1 |
| AI-3 | Idea context callable | `getEventIdeaContextV1` returning top and thin tags with suppression, theme, quota | Tests for suppression under 5, tenant scoping, disabled flag | S | backend | TAG-6, AI-1 |
| AI-4 | Draft generation callable | `generateEventDraftsV1` with screening, prompt build, validation, one retry, idempotent replay | Emulator tests with the fake LLM: valid drafts, invalid output retried then error, replay returns the same result, no quota spent on failure | L | backend | AI-2, AI-3 |
| AI-5 | Usage metering and caps | Monthly reservation and settle, per-admin daily cap, kill switches, audit entry | Concurrency test: parallel calls cannot exceed the cap; flag off blocks; audit record has no content | M | backend | AI-4 |
| AI-6 | Portal card flow | 4 card steps and prompt step, loading and error states, draft cards, "Open in editor" | Portal tests with mocks; keyboard and screen reader operable; nothing saved until the existing form is saved | L | admin | AI-3 |
| AI-7 | Prompt evaluation | 20-prompt eval set, Haiku vs Sonnet comparison, rubric and results written up | Written result in a session log with cost per generation and the chosen default tier | M | backend | AI-4 |
| AI-8 | Cover images phase 1 | Map `coverCategory` to the catalog and extend the catalog toward the theme art where useful | Every draft resolves to an approved cover; iOS shows it; tests for the mapping | S | backend | AI-1 |
| AI-9 | Stock or generated covers (optional) | Server step that stores an admin-picked Pexels or Imagen image and extends the accepted `coverImageURL` scheme | Contract owner approval recorded; old app builds still render a fallback; attribution stored; written permission on file | L | backend | AI-8 |
| AI-10 | Policy and rollout | Privacy page line, pilot company flag, quota defaults, runbook | Policy deployed before pilot; pilot checklist done; kill switch tested | S | infra | AI-5 |

## Sources

- Models overview and pricing: https://platform.claude.com/docs/en/about-claude/models/overview and https://platform.claude.com/docs/en/about-claude/pricing
- Structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Web search tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- Rate limits: https://platform.claude.com/docs/en/api/rate-limits
- Data retention: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
- Usage policy: https://www.anthropic.com/legal/aup
- Prompt injection guidance: https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks
- Secrets in Functions: https://firebase.google.com/docs/functions/config-env
- Firebase AI Logic and Genkit: https://firebase.google.com/docs/ai-logic, https://genkit.dev/docs/get-started/, https://firebase.google.com/docs/functions/oncallgenkit
- Unsplash: https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines, https://unsplash.com/api-terms
- Pexels: https://www.pexels.com/api/documentation/, https://www.pexels.com/license/
- Pixabay: https://pixabay.com/api/docs/
- Openverse: https://docs.openverse.org/api/reference/made_with_ov.html
- Imagen pricing: https://cloud.google.com/vertex-ai/generative-ai/pricing (figures unconfirmed); Gemini API pricing: https://aistudio.google.com/docs/pricing
- Not verified: thinking-off behavior on current models, structured output combined with web search, Pixabay license text, Pexels storage rights, Imagen ownership terms, commercial terms comparison.
