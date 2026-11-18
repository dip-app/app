// @i18n-migrated
import type { Tag } from "./catalog";
import { t } from "./i18n";

/** `companies/{companyId}/tagStats/{tagId}` (schema `TagStat`). Timestamps are ISO strings in the portal. */
export interface TagStat {
  tagId: string;
  memberCount: number;
  updatedAt: string;
  reconciledAt?: string;
}

export interface InterestRow {
  tagId: string;
  name: string;
  count: number;
  /** Bar width, 0 to 100: share of active members, or of the largest count when the total is unknown. */
  percent: number;
  /** Share of active members, 0 to 100, or null when the total is 0 or unknown. */
  share: number | null;
}

/** The server count can briefly dip below zero (trigger races); the portal never shows that. */
export const clampCount = (value: number): number => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** Counts by tag ID, clamped at zero. A null list (no access) gives an empty map. */
export function countsByTag(stats: readonly TagStat[] | null | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const stat of stats ?? []) counts.set(stat.tagId, clampCount(stat.memberCount));
  return counts;
}

/** Counts are shown only once the company has at least one stat doc; null (no access) and [] both hide them. */
export function hasStats(stats: readonly TagStat[] | null | undefined): boolean {
  return (stats?.length ?? 0) > 0;
}

/**
 * Overview rows: every catalog tag, most members first, ties by name. Tags without a stat doc count as 0.
 * With a positive `activeMembers` the bar and `share` are a percentage of it (clamped to 100); when the total is
 * unknown (null, e.g. the insights call failed) or 0, bars are relative to the top tag and `share` is null.
 */
export function interestRows(stats: readonly TagStat[] | null | undefined, tags: readonly Tag[], activeMembers: number | null = null): InterestRow[] {
  const counts = countsByTag(stats);
  const rows = tags.map((tag) => ({ tagId: tag.id, name: tag.name, count: counts.get(tag.id) ?? 0 }));
  const max = rows.reduce((m, row) => Math.max(m, row.count), 0);
  const total = activeMembers !== null && activeMembers > 0 ? activeMembers : 0;
  return rows
    .map((row) => {
      if (total > 0) {
        const share = Math.min(100, Math.round((row.count / total) * 100));
        return { ...row, percent: share, share };
      }
      return { ...row, percent: max > 0 ? Math.round((row.count / max) * 100) : 0, share: null };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export const interestLabel = (count: number): string => t("overview.interests.interested", { count });
