# AI event ideas: owner actions, rollout and kill switches

Runbook for the AI event drafts feature (stretch S2, [design](../design/stretch/ai-event-creation.md)). Nothing here has been run. Deploying is a human action ([deploy runbook](deploy-runbook.md)).

## What ships in the code

- Callables `getEventIdeaContextV1` and `generateEventDraftsV1` (`gcp/functions/src/modules/ai`), admin only (`ai.generate`), App Check enforced outside the emulator. Contract: [admin contract](../contracts/admin.md#ai-event-drafts-aigenerate-admin-only).
- Portal page `/admin/ideas/` ("Event ideas" in the sidebar, admins only).
- Off by default twice: the deployment switch `AI_EVENTS_ENABLED` is false unless set, and each company must also have `companies/{companyId}/aiSettings/current` with `enabled: true`.

## Owner actions before the first real call

1. **API key.** Create a key in the Anthropic Console in a dedicated workspace for DIP, set a workspace spend limit there (for example $20 per month) as the global backstop, then store it only in Secret Manager:
   `firebase functions:secrets:set ANTHROPIC_API_KEY --project team05-dip`
   Never commit it, paste it in chat, or put it in `.env` files. Rotating it: set a new version, then redeploy `generateEventDraftsV1`.
2. **Budget.** Defaults: $5 per company per month, 30 generations per company per month, 10 per admin per day, 3 declined notes per admin per day. Change them with environment values in `gcp/functions/.env.team05-dip` (not secret): `AI_MONTHLY_BUDGET_CENTS`, `AI_MONTHLY_GENERATIONS`, `AI_DAILY_GENERATIONS_PER_ADMIN`, `AI_DAILY_FLAG_LIMIT`, plus `AI_GENERATE_MODEL` (default `claude-sonnet-5-5`) and `AI_SCREEN_MODEL` (default `claude-haiku-5-5`). One generation costs roughly $0.03 on Sonnet 5.5 and the reserved worst case is about $0.18.
3. **Evaluation (AI-7).** Run the 20-case eval once against the live API before the pilot (`gcp/tests/ai-eval/README.md`; under $2) and record results in a session log. Switch `AI_GENERATE_MODEL` to Haiku if quality holds.
4. **Privacy page.** Before the pilot, add a line like this to `apps/landing/privacy/index.html` and deploy it: "Admins can ask an AI service (Anthropic) to draft event ideas. It receives the admin's choices and note and rounded, anonymous counts of interests in the company (never names, emails or individual profiles). Drafts are reviewed by a person before anything is published." Confirm Anthropic's commercial terms and data retention for the workspace first.

## Deploy notes for the coordinator

- Functions: `getEventIdeaContextV1`, `generateEventDraftsV1` (`us-central1`; the second binds the secret, 180 s timeout, 512 MiB). Deploying `generateEventDraftsV1` fails until the `ANTHROPIC_API_KEY` secret exists; deploy the rest with `--only functions:<names>` if the key is not ready.
- Firestore TTL policies (console or `gcloud firestore fields ttls update`): `expireAt` on collection group `aiRequests` (24 hours) and `aiUsageDaily` (8 days). Without them the documents stay; nothing breaks.
- No rules or index changes: every AI document is server-only and falls through to the deny-all rule (tested in `gcp/tests/rules/ai.test.ts`).
- Admin portal: rebuild and deploy hosting as usual; the page reads only the two callables.

## Pilot

1. Deploy with `AI_EVENTS_ENABLED=true` and the secret.
2. Turn it on for our own company only: write `companies/<ourCompanyId>/aiSettings/current` = `{ enabled: true }` with trusted tooling (Admin SDK or console; clients cannot write it).
3. Run 5 to 10 real generations, check the audit log entries (`ai.generateDrafts`, `ai.noteDeclined`, `ai.generateFailed`: model, tokens and cost only, never content) and `companies/<id>/aiUsage/<yyyymm>` (`spentMicros`, `generations`).
4. Then one pilot company, then wider. Per-company overrides: `monthlyBudgetCents`, `monthlyGenerationLimit`, `dailyGenerationLimit` in the same document.

## Kill switches and rollback

- One company: set `aiSettings/current.enabled` to false. Immediate.
- Everyone: set `AI_EVENTS_ENABLED=false` and redeploy the two functions, or revoke the API key in the Anthropic Console (calls then fail with `AI_UNAVAILABLE`; no spend).
- Nothing else depends on the feature: no event is written by it, so rollback leaves only usage and request documents.

## Checklist (AI-10)

- [ ] Secret set and workspace spend limit configured.
- [ ] Budget values confirmed by the owner.
- [ ] Live eval run and recorded.
- [ ] Privacy line deployed.
- [ ] TTL policies created.
- [ ] Pilot on our own company; kill switch tested (enabled false returns `AI_DISABLED`).
