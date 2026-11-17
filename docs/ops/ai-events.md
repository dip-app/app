# AI event ideas: owner actions, rollout and kill switches

Runbook for the AI event drafts feature (stretch S2, [design](../design/stretch/ai-event-creation.md)). Nothing here has been run. Deploying is a human action ([deploy runbook](deploy-runbook.md)).

## What ships in the code

- Callables `getEventIdeaContextV1` and `generateEventDraftsV1` (`gcp/functions/src/modules/ai`), admin only (`ai.generate`), App Check enforced outside the emulator. Contract: [admin contract](../contracts/admin.md#ai-event-drafts-aigenerate-admin-only).
- Drafts are written by OpenAI (Responses API, structured output, `store: false`). Free OpenAI moderation and typed decision questions (note triage, draft checks) screen the note and the drafts. The decision questions go to TypeSafe AI's Jev model when a Jev key exists, otherwise to an OpenAI mini model.
- Portal page `/admin/ideas/` ("Event ideas" in the sidebar, admins only).
- Off by default twice: the deployment switch `AI_EVENTS_ENABLED` is false unless set, and each company must also have `companies/{companyId}/aiSettings/current` with `enabled: true`.

## Owner actions before the first real call

1. **OpenAI key.** Create a key in a dedicated OpenAI project for DIP, set a project spend limit there (for example $50 per month) as the global backstop, then store the key only in Secret Manager:
   `firebase functions:secrets:set OPENAI_API_KEY --project team05-dip`
   Never commit it, paste it in chat, or put it in `.env` files. Rotating it: set a new version, then redeploy both AI functions.
2. **Jev key (optional).** Jev is TypeSafe AI's decision model. Confirm that "jeb" means Jev, create a key in the TypeSafe console, then store it:
   `firebase functions:secrets:set JEV_API_KEY --project team05-dip`
   Until a key exists, enter `none` when prompted. The code treats `none` (or blank) as absent and answers the decision questions with the OpenAI mini model. With a real key, also set `AI_DECISION_PROVIDER_TRIAGE=jev` and `AI_DECISION_PROVIDER_DRAFT_CHECK=jev`; the default for both is `openai-mini`.
3. **Budget and models.** Change defaults with environment values in `gcp/functions/.env.team05-dip` (not secret):

   | Name | Default | Meaning |
   | --- | --- | --- |
   | `AI_EVENTS_ENABLED` | unset (off) | Deployment switch; must be `true` |
   | `AI_PROVIDER` | `openai` (`demo` in the emulator) | `demo` uses offline fakes and needs no key |
   | `AI_MONTHLY_BUDGET_CENTS` | 3000 | Company spend cap per UTC month |
   | `AI_DAILY_BUDGET_CENTS` | 600 | Company spend cap per UTC day |
   | `AI_MONTHLY_GENERATIONS` | 30 | Generations per company per month |
   | `AI_DAILY_GENERATIONS_PER_ADMIN` | 10 | Generations per admin per UTC day |
   | `AI_DAILY_FLAG_LIMIT` | 3 | Declined notes per admin per UTC day |
   | `AI_MODEL_GENERATE` | `gpt-6-astra` | Drafting model |
   | `AI_EFFORT_GENERATE` | `low` | `minimal`, `low`, `medium`, `high` or `xhigh` |
   | `AI_MODEL_TRIAGE` | `gpt-6-luna` | OpenAI model for note triage (and the Jev fallback) |
   | `AI_MODEL_DRAFT_CHECK` | `gpt-6-luna` | OpenAI model for draft checks (and the Jev fallback) |
   | `AI_DECISION_PROVIDER_TRIAGE` | `openai-mini` | `jev` or `openai-mini` |
   | `AI_DECISION_PROVIDER_DRAFT_CHECK` | `openai-mini` | `jev` or `openai-mini` |
   | `AI_JEV_MODEL` | `jev-latest` | `jev-latest` (currently `jev-1.14.0`) or `jev-1.13.0` |
   | `AI_MODEL_MODERATION` | `omni-moderation-latest` | Free moderation model |

   One generation costs about $0.19 on `gpt-6-astra` (about $0.04 on `gpt-6.1-sol`); the reserved worst case is about $1.32. The feature only turns on when `AI_EVENTS_ENABLED=true` and the `OPENAI_API_KEY` secret holds a real value.
4. **Evaluation (AI-7).** Run the 20-case eval once against the live APIs before the pilot (`gcp/tests/ai-eval/README.md`; the printed maximum is about $32 and typical spend is about $4) and record results in a session log. Compare `gpt-6-astra` with `gpt-6.1-sol` for drafting, and `openai-mini` with `jev` for triage if a Jev key exists. Switch `AI_MODEL_GENERATE` if quality holds on the cheaper model.
5. **Data terms.** Read OpenAI's and TypeSafe AI's data retention and training terms for API use before the pilot (UNVERIFIED in the design doc). Drafting calls already send `store: false`.
6. **Privacy page.** The Service providers section of `apps/landing/privacy/index.html` names OpenAI and TypeSafe AI for AI event ideas. Deploy it before the pilot.

## Feature off (clean no-op)

If `AI_EVENTS_ENABLED` is not `true`, or `OPENAI_API_KEY` is missing, blank or `none`, the feature is disabled without errors in the logs: `generateEventDraftsV1` returns `AI_DISABLED`, `getEventIdeaContextV1` returns `enabled: false`, and the portal shows the off state. The same happens when the company document has no `enabled: true`.

## Deploy notes for the coordinator

- Functions: `getEventIdeaContextV1` and `generateEventDraftsV1` (`us-central1`; the second has a 300 s timeout and 512 MiB). Both bind the `OPENAI_API_KEY` secret; the generator also binds `JEV_API_KEY`. Both secrets must exist (a `none` value for the Jev key is fine) before these functions can deploy; deploy the rest with `--only functions:<names>` if the keys are not ready.
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
- Everyone: set `AI_EVENTS_ENABLED=false` and redeploy the two functions, or revoke the OpenAI key in the OpenAI dashboard (drafting then fails with `AI_UNAVAILABLE`; no spend). Revoking only the Jev key makes the decision steps fall back to the OpenAI mini model after the next deploy or cold start; to force that at once, set the decision providers back to `openai-mini`.
- Nothing else depends on the feature: no event is written by it, so rollback leaves only usage and request documents.

## Checklist (AI-10)

- [ ] `OPENAI_API_KEY` set and OpenAI project spend limit configured.
- [ ] `JEV_API_KEY` set (`none` is fine until a Jev key exists).
- [ ] Budget values confirmed by the owner.
- [ ] Live eval run and recorded.
- [ ] OpenAI and TypeSafe AI data terms read.
- [ ] Privacy page deployed.
- [ ] TTL policies created.
- [ ] Pilot on our own company; kill switch tested (enabled false returns `AI_DISABLED`).
