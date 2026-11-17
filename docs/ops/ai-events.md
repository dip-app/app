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
   | `AI_PROVIDER` | `openai` (`demo` in the emulator) | `demo` uses offline fakes and needs no key |
   | `AI_MONTHLY_BUDGET_CENTS` | 200 | Company spend cap per UTC month ($2) |
   | `AI_DAILY_BUDGET_CENTS` | 50 | Company spend cap per UTC day ($0.50) |
   | `AI_MONTHLY_GENERATIONS` | 30 | Generations per company per month |
   | `AI_DAILY_GENERATIONS_PER_ADMIN` | 10 | Generations per admin per UTC day |
   | `AI_DAILY_FLAG_LIMIT` | 3 | Declined notes per admin per UTC day |
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

## Feature off (clean no-op)

If `AI_EVENTS_ENABLED` is not `true`, or `OPENAI_API_KEY` is missing, blank or `none`, the feature is disabled without errors in the logs: `generateEventDraftsV1` returns `AI_DISABLED`, `getEventIdeaContextV1` returns `enabled: false`, and the portal shows the off state. The same happens when the company document has no `enabled: true`.

## Deploy notes for the coordinator

- Functions: `getEventIdeaContextV1` and `generateEventDraftsV1` (`us-central1`; the second has a 300 s timeout and 512 MiB). Both bind the `OPENAI_API_KEY` and `JEV_API_KEY` secrets (the context callable reads the Jev key so its reserved worst case matches the generator's). Both secrets must exist (a `none` value for the Jev key is fine) before these functions can deploy; deploy the rest with `--only functions:<names>` if the keys are not ready.
- Firestore TTL policies (console or `gcloud firestore fields ttls update`): `expireAt` on collection group `aiRequests` (24 hours) and `aiUsageDaily` (8 days). Without them the documents stay; nothing breaks.
- No rules or index changes: every AI document is server-only and falls through to the deny-all rule (tested in `gcp/tests/rules/ai.test.ts`).
- Admin portal: rebuild and deploy hosting as usual; the page reads only the two callables.

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
