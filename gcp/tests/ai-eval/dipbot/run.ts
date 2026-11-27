/**
 * Dipbot evaluation runner (docs/design/polish-2026-11/dipbot.md): every model-backed Dipbot step on fixed synthetic
 * scenarios, through the production prompts, tools, schemas, validators and repair code.
 *
 * Offline (default, no key, no spend):  npm run eval:dipbot
 * Live (spends, capped):                node --env-file=.secrets-cache/out/functions.env --import tsx gcp/tests/ai-eval/dipbot/run.ts --live --yes
 *
 * Flags:
 *   --features ideas,theme,drafts,triage,cover,venue   (default: all)
 *   --model <id>            OpenAI model for ideas, theme and drafts; repeatable (default gpt-4o-mini)
 *   --decider jev|openai    who answers triage, cover and venue questions and the ideas/theme ranking (default jev)
 *   --scenarios <id,...>    subset of scenarios (ideas, theme) ; --cases <id,...> subset of drafts/triage cases
 *   --repeat <n>            run ideas and theme n times per scenario (determinism; default 1)
 *   --max-usd <n>           cap for this run (default 1). The cumulative ledger (results/spend-ledger.json) also caps
 *                           ALL live runs together at $5 (the task budget); a run stops before passing either cap.
 *   --live --yes            real APIs (keys from the environment only; never printed)
 *   --label <text>          result file label
 *   --decider-model <id>    OpenAI model of --decider openai (default gpt-4o-mini)
 *   --no-prefetch           ideas and theme: let the model fetch its data with tool calls (the pre-2026-11-26 behavior)
 *
 * Output: results/<stamp>-<label>.json (git-ignored): per item the raw model answer, the final answer the admin sees,
 * hard checks, tokens, cost and latency. `pack.ts` turns result files into a blinded packet for the judge and
 * `tally.ts` merges the judge's scores with the hard checks.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AiEventChoices } from "../../../functions/src/generated/models";
import type { AgentModelPort, DecisionPort, LlmPort } from "../../../functions/src/modules/ai/application/ports";
import { runIdeaAgent } from "../../../functions/src/modules/ai/application/ideaAgent";
import { runThemeAgent } from "../../../functions/src/modules/ai/application/themeAgent";
import { TRIAGE_QUESTIONS, triageState, triageVerdict } from "../../../functions/src/modules/ai/domain/decisions";
import { InvalidModelOutput, parseModelDrafts } from "../../../functions/src/modules/ai/domain/drafts";
import { ideaSnapshot } from "../../../functions/src/modules/ai/domain/ideaTools";
import { applyRanking, buildIdeas, rankingRequest } from "../../../functions/src/modules/ai/domain/ideaValidate";
import { summarizeInterests } from "../../../functions/src/modules/ai/domain/interests";
import { THEME_PRICED, costMicros, ideaOutputCeiling, ideasWorstCaseMicros, isReasoningModel, outputCeiling, themeWorstCaseMicros } from "../../../functions/src/modules/ai/domain/pricing";
import { GENERATE_SYSTEM_PROMPT, buildGenerateUserContent, modelDraftsSchema } from "../../../functions/src/modules/ai/domain/prompt";
import { sanitizeNote } from "../../../functions/src/modules/ai/domain/request";
import { themeSnapshot, type ThemeTrace } from "../../../functions/src/modules/ai/domain/themeTools";
import { buildThemes, moderationTexts, rankThemes, themeRankingRequest } from "../../../functions/src/modules/ai/domain/themeValidate";
import { aiConfig } from "../../../functions/src/modules/ai/infrastructure/aiConfig";
import { DemoAgentModel, DemoDecisions, DemoLlm, DemoThemeAgentModel } from "../../../functions/src/modules/ai/infrastructure/demo";
import { JevDecisions } from "../../../functions/src/modules/ai/infrastructure/jevDecisions";
import { createOpenAiAgentModel } from "../../../functions/src/modules/ai/infrastructure/openAiAgent";
import { OpenAiDecisions } from "../../../functions/src/modules/ai/infrastructure/openAiDecisions";
import { createOpenAiLlm } from "../../../functions/src/modules/ai/infrastructure/openaiLlm";
import { pickCover } from "../../../functions/src/modules/covers/application/pickCover";
import { coverByURL } from "../../../functions/src/modules/covers/domain/coverCatalog";
import { applyVenueAnswer, venueQuestion, venueState } from "../../../functions/src/modules/places/domain/venueQuestion";
import type { RankedVenue } from "../../../functions/src/modules/places/domain/ranking";
import { IDEA_CATALOG } from "../../../functions/src/modules/suggestions/domain/catalog";
import { THEME_IDEAS } from "../../../functions/src/modules/ai/domain/themeCatalog";
import { checkDrafts, checkIdeas, checkThemes } from "./checks";
import { CATALOG, COVER_EVENTS, SCENARIOS, VENUE_CASES, signalsFor, themeRecordsFor } from "./scenarios";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, "results");
const LEDGER = join(RESULTS, "spend-ledger.json");
/** The task budget: all live runs together. */
const TOTAL_CAP_MICROS = 5_000_000;
const FEATURES = ["ideas", "theme", "drafts", "triage", "cover", "venue"] as const;
type Feature = (typeof FEATURES)[number];

