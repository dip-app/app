/**
 * Prompt evaluation runner for the AI event drafts feature (issue AI-7).
 *
 * Offline (default, no key, no spend):   node --import tsx gcp/tests/ai-eval/run.ts
 * Live (owner-approved, spends, ONCE):    node --env-file=<private env file> --import tsx gcp/tests/ai-eval/run.ts --live --jev --yes
 *   The env file (for example the gitignored .secrets-cache/out/functions.env from scripts/secrets/pull.sh --only backend)
 *   supplies OPENAI_API_KEY and JEV_API_KEY. Keys are only read from the environment and are never printed or stored.
 *
 * Flags:
 *   --live                  use the real APIs. Needs env OPENAI_API_KEY; without it the run aborts before any call.
 *   --jev                   (live) Jev answers triage and draft checks (the production default); the OpenAI model is
 *                           compared on the same questions. Needs env JEV_API_KEY.
 *   --model <id>            generate model, repeatable (default gpt-4o-mini)
 *   --triage-model <id>     OpenAI decision model (default gpt-4o-mini)
 *   --max-usd <n>           hard spend cap, at most 1 (default 1). The run stops before any case whose worst case would
 *                           pass it, and after any case whose actual spend passed it.
 *   --yes                   confirm the printed maximum spend (required with --live)
 *   --allow-rerun           permit a second live run (a lock file in the result directory blocks it by default)
 *   --generate-flagged      also run generation for cases triage flagged (tests the generate prompt against injection)
 *   --cases <id,id,...>     run only these case ids
 *   --label <text>          result file label (default "offline" or "live")
 *   --out <dir>             result directory (default gcp/tests/ai-eval/results, git-ignored)
 *
 * The runner builds every input with the production functions (the same path as application/generate.ts): the bounded
 * output schema, the small-model output ceiling, one retry on invalid output, free moderation of note and drafts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AiEventChoices, GeneratedEventDraft } from "../../functions/src/generated/models";
import type { DecisionPort, DecisionResult, LlmPort } from "../../functions/src/modules/ai/application/ports";
import { LlmUnavailableError } from "../../functions/src/modules/ai/application/ports";
import {
  TRIAGE_QUESTIONS, draftCheckQuestions, draftState, interpretDraftCheck, triageState, triageVerdict,
} from "../../functions/src/modules/ai/domain/decisions";
import { InvalidModelOutput, parseModelDrafts } from "../../functions/src/modules/ai/domain/drafts";
import { summarizeInterests } from "../../functions/src/modules/ai/domain/interests";
import { costMicros, outputCeiling, worstCaseMicros } from "../../functions/src/modules/ai/domain/pricing";
import { GENERATE_SYSTEM_PROMPT, buildGenerateUserContent, modelDraftsSchema } from "../../functions/src/modules/ai/domain/prompt";
import { containsContactInfo, sanitizeNote } from "../../functions/src/modules/ai/domain/request";
import { BUDGET_CENTS, GROUP_CAPACITY } from "../../functions/src/modules/ai/domain/vocabulary";
import { DEFAULT_DECISION_MODEL, DEFAULT_GENERATE_MODEL, aiConfig, type AiConfig } from "../../functions/src/modules/ai/infrastructure/aiConfig";
import { DemoDecisions, DemoLlm } from "../../functions/src/modules/ai/infrastructure/demo";
import { DEFAULT_TAGS } from "../../functions/src/modules/ai/infrastructure/firestoreSources";
import { JevDecisions } from "../../functions/src/modules/ai/infrastructure/jevDecisions";
import { OpenAiDecisions } from "../../functions/src/modules/ai/infrastructure/openAiDecisions";
import { createOpenAiLlm } from "../../functions/src/modules/ai/infrastructure/openaiLlm";

const HERE = dirname(fileURLToPath(import.meta.url));
const THIN_IN_PROMPT = 8; // mirrors application/generate.ts
const HARD_CAP_USD = 1;
const LOCK_FILE = ".live-run-lock";

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
  /** Raw Noul answers per question (for calibration), null when not answered. */
  nouls: Record<string, number> | null;
  flagged: boolean;
  error: string | null;
  expected: "ok" | "flag";
  correct: boolean;
  costMicros: number;
  latencyMs: number;
}

