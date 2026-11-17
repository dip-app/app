/**
 * Prompt evaluation runner for the AI event drafts feature (issue AI-7).
 *
 * Offline (default, no key, no spend):   node --import tsx gcp/tests/ai-eval/run.ts
 * Live comparison (owner only, spends):  OPENAI_API_KEY=... node --import tsx gcp/tests/ai-eval/run.ts --live --yes
 *   with Jev as a second triage provider: add JEV_API_KEY=... and --jev
 *
 * Flags:
 *   --live                  use the real APIs. Needs env OPENAI_API_KEY; without it the run aborts before any call.
 *   --jev                   (live) also run triage and draft checks with Jev. Needs env JEV_API_KEY.
 *   --model <id>            generate model, repeatable (default gpt-6-astra and gpt-6.1-sol)
 *   --triage-model <id>     OpenAI model for the openai-mini decision provider (default gpt-6-luna)
 *   --yes                   confirm the printed maximum spend (required with --live)
 *   --generate-flagged      also run generation for cases triage flagged (tests the generate prompt against injection)
 *   --cases <id,id,...>     run only these case ids
 *   --label <text>          result file label (default "offline" or "live")
 *   --out <dir>             result directory (default gcp/tests/ai-eval/results)
 *
 * The runner builds every input with the production functions (the same path as application/generate.ts). The first
 * triage provider also gates generation and runs the draft checks; further providers are compared on triage only.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AiEventChoices, GeneratedEventDraft } from "../../functions/src/generated/models";
import type { DecisionPort, DecisionResult, LlmPort, LlmUsage } from "../../functions/src/modules/ai/application/ports";
import {
  TRIAGE_QUESTIONS, draftCheckQuestions, draftState, interpretDraftCheck, triageState, triageVerdict,
} from "../../functions/src/modules/ai/domain/decisions";
import { InvalidModelOutput, parseModelDrafts } from "../../functions/src/modules/ai/domain/drafts";
import { summarizeInterests } from "../../functions/src/modules/ai/domain/interests";
import { GENERATE_MAX_TOKENS, DECISION_MAX_TOKENS, costMicros, worstCaseMicros } from "../../functions/src/modules/ai/domain/pricing";
import { GENERATE_SYSTEM_PROMPT, buildGenerateUserContent, modelDraftsSchema } from "../../functions/src/modules/ai/domain/prompt";
import { containsContactInfo, sanitizeNote } from "../../functions/src/modules/ai/domain/request";
import { BUDGET_CENTS, GROUP_CAPACITY } from "../../functions/src/modules/ai/domain/vocabulary";
import { aiConfig, type AiConfig } from "../../functions/src/modules/ai/infrastructure/aiConfig";
import { DemoDecisions, DemoLlm } from "../../functions/src/modules/ai/infrastructure/demo";
import { DEFAULT_TAGS } from "../../functions/src/modules/ai/infrastructure/firestoreSources";
import { JevDecisions } from "../../functions/src/modules/ai/infrastructure/jevDecisions";
import { OpenAiDecisions } from "../../functions/src/modules/ai/infrastructure/openAiDecisions";
import { createOpenAiLlm } from "../../functions/src/modules/ai/infrastructure/openaiLlm";

const HERE = dirname(fileURLToPath(import.meta.url));
const THIN_IN_PROMPT = 8; // mirrors application/generate.ts
const DEFAULT_GENERATE_MODELS = ["gpt-6-astra", "gpt-6.1-sol"];
const DEFAULT_TRIAGE_MODEL = "gpt-6-luna";

interface EvalCase {
  id: string;
  choices: AiEventChoices;
  count: number;
  note: string;
  interests: { tagId: string; memberCount: number }[];
  theme: { title: string; tagIds: string[] } | null;
  expect: { screen: "ok" | "flag" };
  focus: string;
}

type CheckStatus = "pass" | "fail" | "review";
interface Checks { noContactInfo: CheckStatus; costWithinBudget: CheckStatus; capacityWithinGroup: CheckStatus; timingFits: CheckStatus; noNamedVenue: CheckStatus }

interface Provider { name: string; decisions: DecisionPort; model: string }

interface TriageResult {
  ran: boolean;
  provider: string;
  model: string;
  moderationFlagged: boolean;
  reasons: string[];
  flagged: boolean;
  error: string | null;
  expected: "ok" | "flag";
  correct: boolean;
  costMicros: number;
  latencyMs: number;
}

interface DraftCheckSummary { ran: number; unsafe: number; coverOverrides: number; avgFit: number | null; costMicros: number }

interface GenerateResult {
  ran: boolean;
  skippedReason?: string;
  outcome?: string;
  valid?: boolean;
  draftCount?: number;
  error?: string;
  checks?: Checks;
  checkNotes?: string[];
  draftChecks?: DraftCheckSummary;
  costMicros: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  model: string;
  rawDrafts?: unknown;
}

interface Row {
  caseId: string;
  model: string;
  triage: TriageResult[];
  generate: GenerateResult;
  human: { onTheme: number | null; inclusive: number | null; appealing: number | null; notes: string | null };
}

// ---------- arguments ----------

function parseArgs(argv: string[]) {
  const args = {
    live: false, yes: false, jev: false, generateFlagged: false, models: [] as string[], triageModel: DEFAULT_TRIAGE_MODEL,
    cases: null as string[] | null, label: "", out: join(HERE, "results"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value`);
      i += 1;
      return next;
    };
    if (flag === "--live") args.live = true;
    else if (flag === "--yes") args.yes = true;
    else if (flag === "--jev") args.jev = true;
    else if (flag === "--generate-flagged") args.generateFlagged = true;
    else if (flag === "--model") args.models.push(value());
    else if (flag === "--triage-model") args.triageModel = value();
    else if (flag === "--cases") args.cases = value().split(",").map(s => s.trim()).filter(Boolean);
    else if (flag === "--label") args.label = value();
    else if (flag === "--out") args.out = value();
    else throw new Error(`Unknown flag ${flag}`);
  }
  return args;
}

// ---------- rubric checks (automatic part) ----------

const VENUE_WORDS = "Cafe|Café|Bar|Park|Center|Centre|Grill|Brewery|Gym|Museum|Lounge|Bowl|Studio|Gallery|Theater|Theatre|Arena|Hotel";
const NAMED_VENUE = new RegExp(`\\b(?:[A-Z][\\w'’&-]+\\s+){1,3}(?:${VENUE_WORDS})\\b`);

const asRecords = (raw: unknown): Record<string, unknown>[] => {
  const drafts = (raw as { drafts?: unknown } | null)?.drafts;
  return Array.isArray(drafts) ? drafts.filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null) : [];
};

function runChecks(testCase: EvalCase, raw: unknown): { checks: Checks; notes: string[] } {
  const checks: Checks = { noContactInfo: "pass", costWithinBudget: "pass", capacityWithinGroup: "pass", timingFits: "pass", noNamedVenue: "pass" };
  const notes: string[] = [];
  const budget = BUDGET_CENTS[testCase.choices.budget];
  const group = GROUP_CAPACITY[testCase.choices.groupSize];
  asRecords(raw).forEach((draft, index) => {
    const at = `draft ${index + 1}`;
    const text = ["title", "description", "costNote", "venueSearchHint", "rationale"].map(k => (typeof draft[k] === "string" ? draft[k] : "")).join("\n");
    if (containsContactInfo(text)) { checks.noContactInfo = "fail"; notes.push(`${at}: link, email or phone`); }
    const cost = draft.costCents;
    if (typeof cost !== "number" || cost < budget.min || cost > budget.max) { checks.costWithinBudget = "fail"; notes.push(`${at}: costCents ${String(cost)} outside ${budget.min}-${budget.max}`); }
    const capacity = draft.capacity;
    if (typeof capacity !== "number" || capacity < group.min || capacity > group.max) { checks.capacityWithinGroup = "fail"; notes.push(`${at}: capacity ${String(capacity)} outside ${group.min}-${group.max}`); }
    if (testCase.choices.timing === "weekday_lunch") {
      const minutes = draft.durationMinutes;
      if (typeof minutes !== "number" || minutes > 75) { checks.timingFits = "fail"; notes.push(`${at}: lunch event of ${String(minutes)} minutes`); }
    }
    const venue = NAMED_VENUE.exec(`${String(draft.venueSearchHint ?? "")}\n${String(draft.title ?? "")}\n${String(draft.description ?? "")}`);
    if (venue) { checks.noNamedVenue = "review"; notes.push(`${at}: possible named venue "${venue[0]}"`); }
  });
  return { checks, notes };
}

// ---------- running ----------

const tokensIn = (u: LlmUsage) => u.inputTokens;
const errorName = (error: unknown) => (error instanceof Error ? error.name : "error");

async function triageCase(llm: LlmPort, provider: Provider, testCase: EvalCase, note: string): Promise<TriageResult> {
  const expected = testCase.expect.screen;
  const base = { provider: provider.name, model: provider.model, expected };
  if (note === "") {
    return { ...base, ran: false, moderationFlagged: false, reasons: [], flagged: false, error: null, correct: expected === "ok", costMicros: 0, latencyMs: 0 };
  }
  const started = Date.now();
  try {
    // Same order as production: free moderation, then the typed triage questions. Any error fails closed.
    const [moderation] = await llm.moderate([note]);
    if (moderation?.flagged) {
      return { ...base, ran: true, moderationFlagged: true, reasons: [], flagged: true, error: null, correct: expected === "flag", costMicros: 0, latencyMs: Date.now() - started };
    }
    const result: DecisionResult = await provider.decisions.decide({ step: "triage", state: triageState(note), questions: TRIAGE_QUESTIONS });
    const reasons = triageVerdict(result);
    const flagged = reasons.length > 0;
    return {
      ...base, ran: true, moderationFlagged: false, reasons, flagged, error: null, correct: expected === "flag" ? flagged : !flagged,
      costMicros: costMicros(result.model, result.usage), latencyMs: Date.now() - started,
    };
  } catch (error) {
    return { ...base, ran: true, moderationFlagged: false, reasons: [], flagged: true, error: errorName(error), correct: expected === "flag", costMicros: 0, latencyMs: Date.now() - started };
  }
}

async function checkDrafts(provider: Provider, testCase: EvalCase, drafts: GeneratedEventDraft[]): Promise<DraftCheckSummary> {
  const focus = DEFAULT_TAGS.filter(tag => testCase.choices.focusTagIds.includes(tag.id));
  const questions = draftCheckQuestions(testCase.choices, focus);
  const summary: DraftCheckSummary = { ran: 0, unsafe: 0, coverOverrides: 0, avgFit: null, costMicros: 0 };
  const fits: number[] = [];
  for (const draft of drafts) {
    try {
      const result = await provider.decisions.decide({ step: "draftCheck", state: draftState(draft), questions });
      const check = interpretDraftCheck(result.answers);
      summary.ran += 1;
      summary.costMicros += costMicros(result.model, result.usage);
      if (check.unsafe) summary.unsafe += 1;
      if (check.cover && `catalog://default/${check.cover}` !== draft.coverImageURL) summary.coverOverrides += 1;
      if (check.fit !== null) fits.push(check.fit);
    } catch {
      // Production keeps the draft when a check fails; the eval just does not count it.
    }
  }
  summary.avgFit = fits.length > 0 ? fits.reduce((a, b) => a + b, 0) / fits.length : null;
  return summary;
}

async function generateCase(llm: LlmPort, provider: Provider, testCase: EvalCase, note: string, model: string, now: Date): Promise<GenerateResult> {
  const catalog = DEFAULT_TAGS;
  const catalogIds = catalog.map(tag => tag.id);
  const interests = summarizeInterests(testCase.interests.length > 0 ? testCase.interests : null, catalog);
  const input = buildGenerateUserContent({
    choices: testCase.choices, count: testCase.count, note, catalog, topInterests: interests.top,
    thinTagIds: interests.thinTagIds.slice(0, THIN_IN_PROMPT), theme: testCase.theme, now,
  });
  const started = Date.now();
  let outcome;
  try {
    outcome = await llm.generate({
      step: "generate", instructions: GENERATE_SYSTEM_PROMPT, input, schema: modelDraftsSchema(catalogIds), schemaName: "event_drafts", maxOutputTokens: GENERATE_MAX_TOKENS,
    });
  } catch (error) {
    return { ran: true, outcome: errorName(error), valid: false, error: errorName(error), costMicros: 0, tokensIn: 0, tokensOut: 0, latencyMs: Date.now() - started, model };
  }
  const latencyMs = Date.now() - started;
  const common = { ran: true, latencyMs, model: outcome.model, outcome: outcome.kind, costMicros: costMicros(outcome.model, outcome.usage), tokensIn: tokensIn(outcome.usage), tokensOut: outcome.usage.outputTokens };
  if (outcome.kind !== "ok") return { ...common, valid: false, error: outcome.kind };
  const { checks, notes } = runChecks(testCase, outcome.value);
  let drafts: GeneratedEventDraft[] = [];
  let parseError: string | undefined;
  try {
    drafts = parseModelDrafts(outcome.value, { count: testCase.count, choices: testCase.choices, catalogIds: new Set(catalogIds) });
  } catch (e) {
    parseError = e instanceof InvalidModelOutput ? e.message : "unexpected";
  }
  const valid = !parseError && drafts.length === testCase.count;
  const draftChecks = drafts.length > 0 ? await checkDrafts(provider, testCase, drafts) : undefined;
  return {
    ...common, valid, draftCount: drafts.length,
    ...(parseError ? { error: parseError } : drafts.length !== testCase.count ? { error: `got ${drafts.length} of ${testCase.count} drafts` } : {}),
    checks, checkNotes: notes, ...(draftChecks ? { draftChecks } : {}), rawDrafts: asRecords(outcome.value),
  };
}

// ---------- reporting ----------

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((100 * n) / d)}%`);
const usd = (micros: number) => `$${(micros / 1e6).toFixed(4)}`;
const avg = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

function summarizeGenerate(rows: Row[], models: string[]) {
  return models.map(model => {
    const mine = rows.filter(r => r.model === model && r.generate.ran);
    const autoFails = mine.filter(r => r.generate.checks && Object.values(r.generate.checks).includes("fail")).length;
    const review = mine.filter(r => r.generate.checks && Object.values(r.generate.checks).includes("review")).length;
    return {
      model,
      generations: mine.length,
      validPct: pct(mine.filter(r => r.generate.valid).length, mine.length),
      autoCheckFailures: autoFails,
      namedVenueReviews: review,
      avgCostPerGenerationUsd: usd(avg(mine.map(r => r.generate.costMicros + (r.generate.draftChecks?.costMicros ?? 0)))),
      avgLatencyMs: Math.round(avg(mine.map(r => r.generate.latencyMs))),
    };
  });
}

function summarizeTriage(rows: Row[], providers: Provider[]) {
  return providers.map(provider => {
    const mine = rows.filter(r => r.model === rows[0]?.model).flatMap(r => r.triage.filter(t => t.provider === provider.name));
    const ran = mine.filter(t => t.ran);
    return {
      provider: provider.name,
      model: provider.model,
      cases: mine.length,
      accuracyPct: pct(mine.filter(t => t.correct).length, mine.length),
      errors: mine.filter(t => t.error !== null).length,
      avgCostPerNoteUsd: usd(avg(ran.map(t => t.costMicros))),
      avgLatencyMs: Math.round(avg(ran.map(t => t.latencyMs))),
    };
  });
}

function printTable(head: string[], lines: string[][]) {
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map(l => l[i]!.length)));
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  console.log(fmt(head));
  console.log(widths.map(w => "-".repeat(w)).join("  "));
  for (const line of lines) console.log(fmt(line));
}

// ---------- main ----------

function maximumSpend(cases: number, models: string[], config: (model: string) => AiConfig, extraTriageModels: string[]): number {
  let total = 0;
  for (const model of models) {
    const c = config(model);
    total += cases * worstCaseMicros({ models: { generate: c.generate.model, triage: c.triage.openaiModel, draftCheck: c.draftCheck.openaiModel, moderation: c.moderation.model } });
  }
  for (const triageModel of extraTriageModels) total += cases * costMicros(triageModel, { inputTokens: 2000, cachedInputTokens: 0, outputTokens: DECISION_MAX_TOKENS, reasoningTokens: 0 });
  return total;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const all = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8")) as EvalCase[];
  const cases = args.cases ? all.filter(c => args.cases!.includes(c.id)) : all;
  if (cases.length === 0) throw new Error("No cases selected");

  const configFor = (model: string): AiConfig => aiConfig({ AI_MODEL_GENERATE: model, AI_MODEL_TRIAGE: args.triageModel, AI_MODEL_DRAFT_CHECK: args.triageModel });
  const models = args.live ? (args.models.length > 0 ? args.models : DEFAULT_GENERATE_MODELS) : ["demo"];
  let maxMicros = 0;
  let moderationLlm: LlmPort = new DemoLlm();
  const generateLlms = new Map<string, LlmPort>(models.map(m => [m, new DemoLlm()]));
  let providers: Provider[] = [{ name: "demo", decisions: new DemoDecisions(), model: "demo" }];

  if (args.live) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) throw new Error("--live needs the OPENAI_API_KEY environment variable. Nothing was sent.");
    const jevKey = process.env.JEV_API_KEY;
    if (args.jev && !jevKey) throw new Error("--jev needs the JEV_API_KEY environment variable. Nothing was sent.");
    const config = configFor(models[0]!);
    const extra = args.jev ? [config.triage.jevModel] : [];
    maxMicros = maximumSpend(cases.length, models, configFor, extra);
    console.log(`Live run: ${cases.length} cases x ${models.length} generate model(s) [${models.join(", ")}], triage providers [openai-mini (${args.triageModel})${args.jev ? `, jev (${config.triage.jevModel})` : ""}].`);
    console.log(`Estimated MAXIMUM spend: ${usd(maxMicros)} (worst case per generation: one triage call, two full-length drafting calls and three draft checks; typical spend is far lower).`);
    if (!args.yes) {
      console.log("Not spending anything. Re-run with --yes to confirm this maximum.");
      return;
    }
    moderationLlm = createOpenAiLlm(openaiKey, config);
    for (const model of models) generateLlms.set(model, createOpenAiLlm(openaiKey, configFor(model)));
    providers = [{ name: "openai-mini", decisions: new OpenAiDecisions(moderationLlm, config), model: args.triageModel }];
    if (args.jev) providers.push({ name: "jev", decisions: new JevDecisions({ apiKey: jevKey!, model: config.triage.jevModel }), model: config.triage.jevModel });
  } else {
    console.log("Offline mode: DemoLlm and DemoDecisions, no API calls, no spend. Numbers show the harness and prompt plumbing, not model quality.");
    const live = maximumSpend(cases.length, DEFAULT_GENERATE_MODELS, configFor, [aiConfig({}).triage.jevModel]);
    console.log(`For reference, a live run with the defaults and --jev would have a maximum spend of ${usd(live)}.`);
  }

  const now = new Date();
  const primary = providers[0]!;
  const rows: Row[] = [];
  let spent = 0;
  for (const testCase of cases) {
    if (args.live && spent > maxMicros) {
      console.error(`Stopping: spend ${usd(spent)} exceeded the confirmed maximum ${usd(maxMicros)}.`);
      break;
    }
    const note = sanitizeNote(testCase.note);
    const triage: TriageResult[] = [];
    for (const provider of providers) triage.push(await triageCase(moderationLlm, provider, testCase, note));
    spent += triage.reduce((sum, t) => sum + t.costMicros, 0);
    const gate = triage[0]!;
    const allowed = !gate.flagged;
    for (const model of models) {
      let generate: GenerateResult;
      if (allowed || args.generateFlagged) {
        generate = await generateCase(generateLlms.get(model)!, primary, testCase, note, model, now);
      } else {
        generate = { ran: false, skippedReason: "flagged by triage", costMicros: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0, model };
      }
      spent += generate.costMicros + (generate.draftChecks?.costMicros ?? 0);
      rows.push({ caseId: testCase.id, model, triage, generate, human: { onTheme: null, inclusive: null, appealing: null, notes: null } });
      const verdicts = triage.map(t => `${t.provider}=${t.ran ? (t.flagged ? "flag" : "ok") : "skipped"}${t.correct ? "" : " (WRONG)"}`).join(" ");
      console.log(`${testCase.id.padEnd(8)} ${model.padEnd(14)} triage ${verdicts} ` +
        (generate.ran ? `valid=${generate.valid} cost=${usd(generate.costMicros)}${generate.checkNotes?.length ? ` notes=${generate.checkNotes.length}` : ""}` : "not generated"));
    }
  }

  const generateSummary = summarizeGenerate(rows, models);
  const triageSummary = summarizeTriage(rows, providers);
  console.log("");
  printTable(
    ["model", "gens", "valid", "auto fails", "venue review", "avg cost/gen", "avg latency"],
    generateSummary.map(s => [s.model, String(s.generations), s.validPct, String(s.autoCheckFailures), String(s.namedVenueReviews), s.avgCostPerGenerationUsd, `${s.avgLatencyMs} ms`]),
  );
  console.log("");
  printTable(
    ["triage provider", "model", "cases", "accuracy", "errors", "avg cost/note", "avg latency"],
    triageSummary.map(s => [s.provider, s.model, String(s.cases), s.accuracyPct, String(s.errors), s.avgCostPerNoteUsd, `${s.avgLatencyMs} ms`]),
  );
  console.log("");
  console.log("Valid = parseModelDrafts succeeds and returns the requested number of drafts. Triage accuracy covers all cases (empty notes skip triage). A triage error counts as flagged, as in production.");
  console.log("Human rubric columns (onTheme, inclusive, appealing) are null in the result file; fill them in by hand.");

  mkdirSync(args.out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const label = (args.label || (args.live ? "live" : "offline")).replace(/[^\w-]+/g, "-");
  const file = join(args.out, `${stamp}-${label}.json`);
  writeFileSync(file, JSON.stringify({
    mode: args.live ? "live" : "offline", startedAt: now.toISOString(), models, providers: providers.map(p => ({ name: p.name, model: p.model })),
    generateSummary, triageSummary, rows,
  }, null, 1) + "\n");
  console.log(`Results written to ${file}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