interface Args {
  live: boolean; yes: boolean; features: Feature[]; models: string[]; decider: "jev" | "openai"; scenarios: string[] | null; cases: string[] | null;
  repeat: number; maxUsd: number; label: string; prefetch: boolean; deciderModel: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { live: false, yes: false, features: [...FEATURES], models: [], decider: "jev", scenarios: null, cases: null, repeat: 1, maxUsd: 1, label: "", prefetch: true, deciderModel: "gpt-4o-mini" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    const value = () => { const v = argv[++i]; if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`); return v; };
    const list = () => value().split(",").map(s => s.trim()).filter(Boolean);
    if (flag === "--live") a.live = true;
    else if (flag === "--yes") a.yes = true;
    else if (flag === "--features") a.features = list().map(f => { if (!(FEATURES as readonly string[]).includes(f)) throw new Error(`Unknown feature ${f}`); return f as Feature; });
    else if (flag === "--model") a.models.push(value());
    else if (flag === "--decider") { const d = value(); if (d !== "jev" && d !== "openai") throw new Error("--decider is jev or openai"); a.decider = d; }
    else if (flag === "--scenarios") a.scenarios = list();
    else if (flag === "--cases") a.cases = list();
    else if (flag === "--repeat") a.repeat = Math.max(1, Math.min(5, Number(value())));
    else if (flag === "--max-usd") a.maxUsd = Number(value());
    else if (flag === "--label") a.label = value();
    else if (flag === "--no-prefetch") a.prefetch = false;
    else if (flag === "--decider-model") a.deciderModel = value();
    else throw new Error(`Unknown flag ${flag}`);
  }
  if (!Number.isFinite(a.maxUsd) || a.maxUsd <= 0 || a.maxUsd > 5) throw new Error("--max-usd must be above 0 and at most 5");
  if (a.models.length === 0) a.models = [a.live ? "gpt-4o-mini" : "demo"];
  return a;
}

// ---------- spend ledger ----------

interface Ledger { totalMicros: number; runs: Array<{ at: string; label: string; micros: number }> }
const readLedger = (): Ledger => (existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger : { totalMicros: 0, runs: [] });

class Budget {
  spent = 0;
  constructor(private readonly runCap: number, private readonly before: number, private readonly live: boolean) {}
  /** False when spending up to `worst` more could pass the run cap or the task cap. */
  allows(worst: number): boolean {
    if (!this.live) return true;
    return this.spent + worst <= this.runCap && this.before + this.spent + worst <= TOTAL_CAP_MICROS;
  }
  add(micros: number) { if (this.live) this.spent += micros; }
}

const usd = (m: number) => `$${(m / 1e6).toFixed(4)}`;
const errName = (e: unknown) => (e instanceof Error ? e.name : "error");

// ---------- providers ----------

interface Providers {
  agent(model: string, kind: "ideas" | "theme"): AgentModelPort;
  llm(model: string): LlmPort;
  decider: DecisionPort;
  deciderModel: string;
}

function providers(args: Args): Providers {
  if (!args.live) {
    return {
      agent: (_m, kind) => (kind === "ideas" ? new DemoAgentModel() : new DemoThemeAgentModel()),
      llm: () => new DemoLlm(),
      decider: new DemoDecisions(),
      deciderModel: "demo",
    };
  }
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("--live needs OPENAI_API_KEY in the environment. Nothing was sent.");
  const jevKey = process.env.JEV_API_KEY;
  const config = (model: string) => aiConfig({ AI_MODEL_GENERATE: model, AI_MODEL_TRIAGE: "gpt-4o-mini", AI_MODEL_DRAFT_CHECK: "gpt-4o-mini", AI_MODEL_COVER_PICK: "gpt-4o-mini", AI_MODEL_VENUE_PICK: "gpt-4o-mini" });
  const llms = new Map<string, LlmPort>();
  const llm = (model: string) => { if (!llms.has(model)) llms.set(model, createOpenAiLlm(openaiKey, config(model))); return llms.get(model)!; };
  let decider: DecisionPort;
  let deciderModel: string;
  if (args.decider === "jev") {
    if (!jevKey) throw new Error("--decider jev needs JEV_API_KEY. Nothing was sent.");
    decider = new JevDecisions({ apiKey: jevKey, model: "jev-latest" });
    deciderModel = "jev-latest";
  } else {
    const m = args.deciderModel;
    const cfg = aiConfig({ AI_MODEL_TRIAGE: m, AI_MODEL_DRAFT_CHECK: m, AI_MODEL_COVER_PICK: m, AI_MODEL_VENUE_PICK: m });
    decider = new OpenAiDecisions(createOpenAiLlm(openaiKey, cfg), cfg);
    deciderModel = m;
  }
  return { agent: model => createOpenAiAgentModel(openaiKey, model, "low"), llm, decider, deciderModel };
}

// ---------- features ----------

const DECISION_WORST = 2500;

async function runIdeas(args: Args, p: Providers, budget: Budget, out: unknown[]) {
  const scenarios = SCENARIOS.filter(s => !args.scenarios || args.scenarios.includes(s.id));
  const catalogTitles = IDEA_CATALOG.map(i => i.title);
  for (const model of args.models) for (const s of scenarios) for (let rep = 0; rep < args.repeat; rep++) {
    const worst = (model === "demo" ? 0 : ideasWorstCaseMicros(model)) + DECISION_WORST;
    if (!budget.allows(worst)) { console.error(`ideas ${s.id} ${model}: skipped, budget`); continue; }
    const snapshot = ideaSnapshot(signalsFor(s), CATALOG);
    const started = Date.now();
    const agent = await runIdeaAgent({ model: p.agent(model, "ideas"), maxOutputTokens: ideaOutputCeiling(model), prefetch: args.prefetch }, snapshot, { locale: s.locale });
    const agentMs = Date.now() - started;
    const u = agent.usage;
    const agentMicros = costMicros(agent.model || model, { inputTokens: u.tokensIn, cachedInputTokens: u.cachedIn, outputTokens: u.tokensOut, reasoningTokens: u.reasoning });
    budget.add(agentMicros);
    const built = buildIdeas(snapshot, agent.modelIdeas, agent.traces, s.now, s.locale);
    let ranked = built.ideas;
    let rankMicros = 0;
    let rankMs = 0;
    if (built.agentCount > 0) {
      const req = rankingRequest(built.ideas, snapshot);
      const t0 = Date.now();
      try {
        const r = await p.decider.decide({ step: "draftCheck", state: req.state, questions: req.questions });
        rankMicros = costMicros(r.model, r.usage);
        ranked = applyRanking(built.ideas, snapshot, r.answers);
      } catch { ranked = applyRanking(built.ideas, snapshot, null); }
      rankMs = Date.now() - t0;
      budget.add(rankMicros);
    }
    const checks = checkIdeas(agent.modelIdeas, agent.traces, {
      locale: s.locale, dataLevel: snapshot.summary.dataLevel, mustNotRepeat: s.mustNotRepeat, pastTitles: s.past.map(x => x[0]), catalogTitles,
    });
    out.push({
      feature: "ideas", scenario: s.id, model, rep, outcome: agent.outcome, turns: agent.turns, tools: agent.traces.map(t => t.name),
      tokensIn: u.tokensIn, tokensOut: u.tokensOut, micros: agentMicros + rankMicros, latencyMs: agentMs + rankMs, agentMs,
      checks, agentKept: built.agentCount,
      raw: agent.modelIdeas,
      final: ranked.map(i => ({ title: i.title, description: i.description, theme: i.theme, why: i.why, reasonBasis: i.reasonBasis, fitLabel: i.fitLabel ?? null, weekday: i.weekday, daypart: i.daypart, startsAt: i.startsAt, costBucket: i.costBucket, groupSize: i.groupSize, source: i.source, venueSearchHint: i.draft.venueSearchHint, considerationIds: i.considerationIds })),
    });
    console.log(`ideas  ${s.id.padEnd(22)} ${model.padEnd(13)} ${agent.outcome.padEnd(9)} turns=${agent.turns} tools=${agent.traces.length} kept=${built.agentCount} problems=${checks.problems} ${usd(agentMicros + rankMicros)} ${agentMs + rankMs} ms`);
  }
}

async function runTheme(args: Args, p: Providers, budget: Budget, out: unknown[]) {
  const scenarios = SCENARIOS.filter(s => !args.scenarios || args.scenarios.includes(s.id));
  for (const model of args.models) for (const s of scenarios) for (let rep = 0; rep < args.repeat; rep++) {
    const worst = (model === "demo" ? 0 : themeWorstCaseMicros(model)) + DECISION_WORST;
    if (!budget.allows(worst)) { console.error(`theme ${s.id} ${model}: skipped, budget`); continue; }
    const snapshot = themeSnapshot(ideaSnapshot(signalsFor(s), CATALOG), themeRecordsFor(s));
    const hint = sanitizeNote(s.themeHint);
    const started = Date.now();
    const agent = await runThemeAgent({ model: p.agent(model, "theme"), maxOutputTokens: (isReasoningModel(model) ? 3 : 1) * THEME_PRICED.outputPerTurn, prefetch: args.prefetch }, { snapshot, locale: s.locale, hint, fields: ["title", "description", "tags", "illustration"] });
    const agentMs = Date.now() - started;
    const u = agent.usage;
    const agentMicros = costMicros(agent.model || model, { inputTokens: u.tokensIn, cachedInputTokens: u.cachedIn, outputTokens: u.tokensOut, reasoningTokens: u.reasoning });
    budget.add(agentMicros);
    const ctx = { snapshot, locale: s.locale };
    let final: unknown[] = [];
    let agentKept = 0;
    let rankMicros = 0;
    let rankMs = 0;
    let moderationFlags = 0;
    if (agent.modelThemes) {
      let flagged = new Set<number>();
      try {
        const verdicts = await p.llm("gpt-4o-mini").moderate(moderationTexts(agent.modelThemes));
        flagged = new Set(agent.modelThemes.map((_, i) => i).filter(i => verdicts[i]?.flagged === true));
      } catch { /* the eval keeps going; production fails closed */ }
      moderationFlags = flagged.size;
      const built = buildThemes(ctx, agent.modelThemes, agent.traces, flagged);
      agentKept = built.agentCount;
      let ranked = built.suggestions;
      if (built.agentCount > 0) {
        const req = themeRankingRequest(built.suggestions, snapshot);
        const t0 = Date.now();
        try {
          const r = await p.decider.decide({ step: "draftCheck", state: req.state, questions: req.questions });
          rankMicros = costMicros(r.model, r.usage);
          ranked = rankThemes(built.suggestions, snapshot, r.answers);
        } catch { ranked = rankThemes(built.suggestions, snapshot, null); }
        rankMs = Date.now() - t0;
        budget.add(rankMicros);
      }
      final = ranked.map(t => ({ title: t.title, description: t.description, themeKey: t.themeKey, tagIds: t.tagIds, weekStart: t.weekStart ?? null, why: t.why, reasonBasis: t.reasonBasis, source: t.source }));
    }
    const checks = checkThemes(agent.modelThemes, agent.traces as ThemeTrace[] as never, {
      locale: s.locale, dataLevel: snapshot.idea.summary.dataLevel, mustNotRepeat: [...s.mustNotRepeat, ...s.themes.map(x => x.title)], freeWeeks: snapshot.freeWeeks,
    });
    out.push({
      feature: "theme", scenario: s.id, model, rep, outcome: agent.outcome, turns: agent.turns, tools: agent.traces.map(t => t.name), hint,
      tokensIn: u.tokensIn, tokensOut: u.tokensOut, micros: agentMicros + rankMicros, latencyMs: agentMs + rankMs, agentMs, checks, agentKept, moderationFlags,
      raw: agent.modelThemes, final,
    });
    console.log(`theme  ${s.id.padEnd(22)} ${model.padEnd(13)} ${agent.outcome.padEnd(9)} turns=${agent.turns} tools=${agent.traces.length} kept=${agentKept} problems=${checks.problems} ${usd(agentMicros + rankMicros)} ${agentMs + rankMs} ms`);
  }
}

interface DraftCase { id: string; choices: AiEventChoices; count: number; note: string; interests: { tagId: string; memberCount: number }[]; theme: { title: string; tagIds: string[] } | null; expect: { screen: "ok" | "flag" }; focus: string; locale?: "en" | "es" }

function draftCases(args: Args): DraftCase[] {
  const base = JSON.parse(readFileSync(join(HERE, "..", "cases.json"), "utf8")) as DraftCase[];
  const extra = JSON.parse(readFileSync(join(HERE, "draft-cases.json"), "utf8")) as DraftCase[];
  return [...base, ...extra].filter(c => !args.cases || args.cases.includes(c.id));
}

async function runDrafts(args: Args, p: Providers, budget: Budget, out: unknown[]) {
  const now = new Date("2026-11-26T15:00:00Z");
  const catalogIds = CATALOG.map(t => t.id);
  for (const model of args.models) for (const c of draftCases(args).filter(x => x.expect.screen === "ok")) {
    const worst = model === "demo" ? 0 : 2 * costMicros(model, { inputTokens: 6000, cachedInputTokens: 0, outputTokens: outputCeiling("generate", model), reasoningTokens: 0 });
    if (!budget.allows(worst)) { console.error(`drafts ${c.id}: skipped, budget`); continue; }
    const note = sanitizeNote(c.note);
    const interests = summarizeInterests(c.interests.length > 0 ? c.interests : null, CATALOG);
    const locale = c.locale ?? "en";
    const input = buildGenerateUserContent({
      choices: c.choices, count: c.count, note, catalog: CATALOG, topInterests: interests.top, thinTagIds: interests.thinTagIds.slice(0, 8), theme: c.theme, now,
      locale,
    });
    const schema = modelDraftsSchema(catalogIds, { count: c.count, choices: c.choices });
    const context = { count: c.count, choices: c.choices, catalogIds: new Set(catalogIds), catalogNames: new Map(CATALOG.map(t => [t.id, t.name])) };
    const started = Date.now();
    let micros = 0; let tokensIn = 0; let tokensOut = 0; let attempts = 0; let valid = false; let raw: Array<Record<string, unknown>> = []; let error: string | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      attempts = attempt;
      try {
        const o = await p.llm(model).generate({ step: "generate", instructions: GENERATE_SYSTEM_PROMPT, input, schema, schemaName: "event_drafts", maxOutputTokens: outputCeiling("generate", model) });
        micros += costMicros(o.model, o.usage); tokensIn += o.usage.inputTokens; tokensOut += o.usage.outputTokens;
        if (o.kind !== "ok") { error = o.kind; if (o.kind === "refusal") break; continue; }
        raw = ((o.value as { drafts?: unknown[] }).drafts ?? []) as Array<Record<string, unknown>>;
        try { valid = parseModelDrafts(o.value, context).length === c.count; error = null; break; } catch (e) { error = e instanceof InvalidModelOutput ? e.message : "unexpected"; }
      } catch (e) { error = errName(e); break; }
    }
    budget.add(micros);
    const latencyMs = Date.now() - started;
    const allowAlcohol = /drink|cocktail|happy hour/i.test(c.note);
    const checks = checkDrafts(raw, { locale, expected: c.count, valid, allowAlcohol });
    out.push({ feature: "drafts", scenario: c.id, model, rep: 0, focus: c.focus, note, choices: c.choices, locale, attempts, error, tokensIn, tokensOut, micros, latencyMs, checks, raw, final: raw });
    console.log(`drafts ${c.id.padEnd(22)} ${model.padEnd(13)} valid=${valid} attempts=${attempts} problems=${checks.problems} ${usd(micros)} ${latencyMs} ms`);
  }
}

async function runTriage(args: Args, p: Providers, budget: Budget, out: unknown[]) {
  for (const c of draftCases(args)) {
    const note = sanitizeNote(c.note);
    if (note === "") continue;
    if (!budget.allows(DECISION_WORST)) break;
    const t0 = Date.now();
    let flagged = true; let reasons: string[] = []; let micros = 0; let error: string | null = null;
    try {
      const [mod] = await p.llm("gpt-4o-mini").moderate([note]);
      if (mod?.flagged) { reasons = ["moderation"]; }
      else {
        const r = await p.decider.decide({ step: "triage", state: triageState(note), questions: TRIAGE_QUESTIONS });
        micros = costMicros(r.model, r.usage);
        reasons = triageVerdict(r);
      }
      flagged = reasons.length > 0;
    } catch (e) { error = errName(e); }
    budget.add(micros);
    out.push({ feature: "triage", scenario: c.id, model: p.deciderModel, expected: c.expect.screen, flagged, correct: (c.expect.screen === "flag") === flagged, reasons, error, micros, latencyMs: Date.now() - t0 });
    console.log(`triage ${c.id.padEnd(22)} ${p.deciderModel.padEnd(13)} expected=${c.expect.screen} got=${flagged ? "flag" : "ok"} ${reasons.join(",")}`);
  }
}

async function runCover(args: Args, p: Providers, budget: Budget, out: unknown[]) {
  for (const e of COVER_EVENTS) {
    if (!budget.allows(2 * DECISION_WORST)) break;
    const query = { title: e.title, description: e.description, tagIds: e.tagIds };
    const lexical = await pickCover({ decisions: p.decider, aiEnabled: false }, query);
    const t0 = Date.now();
    const picked = await pickCover({ decisions: p.decider, aiEnabled: true }, query);
    const latencyMs = Date.now() - t0;
    const describe = (url: string) => { const entry = coverByURL(url); return entry ? `${entry.label} | ${entry.tags.join(", ")} | ${entry.alt}` : url; };
    const hit = (url: string) => { const d = describe(url).toLowerCase(); return e.accept.some(w => d.includes(w)); };
    out.push({
      feature: "cover", scenario: e.id, model: p.deciderModel, title: e.title, source: picked.source, provider: picked.provider,
      picked: describe(picked.coverImageURL), lexical: describe(lexical.coverImageURL), pickedHit: hit(picked.coverImageURL), lexicalHit: hit(lexical.coverImageURL), latencyMs,
    });
    console.log(`cover  ${e.id.padEnd(22)} ${p.deciderModel.padEnd(13)} source=${picked.source} hit=${hit(picked.coverImageURL)} lexicalHit=${hit(lexical.coverImageURL)} ${latencyMs} ms`);
  }
}

async function runVenue(args: Args, p: Providers, budget: Budget, out: unknown[]) {
  for (const v of VENUE_CASES) {
    if (!budget.allows(DECISION_WORST)) break;
    // The heuristic order the model is offered: nearest first (production adds theme and setting points).
    const ranked: RankedVenue[] = [...v.options].sort((a, b) => a.miles - b.miles).map((o, i) => ({
      score: 10 - i,
      option: { id: `p${i}`, placeId: `p${i}`, name: o.name, address: "", locality: "", latitude: 0, longitude: 0, kind: o.kind as never, setting: o.setting, distanceMiles: o.miles, website: null, reasons: [] },
    }));
    const t0 = Date.now();
    let order = ranked.slice(0, 5); let used = false; let micros = 0; let error: string | null = null;
    try {
      const r = await p.decider.decide({ step: "venuePick", state: venueState(v.event), questions: { venue: venueQuestion(ranked) } });
      micros = costMicros(r.model, r.usage);
      ({ venues: order, used } = applyVenueAnswer(ranked, r.answers.venue));
    } catch (e) { error = errName(e); }
    budget.add(micros);
    const top = order[0]?.option.name ?? "";
    out.push({ feature: "venue", scenario: v.id, model: p.deciderModel, used, error, order: order.map(o => o.option.name), top1Hit: v.accept.includes(top), heuristicHit: v.accept.includes(ranked[0]!.option.name), micros, latencyMs: Date.now() - t0 });
    console.log(`venue  ${v.id.padEnd(22)} ${p.deciderModel.padEnd(13)} top=${top} hit=${v.accept.includes(top)}`);
  }
}

// ---------- main ----------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ledger = readLedger();
  const runCap = Math.round(args.maxUsd * 1e6);
  if (args.live) {
    console.log(`Live run: features [${args.features.join(", ")}], models [${args.models.join(", ")}], decider ${args.decider}. Run cap ${usd(runCap)}; task spend so far ${usd(ledger.totalMicros)} of ${usd(TOTAL_CAP_MICROS)}.`);
    if (!args.yes) { console.log("Nothing sent. Add --yes to run."); return; }
    if (ledger.totalMicros >= TOTAL_CAP_MICROS) throw new Error("The $5 task budget is spent. Nothing was sent.");
  } else {
    console.log("Offline: demo models, no API calls, no spend. Shows the harness and the hard checks, not model quality.");
  }
  const p = providers(args);
  const budget = new Budget(runCap, ledger.totalMicros, args.live);
  const out: unknown[] = [];
  const started = new Date();
  try {
    for (const f of args.features) {
      if (f === "ideas") await runIdeas(args, p, budget, out);
      else if (f === "theme") await runTheme(args, p, budget, out);
      else if (f === "drafts") await runDrafts(args, p, budget, out);
      else if (f === "triage") await runTriage(args, p, budget, out);
      else if (f === "cover") await runCover(args, p, budget, out);
      else await runVenue(args, p, budget, out);
    }
  } finally {
    mkdirSync(RESULTS, { recursive: true });
    const label = (args.label || (args.live ? "live" : "offline")).replace(/[^\w-]+/g, "-");
    const file = join(RESULTS, `${started.toISOString().replace(/[:.]/g, "-")}-${label}.json`);
    writeFileSync(file, `${JSON.stringify({ label, live: args.live, startedAt: started.toISOString(), models: args.models, decider: p.deciderModel, spentMicros: budget.spent, items: out }, null, 1)}\n`);
    if (args.live) {
      const next = readLedger();
      next.totalMicros += budget.spent;
      next.runs.push({ at: started.toISOString(), label, micros: budget.spent });
      writeFileSync(LEDGER, `${JSON.stringify(next, null, 1)}\n`);
    }
    console.log(`\nSpent ${usd(budget.spent)} this run${args.live ? `; task total ${usd(readLedger().totalMicros)} of ${usd(TOTAL_CAP_MICROS)}` : ""}. Results: ${file}`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

export { THEME_IDEAS };