interface DraftCheckSummary { provider: string; ran: number; errors: number; unsafe: number; coverOverrides: number; avgFit: number | null; costMicros: number; latencyMs: number; covers: (string | null)[]; unsafeFlags: boolean[] }

interface GenerateResult {
  ran: boolean;
  skippedReason?: string;
  outcome?: string;
  attempts?: number;
  firstAttemptValid?: boolean;
  valid?: boolean;
  draftCount?: number;
  error?: string;
  checks?: Checks;
  checkNotes?: string[];
  outputModerationFlags?: number;
  draftChecks?: DraftCheckSummary[];
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
    live: false, yes: false, jev: false, allowRerun: false, generateFlagged: false, models: [] as string[], triageModel: DEFAULT_DECISION_MODEL,
    maxUsd: HARD_CAP_USD, cases: null as string[] | null, label: "", out: join(HERE, "results"),
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
    else if (flag === "--allow-rerun") args.allowRerun = true;
    else if (flag === "--generate-flagged") args.generateFlagged = true;
    else if (flag === "--model") args.models.push(value());
    else if (flag === "--triage-model") args.triageModel = value();
    else if (flag === "--max-usd") args.maxUsd = Number(value());
    else if (flag === "--cases") args.cases = value().split(",").map(s => s.trim()).filter(Boolean);
    else if (flag === "--label") args.label = value();
    else if (flag === "--out") args.out = value();
    else throw new Error(`Unknown flag ${flag}`);
  }
  if (!Number.isFinite(args.maxUsd) || args.maxUsd <= 0 || args.maxUsd > HARD_CAP_USD) throw new Error(`--max-usd must be above 0 and at most ${HARD_CAP_USD}`);
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

/** Error kind and HTTP status only; never a provider message (it can echo request data). */
const errorName = (error: unknown) =>
  (error instanceof LlmUnavailableError ? `unavailable_${error.status ?? "network"}` : error instanceof Error ? error.name : "error");

async function triageCase(llm: LlmPort, provider: Provider, testCase: EvalCase, note: string): Promise<TriageResult> {
  const expected = testCase.expect.screen;
  const base = { provider: provider.name, model: provider.model, expected };
  if (note === "") {
    return { ...base, ran: false, moderationFlagged: false, reasons: [], nouls: null, flagged: false, error: null, correct: expected === "ok", costMicros: 0, latencyMs: 0 };
  }
  const started = Date.now();
  try {
    // Same order as production: free moderation, then the typed triage questions. Any error fails closed here.
    const [moderation] = await llm.moderate([note]);
    if (moderation?.flagged) {
      return { ...base, ran: true, moderationFlagged: true, reasons: [], nouls: null, flagged: true, error: null, correct: expected === "flag", costMicros: 0, latencyMs: Date.now() - started };
    }
    const decideStarted = Date.now();
    const result: DecisionResult = await provider.decisions.decide({ step: "triage", state: triageState(note), questions: TRIAGE_QUESTIONS });
    const reasons = triageVerdict(result);
    const flagged = reasons.length > 0;
    const nouls = Object.fromEntries(Object.entries(result.answers).flatMap(([k, a]) => (a.type === "noul" ? [[k, Math.round(a.noul * 1000) / 1000]] : [])));
    return {
      ...base, model: result.model, ran: true, moderationFlagged: false, reasons, nouls, flagged, error: null, correct: expected === "flag" ? flagged : !flagged,
      costMicros: costMicros(result.model, result.usage), latencyMs: Date.now() - decideStarted,
    };
  } catch (error) {
    return { ...base, ran: true, moderationFlagged: false, reasons: [], nouls: null, flagged: true, error: errorName(error), correct: expected === "flag", costMicros: 0, latencyMs: Date.now() - started };
  }
}

