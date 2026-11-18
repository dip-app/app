// @i18n-migrated
// Pure helpers for the "Ideas for you" section: labels, the collapse memory, the refresh rule and the hand-off to the
// wizard. No React and no network, so it is unit tested directly. Copy lives in aiStrings.ts (`ideasForYou.` keys).

import type { AiCredits, DipbotIdea, DipbotIdeas } from "./adminTypes";
import { type AiStringKey, t } from "./aiStrings";
import { MAX_CONSIDERATIONS, isConsiderationId } from "./considerations";
import { creditsText, resetDate } from "./credits";
import { type Answers, MAX_FOCUS, emptyAnswers } from "./ideas";
import { relativeAgo } from "./suggestCache";

export const IDEAS_COLLAPSED_KEY = "dip.ideasForYou.collapsed";
/** What a run costs when the server does not say (CREDIT_COSTS.ideas). */
export const DEFAULT_IDEAS_COST = 3;

export function readCollapsed(): boolean {
  try { return window.localStorage.getItem(IDEAS_COLLAPSED_KEY) === "1"; } catch { return false; }
}
export function writeCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(IDEAS_COLLAPSED_KEY, "1");
    else window.localStorage.removeItem(IDEAS_COLLAPSED_KEY);
  } catch { /* storage blocked: the section just opens expanded next time */ }
}

export const ideasCost = (credits: AiCredits): number => credits.creditCost.ideas ?? DEFAULT_IDEAS_COST;

/** "Updated yesterday", "Updated 5 hours ago", or "Starter ideas" for the free catalog fallback. */
export function updatedLine(data: Pick<DipbotIdeas, "status" | "generatedAt" | "dataLevel">, now: Date): string {
  if (data.dataLevel === "none") return t("ideasForYou.starterNoData");
  if (data.status === "fallback" || !data.generatedAt) return t("ideasForYou.starter");
  const at = new Date(data.generatedAt).getTime();
  const hours = Number.isFinite(at) ? (now.getTime() - at) / 3_600_000 : 0;
  const when = hours >= 24 && hours < 48 ? t("ideasForYou.when.yesterday") : relativeAgo(data.generatedAt, now);
  return t("ideasForYou.updated", { when });
}

export interface RefreshState {
  disabled: boolean;
  /** Why it is off, as one plain sentence (title and screen reader text); null when it can be pressed. */
  reason: string | null;
}
export function refreshState(data: DipbotIdeas, running: boolean): RefreshState {
  if (running) return { disabled: true, reason: null };
  if (data.credits.creditsRemaining < ideasCost(data.credits)) return { disabled: true, reason: t("ideasForYou.hintOut", { date: resetDate(data.credits.resetsAt) }) };
  if (data.refreshesLeftToday <= 0) return { disabled: true, reason: t("ideasForYou.hintLimit") };
  return { disabled: false, reason: null };
}

/** "Thu after work", "Sat daytime". */
export function dayTimeLabel(idea: Pick<DipbotIdea, "weekday" | "daypart">): string {
  const day = Number.isInteger(idea.weekday) && idea.weekday >= 0 && idea.weekday <= 6 ? t(`ideasForYou.day.${idea.weekday}` as AiStringKey) : "";
  const part = t(`ideasForYou.daypart.${idea.daypart}` as AiStringKey);
  return day ? `${day} ${part}` : part;
}

/** The wizard answers an idea stands for: at most MAX_FOCUS interests, catalog considerations only, an empty note. */
export function answersFromIdea(idea: Pick<DipbotIdea, "choices" | "considerationIds">): Answers {
  const c = idea.choices;
  return {
    ...emptyAnswers(),
    focusTagIds: c.focusTagIds.slice(0, MAX_FOCUS),
    goal: c.goal, groupSize: c.groupSize, setting: c.setting, budget: c.budget, timing: c.timing,
    considerations: idea.considerationIds.filter(isConsiderationId).slice(0, MAX_CONSIDERATIONS),
  };
}

export const openAria = (title: string) => t("ideasForYou.useAria", { title });
export const customizeAria = (title: string) => t("ideasForYou.customizeAria", { title });
export const refreshAria = (credits: AiCredits) => t("ideasForYou.refreshAria", { cost: creditsText(ideasCost(credits)) });
