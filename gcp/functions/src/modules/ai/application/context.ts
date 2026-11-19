import type { GetEventIdeaContextResponse } from "../../../generated/models";
import { authorize, requireCaller } from "../../admin/application/context";
import { creditsSummary } from "../domain/credits";
import { loadLedger } from "./credits";
import { summarizeInterests } from "../domain/interests";
import { aiPaths, dayKey, monthKey } from "../domain/paths";
import { worstCaseMicros } from "../domain/pricing";
import { effectiveLimits, readDay, readMonth, usageSummary } from "../domain/quota";
import { parseContextRequest } from "../domain/request";
import { bestEffort } from "./generate";
import type { AiDeps, Caller } from "./ports";
import { themeSuggestOn } from "./suggestTheme";

/**
 * getEventIdeaContextV1: the starting point of the idea flow. Admin only (`ai.generate`), read-only. Interest counts
 * leave the server only as suppressed buckets; the switch state and remaining quota let the portal explain itself.
 */
export async function getEventIdeaContext(deps: AiDeps, rawCaller: Caller | null, data: unknown): Promise<GetEventIdeaContextResponse> {
  const caller = requireCaller(rawCaller);
  const { companyId } = parseContextRequest(data);
  const now = deps.now();
  const worst = worstCaseMicros(deps.settings);
  const usage = await deps.store.runReadOnly(async tx => {
    await authorize(tx, caller, companyId, "ai.generate");
    const [settingsDoc, monthDoc, dayDoc] = await tx.getMany([
      aiPaths.settings(companyId), aiPaths.month(companyId, monthKey(now)), aiPaths.day(companyId, dayKey(now), caller.uid),
    ]);
    const limits = effectiveLimits(deps.settings, settingsDoc ?? null);
    const { ledger } = await loadLedger(tx, companyId, settingsDoc ?? null, now);
    return { enabled: limits.enabled, themeSuggest: themeSuggestOn(deps.settings, settingsDoc ?? null), credits: creditsSummary(ledger), summary: usageSummary(readMonth(monthDoc ?? null, now), readDay(dayDoc ?? null), caller.uid, limits, worst, now) };
  });
  const [stats, catalog, theme] = await Promise.all([
    bestEffort(deps, "interests", () => deps.interests.countsFor(companyId), null), deps.catalog.list(),
    bestEffort(deps, "theme", () => deps.themes.current(companyId, now), null),
  ]);
  const interests = summarizeInterests(stats, catalog);
  const known = new Set(catalog.map(tag => tag.id));
  return {
    contractVersion: 1,
    enabled: usage.enabled,
    themeSuggestEnabled: usage.themeSuggest,
    interestDataAvailable: interests.available,
    topInterests: interests.top,
    thinInterestTagIds: interests.thinTagIds,
    ...(theme ? { currentTheme: { title: theme.title, tagIds: theme.tagIds.filter(id => known.has(id)) } } : {}),
    usage: usage.summary,
    credits: usage.credits,
  };
}
