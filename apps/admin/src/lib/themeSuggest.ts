// @i18n-migrated
// Suggest theme (suggestThemeV1) on the New theme form: how a Dipbot suggestion fills the draft. Pure, no React.
// Decided with the design review: Dipbot fills only the fields the admin has not changed; fields the admin changed are
// kept and listed, with an explicit "Replace those too". Undo restores everything as it was before the first fill.

import type { ThemeSuggestField, ThemeSuggestion } from "./adminTypes";
import type { ThemeDraft } from "./challenge";
import { THEME_URL_PREFIX, resolveTheme } from "./themes";
import { addDays, weekEndIso, weekStartIso } from "./weeks";
import { intlLocale } from "./i18n";
import { t } from "./aiStrings";

/** Form order, used for the "Filled in" and "Kept" lists. */
export const SUGGEST_FIELDS: readonly ThemeSuggestField[] = ["illustration", "title", "description", "tags", "week"];

export interface ApplyOptions {
  /** Fields the admin changed by hand; they are kept unless `replaceMine`. */
  mine: ReadonlySet<ThemeSuggestField>;
  replaceMine?: boolean;
  /** Catalog tag ids the form shows; tags outside it are dropped. Null while the catalog is loading (tags are kept as sent). */
  knownTagIds: readonly string[] | null;
  /** The Monday the suggestion should use when its own week is taken or missing; null when no week is free. */
  freeMonday: (preferred: string | undefined) => string | null;
}

export interface Applied {
  draft: ThemeDraft;
  /** Fields Dipbot set, in form order. */
  filled: ThemeSuggestField[];
  /** Fields the admin changed that hold a different value than the suggestion, in form order. */
  kept: ThemeSuggestField[];
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Fills the draft from a suggestion: only untouched fields unless `replaceMine`. Goal and unit follow the picture's defaults when unchanged. */
export function applySuggestion(draft: ThemeDraft, s: ThemeSuggestion, options: ApplyOptions): Applied {
  const next: ThemeDraft = { ...draft };
  const filled: ThemeSuggestField[] = [];
  const kept: ThemeSuggestField[] = [];
  const allowed = (field: ThemeSuggestField) => options.replaceMine === true || !options.mine.has(field);

  const url = `${THEME_URL_PREFIX}${s.themeKey}`;
  if (url !== draft.coverImageURL) {
    if (allowed("illustration")) {
      const previous = resolveTheme(draft.coverImageURL);
      const picked = resolveTheme(url);
      next.coverImageURL = url;
      if (!draft.goalUnit.trim() || draft.goalUnit === previous.goalUnits[0]) next.goalUnit = picked.goalUnits[0] ?? draft.goalUnit;
      if (draft.goal === previous.defaultGoal && picked.goalUnits.length > 0) next.goal = picked.defaultGoal;
      filled.push("illustration");
    } else kept.push("illustration");
  }

  const text = (field: "title" | "description", value: string) => {
    if (!value || value === draft[field]) return;
    if (allowed(field)) { next[field] = value; filled.push(field); } else kept.push(field);
  };
  text("title", s.title.trim());
  text("description", s.description.trim());

  const tags = options.knownTagIds ? s.tagIds.filter((id) => options.knownTagIds!.includes(id)) : [...s.tagIds];
  if (tags.length > 0 && !sameList(tags, draft.tagIds)) {
    if (allowed("tags")) { next.tagIds = tags; filled.push("tags"); } else kept.push("tags");
  }

  const monday = options.freeMonday(s.weekStart);
  if (monday) {
    const startDate = weekStartIso(monday);
    const endDate = weekEndIso(addDays(monday, 6));
    if (startDate !== draft.startDate || endDate !== draft.endDate) {
      if (allowed("week")) { next.startDate = startDate; next.endDate = endDate; filled.push("week"); } else kept.push("week");
    }
  }
  const order = (list: ThemeSuggestField[]) => SUGGEST_FIELDS.filter((f) => list.includes(f));
  return { draft: next, filled: order(filled), kept: order(kept) };
}

/** "title, description and tags" in the current language. */
export function fieldList(fields: readonly ThemeSuggestField[]): string {
  const names = fields.map((f) => t(`themeSuggest.field.${f}`));
  try {
    return new Intl.ListFormat(intlLocale(), { style: "long", type: "conjunction" }).format(names);
  } catch {
    return names.join(", ");
  }
}
