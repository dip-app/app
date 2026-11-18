import type { DecisionAnswer, DecisionPort } from "../../ai/application/ports";
import { costMicros } from "../../ai/domain/pricing";
import { finish, prepare, type Engine, type Prepared } from "../domain/rank";
import { weekKey as weekKeyOf, type CompanySignals } from "../domain/signals";
import { worstCaseFor } from "./budget";
import type { BuildDeps, StoredDigest } from "./ports";

export const LEASE_MS = 5 * 60_000;
export const DIGEST_TTL_DAYS = 120;
const DAY_MS = 86_400_000;

async function gatherSignals(deps: BuildDeps, companyId: string, now: Date, timeZone: string, weekKey: string): Promise<CompanySignals> {
  const { store } = deps;
  const [memberCount, pastEvents, upcomingEvents, weeklyThemes, recentlySuggested, monthAgo, stats, tags] = await Promise.all([
    store.memberCount(companyId), store.pastEvents(companyId, now), store.upcomingEvents(companyId, now), store.weeklyThemes(companyId, now),
    store.recentIdeaIds(companyId, weekKey), store.tagCountsAboutFourWeeksAgo(companyId, weekKey),
    deps.interests.countsFor(companyId), deps.catalog.list(),
  ]);
  return {
    now, timeZone, memberCount, pastEvents, upcomingEvents, weeklyThemes, recentlySuggested,
    interests: stats === null ? null : stats.map(s => ({ tagId: s.tagId, memberCount: s.memberCount })),
    interestsMonthAgo: monthAgo === null ? null : Object.entries(monthAgo).map(([tagId, memberCount]) => ({ tagId, memberCount })),
    tagNames: Object.fromEntries(tags.map(t => [t.id, t.name])),
  };
}

interface Attempt { answers: Record<string, DecisionAnswer> }

/**
 * Runs one provider over every question chunk under a budget reservation. Returns null when the budget cannot cover the
 * worst case or the provider fails (the caller then tries the next engine); spend of completed calls is always settled.
 */
async function runEngine(
  deps: BuildDeps, companyId: string, weekKey: string, now: Date, engine: "jev" | "openai", port: DecisionPort, prepared: Prepared,
): Promise<Attempt | null> {
  const model = deps.models[engine];
  const key = `suggest_${weekKey}`;
  const chunks = prepared.questionChunks;
  const worst = worstCaseFor(model, chunks.length);
  let reserved = false;
  try {
    reserved = await deps.budget.reserve(companyId, key, worst, now);
  } catch {
    reserved = false;
  }
  if (!reserved) {
    deps.log?.("suggestions.engine_skipped", { companyId, weekKey, engine, reason: "budget" });
    return null;
  }
  let spent = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let calls = 0;
  const answers: Record<string, DecisionAnswer> = {};
  let failed = false;
  try {
    for (const questions of chunks) {
      // "draftCheck" selects the mini-tier decision model slot until a dedicated suggestions step exists.
      const result = await port.decide({ step: "draftCheck", state: prepared.state, questions });
      calls += 1;
      spent += costMicros(result.model, result.usage);
      tokensIn += result.usage.inputTokens;
      tokensOut += result.usage.outputTokens;
      Object.assign(answers, result.answers);
    }
  } catch {
    failed = true;
  }
  try {
    await deps.budget.settle(companyId, key, spent, tokensIn, tokensOut, now, !failed);
  } catch (error) {
    deps.log?.("suggestions.settle_failed", { companyId, weekKey, engine, error: error instanceof Error ? error.name : "unknown" });
  }
  deps.log?.("suggestions.engine", { companyId, weekKey, engine, calls, tokensIn, tokensOut, costMicros: spent, outcome: failed ? "failed" : "ok" });
  return failed ? null : { answers };
}

/**
 * Returns this week's digest for the company: a ready one is reused; otherwise one caller claims a five minute lease,
 * ranks the catalog (Jev, then OpenAI mini, then the heuristic prior), stores the digest and returns it. Returns null
 * while another caller holds a live lease. A crash leaves an expired lease that the next run reclaims.
 */
export async function getOrBuildDigest(
  deps: BuildDeps, companyId: string, now: Date, options: { timeZone: string },
): Promise<StoredDigest | null> {
  const { timeZone } = options;
  const weekKey = weekKeyOf(now, timeZone);
  const claim = await deps.store.claimDigest(companyId, weekKey, now, deps.leaseMs ?? LEASE_MS);
  if (claim.kind === "ready") return claim.digest;
  if (claim.kind === "busy") {
    deps.log?.("suggestions.digest_busy", { companyId, weekKey });
    return null;
  }

  const signals = await gatherSignals(deps, companyId, now, timeZone, weekKey);
  const prepared = prepare(signals);

  let engine: Engine = "heuristic";
  let answers: Record<string, DecisionAnswer> | null = null;
  if (prepared.questionChunks.length > 0) {
    const order: Array<["jev" | "openai", DecisionPort | null]> = [["jev", deps.engines.jev], ["openai", deps.engines.openai]];
    for (const [name, port] of order) {
      if (port === null) continue;
      const attempt = await runEngine(deps, companyId, weekKey, now, name, port, prepared);
      if (attempt !== null) {
        engine = name;
        answers = attempt.answers;
        break;
      }
    }
  }

  const ranked = finish(prepared, answers, engine);
  const digest: StoredDigest = {
    weekKey: ranked.weekKey,
    weekLabel: ranked.weekLabel,
    engine: ranked.engine,
    dataLevel: ranked.dataLevel,
    dataNote: ranked.dataNote,
    ideas: ranked.ideas,
    tagCounts: ranked.tagCounts,
    memberCount: signals.memberCount,
    createdAt: now,
    expireAt: new Date(now.getTime() + DIGEST_TTL_DAYS * DAY_MS),
  };
  await deps.store.finishDigest(companyId, weekKey, digest);
  deps.log?.("suggestions.digest_ready", {
    companyId, weekKey, engine: digest.engine, dataLevel: digest.dataLevel, ideas: digest.ideas.length,
    candidates: prepared.shortlist.length, chunks: prepared.questionChunks.length,
  });
  return digest;
}