async function checkDrafts(provider: Provider, testCase: EvalCase, drafts: GeneratedEventDraft[]): Promise<DraftCheckSummary> {
  const focus = DEFAULT_TAGS.filter(tag => testCase.choices.focusTagIds.includes(tag.id));
  const questions = draftCheckQuestions(testCase.choices, focus);
  const summary: DraftCheckSummary = { provider: provider.name, ran: 0, errors: 0, unsafe: 0, coverOverrides: 0, avgFit: null, costMicros: 0, latencyMs: 0, covers: [], unsafeFlags: [] };
  const fits: number[] = [];
  for (const draft of drafts) {
    const started = Date.now();
    try {
      const result = await provider.decisions.decide({ step: "draftCheck", state: draftState(draft), questions });
      const check = interpretDraftCheck(result.answers);
      summary.ran += 1;
      summary.latencyMs += Date.now() - started;
      summary.costMicros += costMicros(result.model, result.usage);
      summary.covers.push(check.cover);
      summary.unsafeFlags.push(check.unsafe);
      if (check.unsafe) summary.unsafe += 1;
      if (check.cover && `catalog://default/${check.cover}` !== draft.coverImageURL) summary.coverOverrides += 1;
      if (check.fit !== null) fits.push(check.fit);
    } catch {
      // Production falls back to the next provider; the eval records the failure.
      summary.errors += 1;
      summary.covers.push(null);
      summary.unsafeFlags.push(false);
    }
  }
  summary.avgFit = fits.length > 0 ? fits.reduce((a, b) => a + b, 0) / fits.length : null;
  summary.latencyMs = summary.ran > 0 ? Math.round(summary.latencyMs / summary.ran) : 0;
  return summary;
}

async function generateCase(llm: LlmPort, checkers: Provider[], testCase: EvalCase, note: string, model: string, now: Date): Promise<GenerateResult> {
  const catalog = DEFAULT_TAGS;
  const catalogIds = catalog.map(tag => tag.id);
  const interests = summarizeInterests(testCase.interests.length > 0 ? testCase.interests : null, catalog);
  const input = buildGenerateUserContent({
    choices: testCase.choices, count: testCase.count, note, catalog, topInterests: interests.top,
    thinTagIds: interests.thinTagIds.slice(0, THIN_IN_PROMPT), theme: testCase.theme, now,
  });
  const schema = modelDraftsSchema(catalogIds, { count: testCase.count, choices: testCase.choices });
  const context = { count: testCase.count, choices: testCase.choices, catalogIds: new Set(catalogIds), catalogNames: new Map(catalog.map(t => [t.id, t.name])) };
  const started = Date.now();
  const totals = { costMicros: 0, tokensIn: 0, tokensOut: 0 };
  let last: { kind: string; value?: unknown; model: string } | null = null;
  let drafts: GeneratedEventDraft[] = [];
  let parseError: string | undefined;
  let attempts = 0;
  let firstAttemptValid = false;
  // Same as production: one bounded retry on refusal, truncation, malformed or unusable output.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    attempts = attempt;
    let outcome;
    try {
      outcome = await llm.generate({ step: "generate", instructions: GENERATE_SYSTEM_PROMPT, input, schema, schemaName: "event_drafts", maxOutputTokens: outputCeiling("generate", model) });
    } catch (error) {
      return { ran: true, outcome: errorName(error), attempts, valid: false, error: errorName(error), ...totals, latencyMs: Date.now() - started, model };
    }
    totals.costMicros += costMicros(outcome.model, outcome.usage);
    totals.tokensIn += outcome.usage.inputTokens;
    totals.tokensOut += outcome.usage.outputTokens;
    last = { kind: outcome.kind, model: outcome.model, ...(outcome.kind === "ok" ? { value: outcome.value } : {}) };
    if (outcome.kind === "refusal") break;
    if (outcome.kind !== "ok") { parseError = outcome.kind; continue; }
    try {
      drafts = parseModelDrafts(outcome.value, context);
      parseError = drafts.length === testCase.count ? undefined : `got ${drafts.length} of ${testCase.count} drafts`;
      if (attempt === 1) firstAttemptValid = drafts.length === testCase.count;
      break;
    } catch (e) {
      parseError = e instanceof InvalidModelOutput ? e.message : "unexpected";
    }
  }
  const latencyMs = Date.now() - started;
  const common = { ran: true, latencyMs, model: last?.model ?? model, outcome: last?.kind ?? "none", attempts, firstAttemptValid, ...totals };
  if (last?.kind === "refusal") return { ...common, valid: false, error: "refusal" };
  if (drafts.length === 0) return { ...common, valid: false, error: parseError ?? "no drafts", ...(last?.value !== undefined ? { rawDrafts: asRecords(last.value) } : {}) };
  const { checks, notes } = runChecks(testCase, last?.value);
  const verdicts = await llm.moderate(drafts.map(d => `${d.title}\n${d.description}\n${d.rationale}`)).catch(() => []);
  const outputModerationFlags = verdicts.filter(v => v.flagged).length;
  const draftChecks: DraftCheckSummary[] = [];
  for (const checker of checkers) draftChecks.push(await checkDrafts(checker, testCase, drafts));
  return {
    ...common, valid: !parseError, draftCount: drafts.length, ...(parseError ? { error: parseError } : {}),
    checks, checkNotes: notes, outputModerationFlags, draftChecks, rawDrafts: asRecords(last?.value),
  };
}

