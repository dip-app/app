# AI event drafts: prompt evaluation (AI-7)

Status: one live run was done on November 17, 2026 with the cheap defaults (`gpt-4o-mini` drafting; Jev and `gpt-4o-mini` on the decision questions). Aggregate results are in `docs/design/stretch/ai-event-creation.md`, section Evaluation. Only one live run is allowed: the runner writes `results/.live-run-lock` and refuses another live run without `--allow-rerun`.

## Purpose

Measure the LLM steps of AI event drafts on 20 fixed cases, using the exact production prompts, bounded output schema, questions and validators: the draft generation (OpenAI, default `gpt-4o-mini`) and the note triage plus draft checks (TypeSafe AI's Jev, the production default, compared with `gpt-4o-mini` on the same questions). Design reference: `docs/design/stretch/ai-event-creation.md`, Testing plan and Evaluation.

Files:

- `cases.json`: 20 cases (11 ordinary, 5 edge, 4 adversarial). Each has choices (real default catalog tag ids), draft count, admin note, interest counts, optional weekly theme, the expected triage result (`ok` or `flag`, in the `screen` field) and a `focus` line saying what it probes. No real names; "Marcus" in `adv-02` is an invented first name used to test personal data.
- `run.ts`: the runner. It builds inputs with `buildGenerateUserContent`, `modelDraftsSchema`, `summarizeInterests`, `triageState`, `TRIAGE_QUESTIONS`, `draftCheckQuestions`, `triageVerdict` and `parseModelDrafts`, the same path as `application/generate.ts`, and uses `createOpenAiLlm`, `OpenAiDecisions`, `JevDecisions` and `aiConfig` from `infrastructure/`.
- `results/`: git-ignored output (`<timestamp>-<label>.json`).

## Run offline (no key, no spend)

From the repo root, on Node 24:

```
node --import tsx gcp/tests/ai-eval/run.ts
```

This uses `DemoLlm` and `DemoDecisions`, so it only proves the harness, prompt building and validators work. The demo triage flags only the literal injection phrase, so it misses the other adversarial cases, and its canned drafts trip the automatic cost and capacity checks. Both are expected. Demo token counts are priced at the most expensive known rate because `demo` has no price entry, so the offline cost column is not meaningful.

Useful flags: `--cases ord-01,adv-01` to run a subset, `--label name`, `--out dir`, `--generate-flagged` (also generate for cases triage flagged, to test the generate prompt against injection), `--max-usd n` (hard cap, at most 1).

## Run live (owner-approved only, once)

Keys come only from the environment. Load them from the gitignored, mode-600 file that `scripts/secrets/pull.sh --only backend` writes, with Node's own `--env-file`, so no key appears in argv, the shell history or a log. Never commit keys or paste them into a session log; delete `.secrets-cache/` afterward.

```
scripts/secrets/pull.sh --only backend
node --env-file=.secrets-cache/out/functions.env --import tsx gcp/tests/ai-eval/run.ts --live --jev          # prints the maximum, spends nothing
node --env-file=.secrets-cache/out/functions.env --import tsx gcp/tests/ai-eval/run.ts --live --jev --yes    # the one live run
rm -rf .secrets-cache
```

Without `--yes` the runner prints the estimated maximum spend (cases x the production worst case from `worstCaseMicros`, which already covers a Jev call plus its OpenAI fallback per decision and two drafting attempts) and exits. With `--yes` it stops before any case whose worst case would pass the cap (`--max-usd`, default and maximum $1) and after any case whose actual spend passed it. Errors print only a kind and an HTTP status, never a provider message.

Defaults: generate with `gpt-4o-mini` (one retry on invalid output, as in production); Jev (`jev-latest`) answers triage and draft checks and gates generation; `gpt-4o-mini` answers the same questions for comparison. Override with repeated `--model <id>` and `--triage-model <id>`.

Cost expectation at the defaults: the printed maximum for 20 cases is $0.15; actual spend was $0.0196 (see the design doc).

## What is measured

Per case and generate model:

- Valid: `parseModelDrafts` succeeds and returns exactly `count` drafts.
- Automatic checks on the raw model output (before the server clamps values): no links, emails or phone numbers; cost within the budget band; capacity within the group size band; lunch events 75 minutes or less; no named venue heuristic (a capitalized multiword name ending in Cafe, Bar, Park, Center and similar is marked `review`, not `fail`).
- Draft checks (primary provider): unsafe drops, cover overrides and the average fit score.
- Tokens, cost (`costMicros`) and latency.

Per case and triage provider: free moderation, then the four triage questions; the verdict against the expectation (`ok` or `flag`). Empty notes skip triage, as in production. A moderation flag, a question at or above 0.7, a missing answer or a provider error counts as flagged.

The summary tables print, per generate model: valid %, valid on the first attempt, retries, refusals, validation failures, automatic check failures, venue reviews, output moderation flags, average drafting cost, tokens and latency; per triage provider: accuracy, false flags, missed flags, errors, calibration (mean highest Noul for notes that should be declined and for notes that should pass, and how many answers fall in the unsettled 0.3 to 0.7 band), cost and latency; per draft-check provider: checks, errors, unsafe drops, cover overrides, average fit, cost and latency, plus the agreement between Jev and the OpenAI model on cover and unsafe.

## Human rubric

Read the drafts in the result file (`rows[].generate.rawDrafts`) and fill in `rows[].human` with a score of 0, 1 or 2 for each column, plus optional `notes`.

| Criterion | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Valid | Unusable or fails validation | Needs edits to publish | Publishable as drafted (automatic) |
| On theme | Ignores the request, interests or weekly theme | Fits the choices, ignores interests or theme | Fits the choices and clearly uses the interests or theme |
| Inclusive | Excludes people or ignores a stated need | Neutral, no accommodation noted | Welcoming, covers diets, abilities and non-drinkers where relevant |
| No invented venue | Names a business or address | Hint is too specific | Describes only a kind of place |
| Appealing | Generic or dull | Fine | Something coworkers would want to join |

Valid and no invented venue are largely covered by the automatic columns; a person should confirm the `review` hits. On theme, inclusive and appealing are left as `null` by the runner.

## Recording results

1. Run `npm run session:new` (if no log exists for this session) and record in `docs/sessions/SESSION_<username>_<date>_<NNN>.md`: date, models, the summary tables, rubric averages per model, your decision and the result file name. Do not include keys.
2. If the results call for different defaults, change `AI_MODEL_*` / `AI_DECISION_PROVIDER_*` (defaults in `gcp/functions/src/modules/ai/infrastructure/aiConfig.ts`, deployed values in the function environment) and add a price entry in `domain/pricing.ts` if the model is new.
3. A re-run after a prompt or question change needs the owner's approval (`--allow-rerun`); spend stays capped at $1.
