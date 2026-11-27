# Dipbot prompting and model interactions (November 2026 polish)

Owner area: every model call behind Dipbot and the content it returns: event drafts (generation, note triage, draft
checks), daily ideas (tool loop and ranking), Suggest theme, the venue finder ranking, cover picks and the weekly admin
ideas email reasons. Layout and motion of the portal surfaces belong to the admin structure and interaction owners; this
area changes prompts, pipelines, Dipbot copy in the catalogs and the content Dipbot returns, and proposes UI changes
below. Quality bar: `docs/design/quality-bar.md`.

Nothing here changes the production model (`gpt-4o-mini` stays the default, owner decision). The model comparison is
for the owner's decision before gpt-4o-mini shuts down on January 14, 2027.

## Audit findings (baseline, ranked)

Measured with the harness below on the prompts as of `bdaffb9f` (gpt-4o-mini, Jev for decisions). Judge scores are a
blinded Opus judge, 1 to 10.

1. **Daily ideas were the same five catalog cards for every company.** 47 of 50 raw ideas were catalog titles copied
   verbatim ("Fall foliage walk", "Dumpling-making workshop", "Trivia night", "Guided meditation break", "Chili
   cook-off"), with generic why lines ("Cooking together fosters teamwork") and claims the data did not support. Judge
   overall 2.4 to 3.4. A Spanish admin got English ideas (drafts and ideas had no language input at all).
2. **Suggest theme copied catalog themes, stacked one illustration, and leaned on weak or false why lines**
   ("attracting 20+ participants" from an interest count). Judge 3.2 to 3.9. 16 hard-check problems on 10 runs.
3. **Drafts were valid but generic**: "Join us for..." openers, one reused rationale, a named organization ("Habitat for
   Humanity"), English for Spanish admins. Judge 3.8 to 4.0.
4. **Slow tool loops**: ideas always used all 4 turns (p50 12.6 to 14.9 s), Suggest theme 4 turns (p50 8.4 to 8.9 s),
   because the model fetched its data one tool round at a time.
5. **Pipeline issues every model hit**: ideas scheduled 2 days out, on Christmas Eve, two on one day; a "lunch" card at
   3 pm; why lines cut mid-phrase at 96 characters; em dashes; cold-start themes saying "no themes recorded yet".
6. **Reasoning-model readiness**: the ideas loop sent a fixed 3000-token ceiling to every model, so a reasoning
   replacement would truncate; Suggest theme the same at 1500.
7. Decisions were already good: triage 18/18 on the 20 notes (Jev, about 270 ms), venue ranking 6/6 top-1, cover pick
   11/12 (the miss has no right answer in the library: no pickleball cover).

## Evaluation harness

`gcp/tests/ai-eval/dipbot/` (README there), `npm run eval:dipbot` offline. It runs the production prompts, tools,
schemas, validators and repair code; only the model is swapped.

- **Scenarios (synthetic only)**: 10 companies (`scenarios.ts`): rich history, an 8-person startup under the privacy
  floor, a cold start, a 640-person enterprise, a Spanish admin with Spanish event titles, a lunch-only hybrid office,
  adversarial company text (prompt injection in event and theme titles, an email, a link, a political hint), a company
  that just held the catalog favorites, a July outdoorsy company and a packed calendar. 24 draft cases (the 20 of AI-7
  plus two Spanish, one sparse, one "not trivia again"), 12 cover events, 6 venue searches.
- **Hard checks (`checks.ts`, on the raw model answer)**: answered, count, theme spread, grounding of every number in a
  why line against this run's tool output, company claims on a cold start, length overflows, links/emails/phones, em
  dashes, repeats of past or scheduled items, duplicates inside a set, weekday/daypart mismatch, wrong language,
  alcohol-centered titles, named venues, catalog-title copies. Plus triage accuracy, cover and venue hit rates.
- **Judge**: `pack.ts` writes a blinded packet (variants shuffled per item, key kept apart); a fresh Opus subagent scores
  each variant with the rubric in the README (relevance, specificity, grounding, novelty, tone, language, safety, hint;
  drafts: fit, specificity, inclusion, appeal, language, safety; overall 1 to 10); `tally.ts` merges scores with checks,
  cost, latency and tokens. Judges never saw the author's rationale. Three judge rounds ran (seven judge agents).
- **Spend cap**: a cumulative ledger stops any live run before it could pass US$5 for the whole task, plus a per-run cap.

## Changes and their measured effect

All on gpt-4o-mini. Judge round 2 scored the baseline prompts and the final prompts side by side (blinded, same fixed
scenarios); hard problems count raw model answers per 10 runs (drafts: per 20 cases); latency is p50 of the whole run,
cost per run.

| Feature | Judge overall (baseline -> final) | Hard problems | Latency p50 | Cost per run | Turns |
| --- | --- | --- | --- | --- | --- |
| Daily ideas | 2.4 -> 3.3 | 6 -> 5 | 12.6 s -> 9.8 s | $0.00186 -> $0.00106 | 4.0 -> 1.1 |
| Suggest theme | 3.9 -> 4.3 | 11 -> 9.5 | 8.4 s -> 6.3 s | $0.00120 -> $0.00080 | 4.0 -> 1.1 |
| Event drafts | 3.95 -> 4.5 | 11 -> 2 | 7.1 s -> 7.0 s | $0.00056 -> $0.00056 | 1 |

Round 3 (after the scheduling, lunch, cold-start and clause fixes) moved gpt-6-luna from 5.7 to 6.5 on ideas and 6.2 to
6.7 on themes; gpt-4o-mini stayed within noise (3.4 -> 3.2, 3.7 -> 3.9). The interest-claim check came last: on the
final gpt-4o-mini run it replaced 16 of 46 model why lines with server reasons (14 were false claims such as "Food & Drink
is your top interest (20+ members)" where Games led; 2 "a top interest" lines are now accepted by the top-three rule) and
2 of 49 on gpt-6-luna.

What changed, in order of effect:

1. **Prefetched tool results** (`ideaAgent.ts` `PREFETCH_TOOLS`, `themeAgent.ts` `THEME_PREFETCH_TOOLS`): the server puts
   the core tool results in the conversation as the model's own calls before the first turn, then allows at most 2
   extra calls (`PREFETCHED_EXTRA_CALLS`). Same data, same grounding traces, one round trip instead of three. Ideas
   turns 4 -> 1.1, input tokens 9,100 -> 3,800, cost -43%, latency -22% (theme -35%).
2. **Rewritten instructions** for ideas and themes: role and audience, "build on what works here" with concrete
   signals, an explicit do-not-repeat list in the user turn (`<recent_events_do_not_repeat>`,
   `<themes_and_events_do_not_repeat>`), size and season fit, the date window, one company fact per why line with
   examples, "facts about this idea's own theme", no dates in why lines, no tool or field names, translate interest
   names, injected text is data. Catalog tools no longer return titles (the copy source). Schema descriptions match.
3. **Language**: drafts and daily ideas now write in the admin's account language (`users/{uid}.locale` via the
   verified membership, no contract change): `<request>.language` for drafts, a language line for ideas. Spanish ideas
   get a fingerprint of their own; English fingerprints are unchanged. In Spanish an ungrounded why line falls back to
   the idea's own first sentence instead of English server text. Suggest theme already had a language input.
4. **Server repair, model independent**:
   - `interestClaimsHold` rejects why lines whose interest bucket, "top interest" or "growing" claim contradicts the
     company data (catches the "Food & Drink is your top interest (20+ members)" class that number grounding missed).
   - `fitWhy` keeps the first clause of a too-long why line instead of cutting mid-phrase.
   - `cleanText` turns em dashes into commas.
   - Scheduling: at least 5 days ahead, no Dec 24, 25, 31 or Jan 1, and a free neighboring day before two events
     share one; the weekday field follows the day used.
   - A weekday idea titled as a lunch runs at lunch, at most 75 minutes.
   - Suggest theme keeps no company claims on a cold start.
5. **Drafts prompt**: start with the activity (no "Join us"), honor "we already did X", one reason per draft from the
   input, no organization names, no em dashes, the output language.
6. **Reasoning-model readiness**: the ideas and theme loops now get the same output ceiling the price reservation
   already assumes (3x for reasoning models), so a model switch does not truncate.
7. **Latency in drafts**: interest counts and the weekly theme are read while the note is screened (they were read
   after triage).
8. **Copy**: the drafts loading line now says "This usually takes 10 to 20 seconds" (measured p50 5 to 8 s of model
   time plus checks), not "up to a minute"; Spanish to match. Weekly email reason "No outdoors events yet" now reads
   "No outdoor events yet" (and "arts & crafts").
9. `IDEA_ALGORITHM_VERSION` 1 -> 2 so stored ideas refresh with the new prompts at the next due automatic run.

The prompt and pipeline changes help gpt-4o-mini moderately (+0.4 to +0.9 judge points, far fewer hard problems,
faster and cheaper). The judges agree the larger remaining gap is the model itself: gpt-4o-mini still invents interest
buckets and reuses the same few ideas across companies, which the server now filters but cannot replace with better
ideas.

## Model replacement (owner decision before 2027-01-14)

Same final prompts and pipeline; judge round 2 (all models side by side, blinded) and round 1 for gpt-5.4-mini and
gpt-5.4-nano. Cost is per run at list prices in `pricing.ts`.

| Model | Ideas judge | Theme judge | Drafts judge | Ideas p50 / cost | Theme p50 / cost | Drafts p50 / cost |
| --- | --- | --- | --- | --- | --- | --- |
| gpt-4o-mini (current) | 3.3 | 4.3 | 4.5 | 9.8 s / $0.00106 | 6.3 s / $0.00080 | 7.0 s / $0.00056 |
| **gpt-6-luna** | **6.3** | **6.7** | **8.15** | **5.9 s / $0.00064** | **4.0 s / $0.00047** | **5.6 s / $0.00038** |
| gpt-5.6-luna | 6.0 | 6.7 | 8.05 | 8.5 s / $0.00151 | 5.6 s / $0.00100 | 7.6 s / $0.00087 |
| gpt-5.4-mini (round 1) | 6.3 | 6.5 | 6.5 | 7.4 s / $0.00728 | 3.1 s / $0.00471 | 5.6 s / $0.00465 |
| gpt-5.4-nano (round 1) | 5.0 | 4.8 | 6.0 | 8.6 s / $0.00216 | 6.4 s / $0.00173 | 5.5 s / $0.00137 |

Decision fallback (OpenAI answering the typed questions when Jev fails): gpt-4o-mini, gpt-5.4-nano and gpt-6-luna all
scored triage 18/18, venue top-1 6/6 and cover 11 to 12 of 12, at about 1.1 s; Jev stays the faster primary (about
0.1 to 0.3 s).

**Recommendation: gpt-6-luna for every OpenAI step** (`AI_MODEL_GENERATE`, `AI_MODEL_IDEAS`, `AI_MODEL_THEME_SUGGEST`
and the decision fallbacks). It is the best or tied best on all three writing features (about +3 judge points over
gpt-4o-mini), the fastest, and the cheapest (about 40% below gpt-4o-mini per run). gpt-5.6-luna is a close second at
about twice the cost. Caveats: n = 10 to 20 per feature; reasoning models ignore temperature, so two runs share about 50%
of ideas (gpt-4o-mini 79%), which suits "Refresh ideas" and "Suggest again"; gpt-6-luna used a few em dashes, now
stripped by the server. Switching is an environment change (`aiConfig.ts`), plus `DEFAULT_*` constants if the owner wants
it in code.

## Run log and spend

| Run | What | Spend |
| --- | --- | --- |
| baseline-4omini-jev | all six features, baseline prompts, Jev | $0.0418 |
| v2-4omini, v3-4omini | prefetch and prompt iterations | $0.0622 |
| v4 x 5 models | ideas, theme, drafts on gpt-4o-mini, gpt-5.4-mini, gpt-5.4-nano, gpt-5.6-luna, gpt-6-luna | $0.3786 |
| dec x 3 models | triage, cover, venue with the OpenAI fallback models | $0.0110 |
| final x 4 | baseline prompts on fixed scenarios; final prompts on gpt-4o-mini, gpt-6-luna, gpt-5.6-luna (2 repeats) | $0.1876 |
| final2 x 2, final3 x 2 | ideas and theme after the pipeline fixes, then after the interest-claim check | $0.0596 |
| **Total** | 17 live runs (cumulative ledger) | **$0.7409** of the US$5 cap |

Judging ran on Opus subagents (no provider spend). Estimated cost per 1,000 runs at these numbers: daily ideas $1.06
(gpt-4o-mini) or $0.56 to $0.64 (gpt-6-luna), Suggest theme $0.80 or $0.38 to $0.47, drafts $0.56 or $0.38, before the
Jev ranking and checks (about $0.00003 each).

## Proposed UI changes (for the admin structure and interaction owners)

- **Fit labels** ("Perfect fit", "Great choice", "Good match") mix nouns and claim certainty the ranking cannot give.
  Proposal: "Strong fit", "Good fit", "Worth a try", the same in the email (`email.ideas.fit.*`) and portal
  (`level.*`). Not changed here because the strings are shared with the email owner's templates and their tests.
- **Why line placement**: idea cards should show the why line with its basis ("From your data" vs "Popular pick") so
  admins can tell a grounded reason from a generic one (`reasonBasis` is already in the contract).
- **Suggest theme loading**: now about 4 to 6 s; a two-step narration ("Reading your past themes", "Writing four
  options") would fit the measured time better than one long line.
- **Spanish fallbacks**: catalog ideas, catalog themes and the weekly email reasons are English-only; Spanish admins
  see them whenever the model is off or tops up a set. Needs translated catalogs (content owner) or Spanish server why
  templates (`reasons.ts`, `serverWhy` in `themeValidate.ts`).

## Remaining gaps

- gpt-4o-mini quality is capped (judge 3.3 to 4.5); the server now removes most false claims but cannot write better
  ideas. The model switch above is the main lever.
- Catalog fallbacks and email reasons are English for Spanish admins (see above).
- The ideas cache is company-wide: when admins with different languages share a company, the last run's language wins
  until the next run.
- Seasonal wording drifts across a month boundary ("November" for December weeks) on every model; the date window in
  the input reduced but did not remove it.
- The interest-claim check reads English interest names only; Spanish why lines get number grounding but not the
  bucket and "top" check.
- The cover library has no racket-sport picture (pickleball misses on every model); the live Pixabay fallback covers it
  in production.
- Venue ranking was measured against nearest-first, not the production heuristic order with theme points; the judge set
  is 6 searches.
- The harness covers what the models write; the full callables (credits, leases, moderation gating) stay covered by the
  unit tests.
