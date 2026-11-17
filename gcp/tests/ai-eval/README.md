# AI event drafts: prompt evaluation (AI-7)

Status: no live run has been done yet. Everything below the offline section is a procedure for the owner to follow. The only results that exist so far come from the offline fake provider, which says nothing about model quality.

## Purpose

Compare candidate models for the two LLM steps of AI event drafts (the note screen and the draft generation) on 20 fixed cases, using the exact production prompts, schemas and validators. The outcome decides the defaults for `AI_GENERATE_MODEL` (currently `claude-sonnet-5-5`) and `AI_SCREEN_MODEL` (currently `claude-haiku-5-5`). Design reference: `docs/design/stretch/ai-event-creation.md`, Testing plan.

Files:

- `cases.json`: 20 cases (11 ordinary, 5 edge, 4 adversarial). Each has choices (real default catalog tag ids), draft count, admin note, interest counts, optional weekly theme, the expected screen result (`ok` or `flag`) and a `focus` line saying what it probes. No real names; "Marcus" in `adv-02` is an invented first name used to test personal data.
- `run.ts`: the runner. It builds prompts with `buildGenerateUserContent`, `buildScreenUserContent`, the schemas and `summarizeInterests`, the same path as `application/generate.ts`.
- `results/`: git-ignored output (`<timestamp>-<label>.json`).

## Run offline (no key, no spend)

From the repo root, on Node 24:

```
node --import tsx gcp/tests/ai-eval/run.ts
```

This uses `DemoLlm`, so it only proves the harness, prompt building and validators work. The demo screen flags only the literal injection phrase, so it will miss the other adversarial cases, and its canned drafts trip the automatic cost and capacity checks. Both are expected.

Useful flags: `--cases ord-01,adv-01` to run a subset, `--label name`, `--out dir`, `--generate-flagged` (also generate for cases the screen flagged, to test the generate prompt against injection).

## Run the live comparison (owner only)

Needs an Anthropic API key in your own shell. Never commit it or paste it into a session log.

```
export ANTHROPIC_API_KEY=...
node --import tsx gcp/tests/ai-eval/run.ts --live
```

Without `--yes` the runner prints the estimated maximum spend (cases x models x worst case per generation) and exits without calling the API. Re-run with `--yes` to spend. The runner also stops if actual spend passes the confirmed maximum.

Defaults: generate with `claude-haiku-5-5` and `claude-sonnet-5-5`, screen with `claude-haiku-5-5`. Override with repeated `--model <id>` and `--screen-model <id>`.

Cost expectation (design doc): about $0.001 per Haiku generation and about $0.025 per Sonnet generation, so 20 cases x 2 models is well under $2. The printed maximum is a deliberately pessimistic ceiling (two full-length generate calls per case) and will be larger than the real spend.

## What is measured

Per case and model:

- Screen: the verdict against the expectation (`ok` or `flag`). Empty notes skip the screen, as in production. Anything other than an explicit `ok` counts as flagged.
- Valid: `parseModelDrafts` succeeds and returns exactly `count` drafts.
- Automatic checks on the raw model output (before the server clamps values): no links, emails or phone numbers; cost within the budget band; capacity within the group size band; lunch events 75 minutes or less; no named venue heuristic (a capitalized multiword name ending in Cafe, Bar, Park, Center and similar is marked `review`, not `fail`).
- Tokens, cost (`costMicros`) and latency.

The summary table prints, per model: valid %, screen accuracy %, automatic check failures, venue reviews, average cost per generation (screen plus generate, USD) and average generate latency.

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

1. Run `npm run session:new` (if no log exists for this session) and record in `docs/sessions/SESSION_<username>_<date>_<NNN>.md`: date, models, the summary table, rubric averages per model, your decision and the result file name. Do not include the key.
2. If the winner differs from the current defaults, change `AI_GENERATE_MODEL` / `AI_SCREEN_MODEL` (defaults in `gcp/functions/src/modules/ai/infrastructure/settings.ts`, deployed values in the function environment) and add a price entry in `domain/pricing.ts` if the model is new.
3. Re-run after any change to the prompts in `domain/prompt.ts`.
