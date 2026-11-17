# AI event drafts: prompt evaluation (AI-7)

Status: no live run has been done yet. Everything below the offline section is a procedure for the owner to follow. The only results that exist come from the offline demo providers, which say nothing about model quality.

## Purpose

Compare candidate models for the LLM steps of AI event drafts on 20 fixed cases, using the exact production prompts, schemas, questions and validators: the draft generation (OpenAI) and the note triage plus draft checks (an OpenAI mini model against TypeSafe AI's Jev). The outcome decides the defaults for `AI_MODEL_GENERATE` (currently `gpt-6-astra`) and the decision providers `AI_DECISION_PROVIDER_TRIAGE` / `AI_DECISION_PROVIDER_DRAFT_CHECK` (currently `openai-mini` with `gpt-6-luna`). Design reference: `docs/design/stretch/ai-event-creation.md`, Testing plan.

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

Useful flags: `--cases ord-01,adv-01` to run a subset, `--label name`, `--out dir`, `--generate-flagged` (also generate for cases triage flagged, to test the generate prompt against injection).

## Run the live comparison (owner only)

Needs an OpenAI API key in your own shell, and optionally a TypeSafe AI key to compare Jev. Never commit keys or paste them into a session log.

```
export OPENAI_API_KEY=...
export JEV_API_KEY=...          # only with --jev
node --import tsx gcp/tests/ai-eval/run.ts --live [--jev]
```

Without `--yes` the runner prints the estimated maximum spend (cases x models x the worst case from `worstCaseMicros`, plus one extra triage call per case for Jev) and exits without calling any API. Re-run with `--yes` to spend. The runner also stops if actual spend passes the confirmed maximum.

Defaults: generate with `gpt-6-astra` and `gpt-6.1-sol`; triage and draft checks with `openai-mini` (`gpt-6-luna`), plus `jev` (`jev-latest`) when `--jev` is given. Override with repeated `--model <id>` and `--triage-model <id>`. The first triage provider (`openai-mini`) gates generation and runs the draft checks; Jev is compared on triage only.

Cost expectation: the printed maximum for the defaults with `--jev` is about $31.87 (20 cases, both models, worst case of 2 full-length drafting calls per case; a deliberately pessimistic ceiling). Typical spend is far lower: about $0.19 per `gpt-6-astra` generation and about $0.04 per `gpt-6.1-sol` generation, over roughly 16 generated cases (4 adversarial notes are expected to be flagged), so about $4 in total. Moderation is free and Jev decision calls cost fractions of a cent.

## What is measured

Per case and generate model:

- Valid: `parseModelDrafts` succeeds and returns exactly `count` drafts.
- Automatic checks on the raw model output (before the server clamps values): no links, emails or phone numbers; cost within the budget band; capacity within the group size band; lunch events 75 minutes or less; no named venue heuristic (a capitalized multiword name ending in Cafe, Bar, Park, Center and similar is marked `review`, not `fail`).
- Draft checks (primary provider): unsafe drops, cover overrides and the average fit score.
- Tokens, cost (`costMicros`) and latency.

Per case and triage provider: free moderation, then the four triage questions; the verdict against the expectation (`ok` or `flag`). Empty notes skip triage, as in production. A moderation flag, a question at or above 0.7, a missing answer or a provider error counts as flagged.

The summary tables print, per generate model: valid %, automatic check failures, venue reviews, average cost per generation (drafting plus draft checks, USD) and average latency; and per triage provider: accuracy, errors, average cost per note and latency.

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
2. If the winner differs from the current defaults, change `AI_MODEL_GENERATE` / `AI_DECISION_PROVIDER_*` (defaults in `gcp/functions/src/modules/ai/infrastructure/aiConfig.ts`, deployed values in the function environment) and add a price entry in `domain/pricing.ts` if the model is new.
3. Re-run after any change to the prompts in `domain/prompt.ts` or the questions in `domain/decisions.ts`.
