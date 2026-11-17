/**
 * Prompt evaluation runner for the AI event drafts feature (issue AI-7).
 *
 * Offline (default, no key, no spend):   node --import tsx gcp/tests/ai-eval/run.ts
 * Live comparison (owner only, spends):  ANTHROPIC_API_KEY=... node --import tsx gcp/tests/ai-eval/run.ts --live --yes
 *
 * Flags:
 *   --live                  use the real Anthropic API. Needs env ANTHROPIC_API_KEY; without it the run aborts.
 *   --model <id>            generate model, repeatable (default claude-haiku-5-5 and claude-sonnet-5-5)
 *   --screen-model <id>     screen model (default claude-haiku-5-5)
 *   --yes                   confirm the printed maximum spend (required with --live)
 *   --generate-flagged      also run generation for cases the screen flagged (tests the generate prompt against injection)
 *   --cases <id,id,...>     run only these case ids
 *   --label <text>          result file label (default "offline" or "live")
 *   --out <dir>             result directory (default gcp/tests/ai-eval/results)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AiEventChoices, GeneratedEventDraft } from "../../functions/src/generated/models";
import type { LlmOutcome, LlmPort, LlmUsage } from "../../functions/src/modules/ai/application/ports";
import {
  GENERATE_SYSTEM_PROMPT, SCREEN_OUTPUT_SCHEMA, SCREEN_SYSTEM_PROMPT, buildGenerateUserContent, buildScreenUserContent, generateOutputSchema,
} from "../../functions/src/modules/ai/domain/prompt";
import { InvalidModelOutput, parseModelDrafts } from "../../functions/src/modules/ai/domain/drafts";
import { summarizeInterests } from "../../functions/src/modules/ai/domain/interests";
import { GENERATE_MAX_TOKENS, SCREEN_MAX_TOKENS, costMicros, worstCaseMicros } from "../../functions/src/modules/ai/domain/pricing";
import { containsContactInfo, sanitizeNote } from "../../functions/src/modules/ai/domain/request";
import { BUDGET_CENTS, GROUP_CAPACITY } from "../../functions/src/modules/ai/domain/vocabulary";
import { DemoLlm } from "../../functions/src/modules/ai/infrastructure/fakeLlm";
import { DEFAULT_TAGS } from "../../functions/src/modules/ai/infrastructure/firestoreSources";

const HERE = dirname(fileURLToPath(import.meta.url));
const THIN_IN_PROMPT = 8; // mirrors application/generate.ts
const DEFAULT_GENERATE_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5"];
const DEFAULT_SCREEN_MODEL = "claude-haiku-5-5";

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

interface ScreenResult {
  ran: boolean;
  kind: string;
  verdict: string | null;
  expected: "ok" | "flag";
  correct: boolean;
  costMicros: number;
  latencyMs: number;
  model: string;
}

interface GenerateResult {
  ran: boolean;
  skippedReason?: string;
  outcome?: string;
  valid?: boolean;
  draftCount?: number;
  error?: string;
  checks?: Checks;
  checkNotes?: string[];
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
  screen: ScreenResult;
  generate: GenerateResult;
  human: { onTheme: number | null; inclusive: number | null; appealing: number | null; notes: string | null };
}

// ---------- arguments ----------

function parseArgs(argv: string[]) {
  const args = { live: false, yes: false, generateFlagged: false, models: [] as string[], screenModel: DEFAULT_SCREEN_MODEL, cases: null as string[] | null, label: "", out: join(HERE, "results") };
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
    else if (flag === "--generate-flagged") args.generateFlagged = true;
    else if (flag === "--model") args.models.push(value());
    else if (flag === "--screen-model") args.screenModel = value();
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

const tokensIn = (u: LlmUsage) => u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;

async function timed(llm: LlmPort, request: Parameters<LlmPort["complete"]>[0]): Promise<{ outcome: LlmOutcome | null; error: string | null; ms: number }> {
  const started = Date.now();
  try {
    return { outcome: await llm.complete(request), error: null, ms: Date.now() - started };
  } catch (error) {
    return { outcome: null, error: error instanceof Error ? error.name : "error", ms: Date.now() - started };
  }
}

async function screenCase(llm: LlmPort, testCase: EvalCase, note: string, screenModel: string): Promise<ScreenResult> {
  const expected = testCase.expect.screen;
  if (note === "") return { ran: false, kind: "skipped", verdict: null, expected, correct: expected === "ok", costMicros: 0, latencyMs: 0, model: screenModel };
  const { outcome, error, ms } = await timed(llm, {
    purpose: "screen", system: SCREEN_SYSTEM_PROMPT, user: buildScreenUserContent(note), schema: SCREEN_OUTPUT_SCHEMA, maxTokens: SCREEN_MAX_TOKENS,
  });
  if (!outcome) return { ran: true, kind: error ?? "error", verdict: null, expected, correct: false, costMicros: 0, latencyMs: ms, model: screenModel };
  const verdict = outcome.kind === "ok" ? ((outcome.json as { verdict?: unknown } | null)?.verdict ?? null) : null;
  const verdictText = typeof verdict === "string" ? verdict : null;
  // Production fails closed: only an explicit "ok" lets the note through; a refusal counts as flagged.
  const flagged = outcome.kind === "refusal" || (outcome.kind === "ok" && verdictText !== "ok");
  const passed = outcome.kind === "ok" && verdictText === "ok";
  const correct = expected === "flag" ? flagged : passed;
  return { ran: true, kind: outcome.kind, verdict: verdictText, expected, correct, costMicros: costMicros(outcome.model, outcome.usage), latencyMs: ms, model: outcome.model };
}

async function generateCase(llm: LlmPort, testCase: EvalCase, note: string, model: string, now: Date): Promise<GenerateResult> {
  const catalog = DEFAULT_TAGS;
  const catalogIds = catalog.map(tag => tag.id);
  const interests = summarizeInterests(testCase.interests.length > 0 ? testCase.interests : null, catalog);
  const user = buildGenerateUserContent({
    choices: testCase.choices, count: testCase.count, note, catalog, topInterests: interests.top,
    thinTagIds: interests.thinTagIds.slice(0, THIN_IN_PROMPT), theme: testCase.theme, now,
  });
  const { outcome, error, ms } = await timed(llm, {
    purpose: "generate", system: GENERATE_SYSTEM_PROMPT, user, schema: generateOutputSchema(catalogIds), maxTokens: GENERATE_MAX_TOKENS,
  });
  const base = { ran: true, latencyMs: ms, model };
  if (!outcome) return { ...base, outcome: error ?? "error", valid: false, error: error ?? "error", costMicros: 0, tokensIn: 0, tokensOut: 0 };
  const cost = costMicros(outcome.model, outcome.usage);
  const common = { ...base, model: outcome.model, outcome: outcome.kind, costMicros: cost, tokensIn: tokensIn(outcome.usage), tokensOut: outcome.usage.outputTokens };
  if (outcome.kind !== "ok") return { ...common, valid: false, error: outcome.kind };
  const { checks, notes } = runChecks(testCase, outcome.json);
  let drafts: GeneratedEventDraft[] = [];
  let parseError: string | undefined;
  try {
    drafts = parseModelDrafts(outcome.json, { count: testCase.count, choices: testCase.choices, catalogIds: new Set(catalogIds) });
  } catch (e) {
    parseError = e instanceof InvalidModelOutput ? e.message : "unexpected";
  }
  const valid = !parseError && drafts.length === testCase.count;
  return {
    ...common, valid, draftCount: drafts.length, ...(parseError ? { error: parseError } : drafts.length !== testCase.count ? { error: `got ${drafts.length} of ${testCase.count} drafts` } : {}),
    checks, checkNotes: notes, rawDrafts: asRecords(outcome.json),
  };
}

// ---------- reporting ----------

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((100 * n) / d)}%`);
const usd = (micros: number) => `$${(micros / 1e6).toFixed(4)}`;
const avg = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

function summarize(rows: Row[], models: string[], screenModel: string) {
  return models.map(model => {
    const mine = rows.filter(r => r.model === model);
    const generated = mine.filter(r => r.generate.ran);
    const autoFails = generated.filter(r => r.generate.checks && Object.values(r.generate.checks).includes("fail")).length;
    const review = generated.filter(r => r.generate.checks && Object.values(r.generate.checks).includes("review")).length;
    return {
      model,
      cases: mine.length,
      generations: generated.length,
      validPct: pct(generated.filter(r => r.generate.valid).length, generated.length),
      screenAccuracyPct: pct(mine.filter(r => r.screen.correct).length, mine.length),
      autoCheckFailures: autoFails,
      namedVenueReviews: review,
      avgCostPerGenerationUsd: usd(avg(generated.map(r => r.generate.costMicros + r.screen.costMicros))),
      avgLatencyMs: Math.round(avg(generated.map(r => r.generate.latencyMs))),
      screenModel,
    };
  });
}

function printTable(summary: ReturnType<typeof summarize>) {
  const head = ["model", "gens", "valid", "screen acc", "auto fails", "venue review", "avg cost/gen", "avg latency"];
  const lines = summary.map(s => [s.model, String(s.generations), s.validPct, s.screenAccuracyPct, String(s.autoCheckFailures), String(s.namedVenueReviews), s.avgCostPerGenerationUsd, `${s.avgLatencyMs} ms`]);
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map(l => l[i]!.length)));
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  console.log(fmt(head));
  console.log(widths.map(w => "-".repeat(w)).join("  "));
  for (const line of lines) console.log(fmt(line));
}

// ---------- main ----------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const all = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8")) as EvalCase[];
  const cases = args.cases ? all.filter(c => args.cases!.includes(c.id)) : all;
  if (cases.length === 0) throw new Error("No cases selected");

  const models = args.live ? (args.models.length > 0 ? args.models : DEFAULT_GENERATE_MODELS) : ["demo-fake"];
  let maxMicros = 0;
  let screenLlm: LlmPort = new DemoLlm();
  const generateLlms = new Map<string, LlmPort>(models.map(m => [m, new DemoLlm()]));

  if (args.live) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("--live needs the ANTHROPIC_API_KEY environment variable. Nothing was sent.");
    const estimate = models.reduce((sum, model) => sum + cases.length * worstCaseMicros({ generateModel: model, screenModel: args.screenModel }), 0);
    console.log(`Live run: ${cases.length} cases x ${models.length} model(s) [${models.join(", ")}], screen model ${args.screenModel}.`);
    maxMicros = estimate;
    console.log(`Estimated MAXIMUM spend: ${usd(estimate)} (worst case per generation: one screen call plus two full-length generate calls; typical spend is far lower).`);
    if (!args.yes) {
      console.log("Not spending anything. Re-run with --yes to confirm this maximum.");
      return;
    }
    const { createAnthropicLlm } = await import("../../functions/src/modules/ai/infrastructure/anthropicLlm");
    screenLlm = createAnthropicLlm(apiKey, { generateModel: models[0]!, screenModel: args.screenModel });
    for (const model of models) generateLlms.set(model, createAnthropicLlm(apiKey, { generateModel: model, screenModel: args.screenModel }));
  } else {
    console.log("Offline mode: DemoLlm, no API calls, no spend. Numbers show the harness and prompt plumbing, not model quality.");
  }

  const now = new Date();
  const screenModel = args.live ? args.screenModel : "demo-fake";
  const rows: Row[] = [];
  let spent = 0;
  for (const testCase of cases) {
    if (args.live && spent > maxMicros) {
      console.error(`Stopping: spend ${usd(spent)} exceeded the confirmed maximum ${usd(maxMicros)}.`);
      break;
    }
    const note = sanitizeNote(testCase.note);
    const screen = await screenCase(screenLlm, testCase, note, screenModel);
    const screenAllows = !screen.ran || screen.verdict === "ok";
    for (const model of models) {
      let generate: GenerateResult;
      if (screenAllows || args.generateFlagged) {
        generate = await generateCase(generateLlms.get(model)!, testCase, note, model, now);
      } else {
        generate = { ran: false, skippedReason: "flagged by screen", costMicros: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0, model };
      }
      spent += generate.costMicros + (model === models[0] ? screen.costMicros : 0);
      rows.push({ caseId: testCase.id, model, screen, generate, human: { onTheme: null, inclusive: null, appealing: null, notes: null } });
      console.log(`${testCase.id.padEnd(8)} ${model.padEnd(20)} screen=${screen.ran ? screen.verdict ?? screen.kind : "skipped"}${screen.correct ? "" : " (WRONG)"} ` +
        (generate.ran ? `valid=${generate.valid} cost=${usd(generate.costMicros)}${generate.checkNotes?.length ? ` notes=${generate.checkNotes.length}` : ""}` : "not generated"));
    }
  }

  const summary = summarize(rows, models, screenModel);
  console.log("");
  printTable(summary);
  console.log("");
  console.log("Valid = parseModelDrafts succeeds and returns the requested number of drafts. Screen accuracy covers all cases (empty notes skip the screen).");
  console.log("Human rubric columns (onTheme, inclusive, appealing) are null in the result file; fill them in by hand.");

  mkdirSync(args.out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const label = (args.label || (args.live ? "live" : "offline")).replace(/[^\w-]+/g, "-");
  const file = join(args.out, `${stamp}-${label}.json`);
  writeFileSync(file, JSON.stringify({ mode: args.live ? "live" : "offline", startedAt: now.toISOString(), models, screenModel, summary, rows }, null, 1) + "\n");
  console.log(`Results written to ${file}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
