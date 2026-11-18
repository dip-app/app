# AI event ideas: owner actions, rollout and kill switches

Runbook for the AI event drafts feature (stretch S2, [design](../design/stretch/ai-event-creation.md)). Nothing here has been run. Deploying is a human action ([deploy runbook](deploy-runbook.md)).

## What ships in the code

- Callables `getEventIdeaContextV1` and `generateEventDraftsV1` (`gcp/functions/src/modules/ai`), admin only (`ai.generate`), App Check enforced outside the emulator. Contract: [admin contract](../contracts/admin.md#ai-event-drafts-aigenerate-admin-only).
- Drafts are written by a cheap, older OpenAI model, `gpt-4o-mini` (Responses API, strict structured output, temperature 0.3, `store: false`). Free OpenAI moderation and typed decision questions (note triage, draft checks) screen the note and the drafts. The decision questions go to TypeSafe AI's Jev model by default whenever `JEV_API_KEY` holds a real value; if Jev has no key or a Jev call fails, `gpt-4o-mini` answers the same questions, and if that fails too, deterministic keyword rules answer (free, last resort). Which provider answered is logged (`decisionProviders`) and stored on the request document.
- Portal page `/admin/ideas/` ("Event ideas" in the sidebar, admins only).
- Off by default twice: the deployment switch `AI_EVENTS_ENABLED` is false unless set, and each company must also have `companies/{companyId}/aiSettings/current` with `enabled: true`.

## Owner actions before the first real call

1. **OpenAI key.** Create a key in a dedicated OpenAI project for DIP, set a project spend limit there (for example $10 per month; the defaults spend cents per company per month) as the global backstop, then store the key only in Secret Manager:
   `firebase functions:secrets:set OPENAI_API_KEY --project team05-dip`
   Never commit it, paste it in chat, or put it in `.env` files. Rotating it: set a new version, then redeploy both AI functions.
2. **Jev key.** Jev is TypeSafe AI's decision model and the default provider for every decision step. The key is already in `dip-app/secrets` (`backend/functions.enc.env`); push it with `scripts/secrets/sync-gcp.sh` ([secrets runbook](secrets.md)) or set it by hand:
   `firebase functions:secrets:set JEV_API_KEY --project team05-dip`
   With a real key nothing else is needed: `AI_DECISION_PROVIDER_TRIAGE` and `AI_DECISION_PROVIDER_DRAFT_CHECK` default to `jev`. Set one of them to `openai-mini` to force the OpenAI model for that step. A value of `none` (or blank) turns Jev off and the OpenAI model answers.
3. **Budget and models.** Change defaults with environment values in `gcp/functions/.env.team05-dip` (not secret):

   | Name | Default | Meaning |
   | --- | --- | --- |
   | `AI_EVENTS_ENABLED` | unset (off) | Deployment switch; must be `true` |
   | `AI_PROVIDER` | `openai` (`demo` in the emulator) | `demo` uses offline fakes and needs no key; it is honored only in the Functions emulator, elsewhere the feature stays off and `ai.demo_refused` is logged |
   | `AI_MONTHLY_BUDGET_CENTS` | 200 | Company spend cap per UTC month ($2) |
   | `AI_DAILY_BUDGET_CENTS` | 50 | Company spend cap per UTC day ($0.50) |
   | `AI_MONTHLY_GENERATIONS` | 30 | Generations per company per month |
   | `AI_DAILY_GENERATIONS_PER_ADMIN` | 10 | Generations per admin per UTC day |
   | `AI_DAILY_FLAG_LIMIT` | 3 | Declined notes per admin per UTC day |
   | `AI_DAILY_ATTEMPTS_PER_ADMIN` | 20 | Every reservation per admin per UTC day, failed runs included (error `AI_DAILY_LIMIT`) |
   | `AI_PLATFORM_MONTHLY_BUDGET_CENTS` | 20000 | Spend ceiling per UTC month across all companies (`aiUsagePlatform/{yyyymm}`); refused as `AI_BUDGET_EXHAUSTED` |
   | `AI_MODEL_GENERATE` | `gpt-4o-mini` | Drafting model (deprecated by OpenAI, shuts down January 14, 2027; see below) |
   | `AI_EFFORT_GENERATE` | `low` | Only sent to reasoning models (gpt-5 and later): `minimal`, `low`, `medium`, `high` or `xhigh` |
   | `AI_MODEL_TRIAGE` | `gpt-4o-mini` | OpenAI model for note triage (the Jev fallback) |
   | `AI_MODEL_DRAFT_CHECK` | `gpt-4o-mini` | OpenAI model for draft checks (the Jev fallback) |
   | `AI_DECISION_PROVIDER_TRIAGE` | `jev` | `jev` (used when the Jev key is real) or `openai-mini` |
   | `AI_DECISION_PROVIDER_DRAFT_CHECK` | `jev` | `jev` (used when the Jev key is real) or `openai-mini` |
   | `AI_JEV_MODEL` | `jev-latest` | `jev-latest` (currently `jev-1.14.0`) or `jev-1.13.0` |
   | `AI_MODEL_MODERATION` | `omni-moderation-latest` | Free moderation model |

   One 3-draft generation costs about $0.001 at the defaults (measured in the live eval, see the design doc); the reserved worst case is $0.0077 (7,680 micro-USD). The feature only turns on when `AI_EVENTS_ENABLED=true` and the `OPENAI_API_KEY` secret holds a real value.

   **Model shutdown.** OpenAI lists `gpt-4o-mini` and `gpt-4.1-mini` as deprecated with a shutdown on January 14, 2027 (`gpt-4.1-nano` was already shut down on October 23, 2026; `gpt-5-nano` shuts down December 11, 2026). Before January 14, 2027 set `AI_MODEL_GENERATE`, `AI_MODEL_TRIAGE` and `AI_MODEL_DRAFT_CHECK` to a model that is still listed (OpenAI's suggested replacement is `gpt-6-luna`, $0.10 / $0.50 per 1M tokens; it is a reasoning model, so the code switches to the reasoning parameters and larger output ceilings automatically). Check [deprecations](https://developers.openai.com/api/docs/deprecations) first.
4. **Evaluation (AI-7).** Done once on November 17, 2026 with the cheap defaults (`gpt-4o-mini` drafting, Jev decisions compared with `gpt-4o-mini`); aggregate results are in the design doc under Evaluation. The harness refuses a second live run (lock file in the git-ignored results directory) and caps spend at $1. Re-run only after a deliberate prompt or model change.
5. **Data terms.** Read OpenAI's and TypeSafe AI's data retention and training terms for API use before the pilot (UNVERIFIED in the design doc). Drafting calls already send `store: false`.
6. **Privacy page.** The Service providers section of `apps/landing/privacy/index.html` names OpenAI and TypeSafe AI for AI event ideas. Deploy it before the pilot.

## Dipbot credits (internal)

Admins never see money for AI. The portal shows **credits**: a fixed price per tool, a monthly allowance per company, a meter ("Credits: 412 of 500 this month", reset date in the tooltip), a low state under 20% and an out-of-credits state that disables only the paid actions (choices and note are kept). Dollar figures, models and token counts stay on the server and in this document. The dollar budget guard below is unchanged and still the safety net (platform ceiling, per-company monthly and daily caps); credits sit in front of it and are never derived from it.

**Price table** (`gcp/functions/src/modules/ai/domain/credits.ts`, one row per tool; the contract carries the prices as `creditCost` so the UI never hard-codes them):

| Tool | Credits | Charged | Rationale (internal) |
| --- | --- | --- | --- |
| Refresh suggestions (Dipbot Suggest, `getEventIdeaSuggestionsV1`) | 1 | Only when a model (Jev or OpenAI) answered, on the very first visit (nothing saved yet) or an explicit Refresh. Page visits are free while a saved answer exists; heuristic answers and failures are free | One decision call answers every step and ranks the preference chips, about $0.0005 with Jev. The answer is saved once per company and shared by all admins |
| Generate drafts (3 drafts with all checks) | 10 | At the start, once the request passed validation and the switches; refunded when no draft is produced (declined note, provider failure, invalid output) | About $0.001 typical, $0.0098 worst case. Priced for the value of a result, not the cost, so a cheap model change does not change what admins see |
| Regenerate | 10 | Same as generate (it is a fresh generation) | Same work as generate |
| Weekly suggested-events email | 3 | Once per company run when a model ranked the ideas (not per admin, not for the heuristic fallback, not on a re-run of the same week) | One ranking run, about $0.0005 with Jev; a small flat price |
| Let Dipbot choose (cover picker, `pickEventCoverV1`) | 1 | Before the model call, idempotent by `requestId`; refunded when AI is off or no model answered (outage, timeout, lexical fallback by the heuristic provider). A model answer that ends on the text match still counts as answered | One decision call (two above 60 covers), about $0.0005 with Jev. Covers Dipbot picks for generated drafts are free: they ride on the per-draft draftCheck call already inside the 10-credit generation |

**Allowance.** Default 500 credits a month (about 50 draft generations, or one a day). Override per company with `monthlyCredits` (a whole number, 0 allowed) in the server-only `companies/{c}/aiSettings/current` document, for example `{ enabled: true, monthlyCredits: 1500 }`. Nothing else changes with it. Do this in the console or an Admin SDK script; clients cannot write it.

**Reset.** The allowance resets at the start of the calendar month in the company's time zone (`emailSettings/{companyId}.timeZone`, UTC when unset or invalid). The ledger is `companies/{c}/aiCredits/{yyyymm}` (`used` and a `charges` map keyed by request, so a repeated request is charged once and a failed run refunded exactly once). It is a separate document from `aiUsage/{yyyymm}` because the credit month follows the company's zone while the cost month is UTC. Charging and refunding are transactions on the ledger, so parallel requests cannot overspend.

**Exhaustion.** `generateEventDraftsV1` fails with `resource-exhausted` and reason `AI_CREDITS_EXHAUSTED` (details: `creditsRemaining`, `resetsAt`), before any model call. Dipbot Suggest never auto-runs without credits: it answers from the saved company suggestions or the free heuristic (an explicit refresh without credits fails with `AI_CREDITS_EXHAUSTED`). `pickEventCoverV1` fails with the same `AI_CREDITS_EXHAUSTED` before any model call (the cover picker keeps its search and filters). The weekly email falls back to the heuristic ranking. A run that was charged but crashed before settling is refunded when the same `requestId` is retried (the stale reservation expires after 7 minutes).

**How credits map to internal cost, for budgeting.** At the default models and with Jev answering the decision steps, 500 credits is about 50 generations plus a few hundred panel visits: roughly $0.05 to $0.10 of provider spend per company per month at typical use, and about $0.50 if every credit were spent on generations at the worst-case reservation. The company cost caps (`AI_MONTHLY_BUDGET_CENTS`, default 200) and the platform ceiling therefore bind long before the allowance does. If a model override makes generations 10x more expensive, keep the credit prices and lower `AI_MONTHLY_BUDGET_CENTS` or raise the price of the row, whichever you prefer. Logs (`ai.generate`, `ai.suggest`) carry both the credits and the internal cost for reconciliation; the audit log shown to admins carries credits only.

## Feature off (clean no-op)

If `AI_EVENTS_ENABLED` is not `true`, or `OPENAI_API_KEY` is missing, blank or `none`, the feature is disabled without errors in the logs: `generateEventDraftsV1` returns `AI_DISABLED`, `getEventIdeaContextV1` returns `enabled: false`, and the portal shows the off state. The same happens when the company document has no `enabled: true`.

## Deploy notes for the coordinator

- Functions: `getEventIdeaContextV1` and `generateEventDraftsV1` (`us-central1`; the second has a 300 s timeout and 512 MiB). Both bind the `OPENAI_API_KEY` and `JEV_API_KEY` secrets (the context callable reads the Jev key so its reserved worst case matches the generator's). Both secrets must exist (a `none` value for the Jev key is fine) before these functions can deploy; deploy the rest with `--only functions:<names>` if the keys are not ready.
- Firestore TTL policies (console or `gcloud firestore fields ttls update`): `expireAt` on collection group `aiRequests` (24 hours) and `aiUsageDaily` (8 days). Without them the documents stay; nothing breaks.
- No rules or index changes: every AI document is server-only and falls through to the deny-all rule (tested in `gcp/tests/rules/ai.test.ts`).
- Admin portal: rebuild and deploy hosting as usual; the page reads only the AI callables.
- Dipbot Suggest: `getEventIdeaSuggestionsV1` (`us-central1`, 60 s) binds both secrets. Provider order: Jev when `JEV_API_KEY` holds a real key, then the OpenAI triage model (`AI_MODEL_TRIAGE`), then a deterministic heuristic. **Saved company suggestions:** the answer (per-step suggestions, ranked preference chips, provider, input fingerprint, `computedAt`) lives in the server-only document `companies/{c}/aiCache/suggestions` and is shared by every admin. A visit with a saved answer costs 0 credits and makes no model call; it returns `cacheStatus` `fresh` (fingerprint unchanged, younger than 7 days, `AI_SUGGESTION_CACHE_DAYS` to change) or `stale` (`staleReason` `data` or `age`, shown as is, nothing recomputed). The model runs and 1 credit is charged only for the first-ever visit (no document, credits left, budget ok) or `refresh: true` (needs a `requestId`; idempotent per `requestId`; refused with `AI_CREDITS_EXHAUSTED` when out of credits). Exhausted credits never auto-run: the saved answer, or the free heuristic (not saved) on a first visit. A failed refresh (no model answered) charges nothing and keeps the saved answer. Concurrency: a lease (`leaseHolder`, `leaseUntil`, 90 s) on the cache document makes concurrent first visits or refreshes share one run and one credit; a crashed holder is taken over after the lease expires. The fingerprint hashes the interest buckets as the model sees them, the weekly theme, recent-event stats (count bucket and leading budget, timing, size, indoor/outdoor, top tags), the largest interest count bucket (a lower bound of members who picked interests), the option catalog, the consideration catalog version and an algorithm version. Its cost is added to the month, day and platform spend (never to the generation counts), and the call is skipped (heuristic) when the budget left cannot cover it. No TTL policy is needed (one document per company, overwritten); the old per-visit `aiSuggestions` collection is no longer written and its existing TTL policy can stay until its documents expire. The weekly email keeps its own ranking and budget key unchanged. Logs carry provider, model, tokens, cost, `cacheStatus` and `creditsCharged` only.
- Dipbot covers: `pickEventCoverV1` (`us-central1`, 60 s) binds both secrets and uses the `coverPick` decision step (Jev, then the OpenAI model, then heuristics; override with `AI_DECISION_PROVIDER_COVER_PICK` and `AI_MODEL_COVER_PICK`). It asks the model only when `AI_EVENTS_ENABLED` is `true` and otherwise answers with the deterministic text match. It charges 1 Dipbot credit per pick that a model answered (see the price table); its dollar spend is not metered against the generation budget; the burst limiter and admin-only access bound it. Add a Firestore TTL policy on `expireAt` for collection group `aiCoverPicks` (24 hours); the documents hold only provider, source and the chosen cover key.

## Pilot

1. Deploy with `AI_EVENTS_ENABLED=true` and the secrets.
2. Turn it on for our own company only: write `companies/<ourCompanyId>/aiSettings/current` = `{ enabled: true }` with trusted tooling (Admin SDK or console; clients cannot write it).
3. Run 5 to 10 real generations, check the audit log entries (`ai.generateDrafts`, `ai.noteDeclined`, `ai.generateFailed`: models, tokens and cost only, never content) and `companies/<id>/aiUsage/<yyyymm>` (`spentMicros`, `generations`).
4. Then one pilot company, then wider. Per-company overrides in the same document: `monthlyBudgetCents`, `dailyBudgetCents`, `monthlyGenerationLimit`, `dailyGenerationLimit`.

## Kill switches and rollback

- One company: set `aiSettings/current.enabled` to false. Immediate.
- Everyone: set `AI_EVENTS_ENABLED=false` and redeploy the two functions, or revoke the OpenAI key in the OpenAI dashboard (drafting then fails with `AI_UNAVAILABLE`; no spend). A revoked or failing Jev key needs no action: each failed Jev call falls back to `gpt-4o-mini` in the same request. To stop calling Jev at all, set the decision providers to `openai-mini` (or the secret to `none`) and redeploy.
- Nothing else depends on the feature: no event is written by it, so rollback leaves only usage and request documents.

## Checklist (AI-10)

- [ ] `OPENAI_API_KEY` set and OpenAI project spend limit configured.
- [ ] `JEV_API_KEY` set from `dip-app/secrets` (Jev is the default decision provider).
- [ ] Budget values confirmed by the owner.
- [x] Live eval run and recorded (November 17, 2026, design doc Evaluation section).
- [ ] Model ids moved off `gpt-4o-mini` before its January 14, 2027 shutdown.
- [ ] OpenAI and TypeSafe AI data terms read.
- [ ] Privacy page deployed.
- [ ] TTL policies created.
- [ ] Pilot on our own company; kill switch tested (enabled false returns `AI_DISABLED`).

## Weekly ideas email (S6)

The admin weekly suggested-events email ([design](../design/stretch/admin-suggestions-email.md)) reuses these switches and the email setup ([email setup](email-setup.md)).

- Functions: `sendAdminSuggestionsEmails` (scheduler, every hour at minute 0 UTC, 540 s, 512 MiB), `manageSuggestionsEmailV1` and `resolveSuggestedIdeaV1` (callables, App Check). The scheduler and `manageSuggestionsEmailV1` bind `EMAIL_UNSUBSCRIBE_KEY`, `JEV_API_KEY` and `OPENAI_API_KEY`; `resolveSuggestedIdeaV1` binds only `EMAIL_UNSUBSCRIBE_KEY` (it also signs the deep links, purpose label `suggest-link:v1`). Deploying the scheduler creates a Cloud Scheduler job; it does nothing until the switches below are on.
- Needs: `EMAIL_ENABLED=true` and `emailSettings/{companyId}.enabled`, `AI_EVENTS_ENABLED=true` with `aiSettings/current.enabled`, and at least one admin who turned the email on in the portal (`/admin/suggestions/`). Engine: Jev when `JEV_API_KEY` is real and `SUGGESTIONS_DECISION_PROVIDER` is `jev` (default), else the OpenAI mini model, else the built-in heuristic.
- Optional env: `SUGGESTIONS_DECISION_PROVIDER` (`jev` or `openai-mini`). Schedule per company in `companies/{c}/suggestionsEmail/settings` (`weekday` 1 to 7, `hour` 0 to 23; default Monday 9, company time zone from `emailSettings/{c}.timeZone`), set by admins in the portal.
- Firestore TTL policy (optional): `expireAt` on collection group `suggestionDigests` (120 days).
- Cost: shares the company AI budget (`aiUsage/{yyyymm}`, pending key `suggest_<week>`), not counted as a generation; about $0.0005 a week with Jev. Also charges 3 Dipbot credits per company run (see Dipbot credits above); with fewer than 3 credits left the ranking uses the free heuristic.
- Kill switch: any of the switches above off; one admin: their portal switch or the email's unsubscribe link.


## Preference chips (considerations)

A closed catalog of about 50 preference chips (accessibility, food and drink, vibe, logistics, inclusion, safety) lives in `gcp/functions/src/modules/ai/domain/considerations.ts` and, byte for byte, in `apps/admin/src/lib/considerations.ts` (a unit test fails when they differ). The same single suggestion call asks one yes/no question per chip; a missing answer or no model falls back to a deterministic rule ranking by interests, theme and past events. The ranking is part of the saved suggestions, so it costs no extra credit; the portal reorders it locally by the admin's choices without a request. The top six show up front; "More options" lists every chip grouped and searchable, so accessibility and dietary options are never reachable only through the ranking. `generateEventDraftsV1` accepts the chosen ids as optional `considerations` (unique, at most 12, validated against the catalog; unknown ids are rejected) and puts their labels in the prompt. The old fixed note chips map to `something_new`, `vegetarian`, `wheelchair_accessible` and `quiet_low_pressure`.
