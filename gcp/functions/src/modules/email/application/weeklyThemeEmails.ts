import { collapseWhitespace } from "../../share/domain/sharePage";
import { WEEKLY_THEME_LOOKBACK_MS, themesStartedWithin } from "../../notifications/application/newTriggers";
import type { MemberPager, WeeklyTheme, WeeklyThemeReader } from "../../notifications/application/routerPorts";
import { resolvePreferences } from "../../notifications/domain/preferences";
import { decideEmail } from "../domain/policy";
import { truncate } from "../domain/templates/copy";
import { THEME_DESCRIPTION_MAX } from "../domain/templates/render";
import { SUGGESTION_THEMES, type TemplateVariables } from "../domain/templates/types";
import { enqueueEmail, type EnqueueDeps } from "./enqueueEmail";
import type { CompanySettingsReader, EmailPreferencesStore } from "./ports";

/**
 * Weekly theme announcement email (docs/design/email-catalog.md). Same audience and timing as the `weekly_theme` push
 * (`runWeeklyThemePushes`): every theme whose window opened within the last 24 hours, every active member of its company
 * from the same member pager. Unlike the push, the category `weekly_themes` is OFF unless the member turned it on, so a
 * member without a stored choice gets nothing. One outbox document per member per theme
 * (`weekly_themes_<challengeId>_<uid>_announce`), created once: a second run, a scheduler retry or an overlapping run
 * enqueues nothing new. The sender re-checks the company switch, membership, the category and the caps at send time.
 */

const MEMBER_PAGE = 300;
const MAX_MEMBER_PAGES = 100;
/** Preference reads in flight per page. */
const PARALLELISM = 20;
const THEME_KEY = /^catalog:\/\/theme\/([a-z]+)$/;

export interface WeeklyThemeEmailDeps {
  themes: WeeklyThemeReader;
  members: MemberPager;
  companies: CompanySettingsReader;
  preferences: EmailPreferencesStore;
  enqueue: EnqueueDeps;
  /** EMAIL_ENABLED. */
  config: { enabled: boolean };
  now: () => Date;
  log?: (event: string, fields: Record<string, string | number>) => void;
}

export interface WeeklyThemeEmailStats {
  themes: number;
  /** Members whose own switch is on and got an outbox document this run. */
  enqueued: number;
  /** Outbox documents that already existed (a replayed or overlapping run). */
  duplicates: number;
  /** Members who did not opt in (including everyone without a stored choice). */
  notOptedIn: number;
  /** Themes skipped because email is off for their company. */
  companiesOff: number;
  failed: number;
}

/** Allow-listed variables of one theme; the template validator still checks them before anything is stored. */
export function weeklyThemeVariables(theme: WeeklyTheme): TemplateVariables["weekly_theme"] {
  const key = THEME_KEY.exec(theme.coverImageURL ?? "")?.[1];
  const themeKey = SUGGESTION_THEMES.find((k) => k === key);
  const description = theme.description ? collapseWhitespace(theme.description) : "";
  const points = theme.pointsReward;
  return {
    challengeId: theme.challengeId,
    themeTitle: collapseWhitespace(theme.title),
    ...(description ? { themeDescription: truncate(description, THEME_DESCRIPTION_MAX) } : {}),
    ...(themeKey ? { themeKey } : {}),
    startDate: theme.startDate.toISOString(),
    endDate: theme.endDate.toISOString(),
    ...(typeof points === "number" && Number.isInteger(points) && points > 0 && points <= 1000 ? { pointsReward: points } : {}),
  };
}

export async function runWeeklyThemeEmails(deps: WeeklyThemeEmailDeps): Promise<WeeklyThemeEmailStats> {
  const stats: WeeklyThemeEmailStats = { themes: 0, enqueued: 0, duplicates: 0, notOptedIn: 0, companiesOff: 0, failed: 0 };
  if (!deps.config.enabled) return stats;
  const now = deps.now();
  const started = themesStartedWithin(await deps.themes.startedBetween(new Date(now.getTime() - WEEKLY_THEME_LOOKBACK_MS), now), now);
  stats.themes = started.length;
  for (const theme of started) {
    try {
      await runTheme(deps, theme, stats);
    } catch (error) {
      // One theme (one company) never blocks the others; outbox ids make the next run finish the rest.
      stats.failed += 1;
      deps.log?.("weekly_theme_email.theme_failed", { companyId: theme.companyId, challengeId: theme.challengeId, error: error instanceof Error ? error.name : "unknown" });
    }
  }
  deps.log?.("weekly_theme_email.job", { ...stats });
  return stats;
}

async function runTheme(deps: WeeklyThemeEmailDeps, theme: WeeklyTheme, stats: WeeklyThemeEmailStats): Promise<void> {
  const company = await deps.companies.get(theme.companyId);
  if (company === null || !company.enabled) {
    stats.companiesOff += 1;
    return;
  }
  const variables = weeklyThemeVariables(theme);
  if (deps.enqueue.validate("weekly_theme", variables) === null) {
    stats.failed += 1;
    deps.log?.("weekly_theme_email.invalid_theme", { companyId: theme.companyId, challengeId: theme.challengeId });
    return;
  }
  let after: string | null = null;
  for (let page = 0; page < MAX_MEMBER_PAGES; page++) {
    const members = await deps.members.page(theme.companyId, after, MEMBER_PAGE);
    for (let offset = 0; offset < members.uids.length; offset += PARALLELISM) {
      await Promise.all(members.uids.slice(offset, offset + PARALLELISM).map(async (uid) => {
        const map = await deps.preferences.getEmailMap(uid);
        const decision = decideEmail({
          kind: "weekly_theme_email", globalEnabled: deps.config.enabled, companyEnabled: true,
          preferences: resolvePreferences({ email: map ?? {} }), eventLevel: null, pushWillDeliver: false,
        });
        if (!decision.send) { stats.notOptedIn += 1; return; }
        const result = await enqueueEmail(deps.enqueue, {
          template: "weekly_theme", variables, uid, companyId: theme.companyId, objectId: theme.challengeId,
          revisionOrWindow: "announce", notAfter: theme.endDate,
        });
        if (result.enqueued) stats.enqueued += 1;
        else if (result.reason === "duplicate") stats.duplicates += 1;
      }));
    }
    after = members.last;
    if (after === null) break;
  }
}
