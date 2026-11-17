import type { DecisionAnswer, DecisionQuestion } from "../../ai/application/ports";
import { IDEA_CATALOG, type IdeaTemplate } from "./catalog";
import { fitLabel, type FitLabel } from "./labels";
import { availability, buildState, candidateQuestions, chunkQuestions, composite, interpret } from "./questions";
import { dataNote, factsLine, reasonsFor, whenHint } from "./reasons";
import { finalPick, prefilter, shortlist as buildShortlist, type Scored } from "./rules";
import { mondayOf, civilDate, summarize, weekLabel, type CompanySignals, type CompanySummary, type DataLevel } from "./signals";

export type Engine = "jev" | "openai" | "heuristic";

export interface RankedIdea {
  ideaId: string;
  score: number;
  label: FitLabel | null;
  reasons: string[];
  whenHint: string | null;
  facts: string;
}

export interface Prepared {
  signals: CompanySignals;
  summary: CompanySummary;
  /** Candidates in shortlist order with their prior score. */
  shortlist: Scored[];
  priors: number[];
  state: string;
  questionChunks: Array<Record<string, DecisionQuestion>>;
}

export interface RankResult {
  engine: Engine;
  dataLevel: DataLevel;
  dataNote: string | null;
  ideas: RankedIdea[];
  weekKey: string;
  /** Label of the current week's Monday, for example "Week of Nov 16". */
  weekLabel: string;
  /** Exact current interest counts, stored on the digest to compute growth four weeks later. */
  tagCounts: Record<string, number>;
}

/** Everything the engine needs before any model is called: summary, shortlist, prior scores, state and question chunks. */
export function prepare(signals: CompanySignals, catalog: readonly IdeaTemplate[] = IDEA_CATALOG, chunkSize?: number): Prepared {
  const summary = summarize(signals);
  const candidates = prefilter(catalog, summary, signals);
  const scored = buildShortlist(candidates, summary, signals);
  const ideas = scored.map(s => s.idea);
  return {
    signals,
    summary,
    shortlist: scored,
    priors: scored.map(s => s.score),
    state: buildState(summary, signals),
    questionChunks: chunkQuestions(candidateQuestions(ideas, availability(summary, signals)), chunkSize),
  };
}

/** Combines answers (null means heuristic: prior only) with the deterministic rules into the ranked ideas. */
export function finish(prepared: Prepared, answers: Record<string, DecisionAnswer> | null, engine: Engine): RankResult {
  const { summary, signals, shortlist } = prepared;
  const effective = engine === "heuristic" ? null : answers;
  const components = interpret(effective, shortlist.map(s => s.idea));
  const scored: Scored[] = shortlist.map((s, i) => ({
    idea: s.idea,
    score: effective ? composite(components[i]!, prepared.priors[i]!) : prepared.priors[i]!,
  }));
  const ideas = finalPick(scored, summary).map((s): RankedIdea => ({
    ideaId: s.idea.id,
    score: s.score,
    label: fitLabel(s.score, summary.dataLevel),
    reasons: reasonsFor(s.idea, summary, signals),
    whenHint: whenHint(s.idea, summary),
    facts: factsLine(s.idea),
  }));
  return {
    engine,
    dataLevel: summary.dataLevel,
    dataNote: dataNote(summary.dataLevel),
    ideas,
    weekKey: summary.weekKey,
    weekLabel: weekLabel(mondayOf(civilDate(signals.now, signals.timeZone))),
    tagCounts: Object.fromEntries((signals.interests ?? []).map(t => [t.tagId, t.memberCount])),
  };
}