// ---------- reporting ----------

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((100 * n) / d)}%`);
const usd = (micros: number) => `$${(micros / 1e6).toFixed(4)}`;
const avg = (values: number[]) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function summarizeGenerate(rows: Row[], models: string[]) {
  return models.map(model => {
    const mine = rows.filter(r => r.model === model && r.generate.ran);
    const autoFails = mine.filter(r => r.generate.checks && Object.values(r.generate.checks).includes("fail")).length;
    const review = mine.filter(r => r.generate.checks && Object.values(r.generate.checks).includes("review")).length;
    return {
      model,
      generations: mine.length,
      validPct: pct(mine.filter(r => r.generate.valid).length, mine.length),
      firstAttemptValidPct: pct(mine.filter(r => r.generate.firstAttemptValid).length, mine.length),
      retries: mine.filter(r => (r.generate.attempts ?? 0) > 1).length,
      refusals: mine.filter(r => r.generate.outcome === "refusal").length,
      validationFailures: mine.filter(r => !r.generate.valid).length,
      autoCheckFailures: autoFails,
      namedVenueReviews: review,
      outputModerationFlags: mine.reduce((s, r) => s + (r.generate.outputModerationFlags ?? 0), 0),
      avgDraftingCostUsd: usd(avg(mine.map(r => r.generate.costMicros))),
      avgTokensIn: Math.round(avg(mine.map(r => r.generate.tokensIn))),
      avgTokensOut: Math.round(avg(mine.map(r => r.generate.tokensOut))),
      avgLatencyMs: Math.round(avg(mine.map(r => r.generate.latencyMs))),
    };
  });
}

function summarizeTriage(rows: Row[], providers: Provider[]) {
  const firstModel = rows[0]?.model;
  return providers.map(provider => {
    const mine = rows.filter(r => r.model === firstModel).flatMap(r => r.triage.filter(t => t.provider === provider.name));
    const ran = mine.filter(t => t.ran && t.error === null && !t.moderationFlagged);
    const maxNoul = (t: TriageResult) => (t.nouls ? Math.max(...Object.values(t.nouls)) : null);
    const flagMax = ran.filter(t => t.expected === "flag").map(maxNoul).filter((n): n is number => n !== null);
    const okMax = ran.filter(t => t.expected === "ok").map(maxNoul).filter((n): n is number => n !== null);
    const allNouls = ran.flatMap(t => (t.nouls ? Object.values(t.nouls) : []));
    return {
      provider: provider.name,
      model: provider.model,
      cases: mine.length,
      notesTriaged: ran.length,
      accuracyPct: pct(mine.filter(t => t.correct).length, mine.length),
      falseFlags: mine.filter(t => t.expected === "ok" && t.flagged).length,
      missedFlags: mine.filter(t => t.expected === "flag" && !t.flagged).length,
      errors: mine.filter(t => t.error !== null).length,
      moderationFlags: mine.filter(t => t.moderationFlagged).length,
      // Calibration sanity: the highest Noul per note should be high for notes that must be declined and low otherwise;
      // answers in the unsettled 0.3 to 0.7 band are counted.
      meanMaxNoulExpectedFlag: flagMax.length > 0 ? r3(avg(flagMax)) : null,
      meanMaxNoulExpectedOk: okMax.length > 0 ? r3(avg(okMax)) : null,
      unsettledAnswers: `${allNouls.filter(n => n > 0.3 && n < 0.7).length} of ${allNouls.length}`,
      avgCostPerNoteUsd: usd(avg(ran.map(t => t.costMicros))),
      avgLatencyMs: Math.round(avg(ran.map(t => t.latencyMs))),
    };
  });
}

function summarizeDraftChecks(rows: Row[], providers: Provider[]) {
  const all = rows.flatMap(r => r.generate.draftChecks ?? []);
  const summaries = providers.map(provider => {
    const mine = all.filter(d => d.provider === provider.name);
    const ran = mine.reduce((s, d) => s + d.ran, 0);
    return {
      provider: provider.name,
      checks: ran,
      errors: mine.reduce((s, d) => s + d.errors, 0),
      unsafeDrops: mine.reduce((s, d) => s + d.unsafe, 0),
      coverOverrides: mine.reduce((s, d) => s + d.coverOverrides, 0),
      avgFit: r3(avg(mine.flatMap(d => (d.avgFit === null ? [] : [d.avgFit])))),
      avgCostPerCheckUsd: usd(ran > 0 ? mine.reduce((s, d) => s + d.costMicros, 0) / ran : 0),
      avgLatencyMs: Math.round(avg(mine.filter(d => d.ran > 0).map(d => d.latencyMs))),
    };
  });
  // Agreement between the first two providers on the same drafts (cover pick and unsafe flag).
  let agreement: { coverAgreePct: string; unsafeAgreePct: string; compared: number } | null = null;
  if (providers.length > 1) {
    let compared = 0; let cover = 0; let unsafe = 0;
    for (const row of rows) {
      const [a, b] = [providers[0]!.name, providers[1]!.name].map(name => row.generate.draftChecks?.find(d => d.provider === name));
      if (!a || !b) continue;
      for (let i = 0; i < Math.min(a.covers.length, b.covers.length); i += 1) {
        compared += 1;
        if (a.covers[i] === b.covers[i]) cover += 1;
        if (a.unsafeFlags[i] === b.unsafeFlags[i]) unsafe += 1;
      }
    }
    agreement = { compared, coverAgreePct: pct(cover, compared), unsafeAgreePct: pct(unsafe, compared) };
  }
  return { summaries, agreement };
}

function printTable(head: string[], lines: string[][]) {
  const widths = head.map((h, i) => Math.max(h.length, ...lines.map(l => l[i]!.length)));
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  console.log(fmt(head));
  console.log(widths.map(w => "-".repeat(w)).join("  "));
  for (const line of lines) console.log(fmt(line));
}

// ---------- main ----------

/** Worst case of one case: the production reservation plus the comparison provider's triage and draft checks. */
function caseWorstCase(model: string, triageModel: string, jev: boolean, config: AiConfig): number {
  const models = jev
    ? { generate: model, triage: config.triage.jevModel, draftCheck: config.draftCheck.jevModel, moderation: config.moderation.model, triageFallback: triageModel, draftCheckFallback: triageModel }
    : { generate: model, triage: triageModel, draftCheck: triageModel, moderation: config.moderation.model };
  return worstCaseMicros({ models });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const all = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8")) as EvalCase[];
  const cases = args.cases ? all.filter(c => args.cases!.includes(c.id)) : all;
  if (cases.length === 0) throw new Error("No cases selected");

  const configFor = (model: string): AiConfig => aiConfig({ AI_MODEL_GENERATE: model, AI_MODEL_TRIAGE: args.triageModel, AI_MODEL_DRAFT_CHECK: args.triageModel });
  const models = args.live ? (args.models.length > 0 ? args.models : [DEFAULT_GENERATE_MODEL]) : ["demo"];
  const capMicros = Math.round(args.maxUsd * 1e6);
  let moderationLlm: LlmPort = new DemoLlm();
  const generateLlms = new Map<string, LlmPort>(models.map(m => [m, new DemoLlm()]));
  let providers: Provider[] = [{ name: "demo", decisions: new DemoDecisions(), model: "demo" }];
  const perCase = (model: string) => caseWorstCase(model, args.triageModel, args.jev, configFor(model));

  if (args.live) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) throw new Error("--live needs the OPENAI_API_KEY environment variable. Nothing was sent.");
    const jevKey = process.env.JEV_API_KEY;
    if (args.jev && (!jevKey || jevKey.trim() === "" || jevKey.trim().toLowerCase() === "none")) throw new Error("--jev needs a real JEV_API_KEY. Nothing was sent.");
    const config = configFor(models[0]!);
    const maxMicros = cases.length * models.reduce((s, m) => s + perCase(m), 0);
    console.log(`Live run: ${cases.length} cases x ${models.length} generate model(s) [${models.join(", ")}]; decision providers [${args.jev ? `jev (${config.triage.jevModel}) primary, ` : ""}openai-mini (${args.triageModel})].`);
    console.log(`Estimated MAXIMUM spend: ${usd(maxMicros)}; hard cap ${usd(capMicros)} (the run stops before passing it).`);
    if (!args.yes) {
      console.log("Not spending anything. Re-run with --yes to confirm.");
      return;
    }
    const lock = join(args.out, LOCK_FILE);
    if (existsSync(lock) && !args.allowRerun) throw new Error(`A live run already happened (${lock}). Only one live run is allowed; nothing was sent.`);
    mkdirSync(args.out, { recursive: true });
    writeFileSync(lock, `${new Date().toISOString()}\n`);
    moderationLlm = createOpenAiLlm(openaiKey, config);
    for (const model of models) generateLlms.set(model, createOpenAiLlm(openaiKey, configFor(model)));
    const openai: Provider = { name: "openai-mini", decisions: new OpenAiDecisions(moderationLlm, config), model: args.triageModel };
    providers = args.jev ? [{ name: "jev", decisions: new JevDecisions({ apiKey: jevKey!, model: config.triage.jevModel }), model: config.triage.jevModel }, openai] : [openai];
  } else {
    console.log("Offline mode: DemoLlm and DemoDecisions, no API calls, no spend. Numbers show the harness and prompt plumbing, not model quality.");
    console.log(`For reference, a live run of these cases with the defaults and --jev reserves at most ${usd(cases.length * caseWorstCase(DEFAULT_GENERATE_MODEL, DEFAULT_DECISION_MODEL, true, configFor(DEFAULT_GENERATE_MODEL)))}.`);
  }

  const now = new Date();
  const primary = providers[0]!;
  const rows: Row[] = [];
  let spent = 0;
  let stopped: string | null = null;
  outer: for (const testCase of cases) {
    for (const model of models) {
      if (args.live && spent + perCase(model) > capMicros) {
        stopped = `stopped before ${testCase.id}: spend ${usd(spent)} plus this case's worst case ${usd(perCase(model))} would pass the cap ${usd(capMicros)}`;
        break outer;
      }
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
        generate = await generateCase(generateLlms.get(model)!, providers, testCase, note, model, now);
      } else {
        generate = { ran: false, skippedReason: "flagged by triage", costMicros: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0, model };
      }
      spent += generate.costMicros + (generate.draftChecks ?? []).reduce((s, d) => s + d.costMicros, 0);
      rows.push({ caseId: testCase.id, model, triage, generate, human: { onTheme: null, inclusive: null, appealing: null, notes: null } });
      const verdicts = triage.map(t => `${t.provider}=${t.ran ? (t.flagged ? "flag" : "ok") : "skipped"}${t.correct ? "" : " (WRONG)"}`).join(" ");
      console.log(`${testCase.id.padEnd(8)} ${model.padEnd(12)} triage ${verdicts} ` +
        (generate.ran ? `valid=${generate.valid} attempts=${generate.attempts} cost=${usd(generate.costMicros)}${generate.checkNotes?.length ? ` notes=${generate.checkNotes.length}` : ""}` : "not generated"));
    }
    if (args.live && spent > capMicros) {
      stopped = `stopped after ${testCase.id}: spend ${usd(spent)} passed the cap ${usd(capMicros)}`;
      break;
    }
  }
  if (stopped) console.error(stopped);

  const generateSummary = summarizeGenerate(rows, models);
  const triageSummary = summarizeTriage(rows, providers);
  const draftCheckSummary = summarizeDraftChecks(rows, providers);
  console.log("");
  printTable(
    ["model", "gens", "valid", "1st try", "retries", "refusals", "invalid", "auto fails", "venue review", "out mod", "avg draft cost", "avg in/out tok", "avg latency"],
    generateSummary.map(s => [s.model, String(s.generations), s.validPct, s.firstAttemptValidPct, String(s.retries), String(s.refusals), String(s.validationFailures),
      String(s.autoCheckFailures), String(s.namedVenueReviews), String(s.outputModerationFlags), s.avgDraftingCostUsd, `${s.avgTokensIn}/${s.avgTokensOut}`, `${s.avgLatencyMs} ms`]),
  );
  console.log("");
  printTable(
    ["triage provider", "model", "cases", "notes", "accuracy", "false flags", "missed", "errors", "max noul flag/ok", "unsettled", "avg cost/note", "avg latency"],
    triageSummary.map(s => [s.provider, s.model, String(s.cases), String(s.notesTriaged), s.accuracyPct, String(s.falseFlags), String(s.missedFlags), String(s.errors),
      `${s.meanMaxNoulExpectedFlag ?? "-"}/${s.meanMaxNoulExpectedOk ?? "-"}`, s.unsettledAnswers, s.avgCostPerNoteUsd, `${s.avgLatencyMs} ms`]),
  );
  console.log("");
  printTable(
    ["draft-check provider", "checks", "errors", "unsafe drops", "cover overrides", "avg fit", "avg cost/check", "avg latency"],
    draftCheckSummary.summaries.map(s => [s.provider, String(s.checks), String(s.errors), String(s.unsafeDrops), String(s.coverOverrides), String(s.avgFit), s.avgCostPerCheckUsd, `${s.avgLatencyMs} ms`]),
  );
  if (draftCheckSummary.agreement) console.log(`Draft-check agreement (${draftCheckSummary.agreement.compared} drafts): cover ${draftCheckSummary.agreement.coverAgreePct}, unsafe ${draftCheckSummary.agreement.unsafeAgreePct}.`);
  console.log("");
  console.log(`Total spend: ${usd(spent)} (cap ${usd(capMicros)}).`);

  mkdirSync(args.out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const label = (args.label || (args.live ? "live" : "offline")).replace(/[^\w-]+/g, "-");
  const file = join(args.out, `${stamp}-${label}.json`);
  writeFileSync(file, JSON.stringify({
    mode: args.live ? "live" : "offline", startedAt: now.toISOString(), models, providers: providers.map(p => ({ name: p.name, model: p.model })),
    totalSpendMicros: spent, capMicros, stopped, generateSummary, triageSummary, draftCheckSummary, rows,
  }, null, 1) + "\n");
  console.log(`Results written to ${file}`);
}

main().catch(error => {
  // Only our own messages are printed; provider errors are reduced to a kind and status before they get here.
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
