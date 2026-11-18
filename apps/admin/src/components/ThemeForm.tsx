"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTags } from "./TagCatalog";
import {
  THEME_LIMITS, THEME_REASONS, type ThemeDraft, type WeeklyTheme, endWeekOptions, findOverlap, firstFreeMonday,
  normalizeThemeDraft, overlapMessage, startWeekOptions, validateThemeDraft, windowLocked,
} from "@/lib/challenge";
import { ApiError, type FieldErrors } from "@/lib/contract";
import { THEMES, resolveTheme } from "@/lib/themes";
import {
  THEME_TIME_ZONE_LABEL, addDays, formatWindow, lastDayOfIso, mondayOfIso, nextMonday, weekEndIso, weekStartIso,
} from "@/lib/weeks";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { useApp } from "./AppProvider";
import { Dialog } from "./Dialog";
import { RadioGrid } from "./RadioGrid";
import { ThemeArt } from "./ThemeArt";
import { ThemePreview } from "./ThemePreview";
import { toast } from "./Toast";
import { Button, ChipToggle } from "@/components/kit";

interface Props {
  /** Present when editing. */
  theme?: WeeklyTheme;
  /** Called when the user asks to discard local edits and reload the latest saved theme. */
  onReload?: () => void;
}

const FIELD_IDS: Record<string, string> = {
  coverImageURL: "theme-first", title: "title", description: "description", goal: "goal", goalUnit: "unit",
  pointsReward: "points", startDate: "start-week", endDate: "end-week",
};

function focusFirstInvalid(found: FieldErrors) {
  const first = Object.keys(FIELD_IDS).find((key) => found[key]);
  if (first) document.getElementById(FIELD_IDS[first])?.focus();
}

function newDraft(): ThemeDraft {
  const fitness = THEMES[0];
  const monday = nextMonday();
  return {
    title: fitness.displayName, description: fitness.defaultDescription, tagIds: [], type: "weekly",
    goal: fitness.defaultGoal, goalUnit: fitness.goalUnits[0], coverImageURL: fitness.url,
    startDate: weekStartIso(monday), endDate: weekEndIso(addDays(monday, 6)), pointsReward: 50,
  };
}

export function ThemeForm({ theme, onReload }: Props) {
  const { api } = useApp();
  const router = useRouter();
  const editing = Boolean(theme);
  // Once people have joined or completed, the start stays put (server: WINDOW_CHANGE_BLOCKED).
  const startLocked = Boolean(theme && windowLocked(theme));
  const [draft, setDraft] = useState<ThemeDraft>(() => (theme ? normalizeThemeDraft(theme) : newDraft()));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const catalog = useTags();
  const tags = catalog.tags;
  const [others, setOthers] = useState<WeeklyTheme[]>([]);
  // Defaults (tags, first free week) apply only until the organizer changes those fields.
  const touched = useRef({ tags: false, weeks: false });
  // One key per create attempt, kept across retries so a lost response can never create two themes.
  const requestId = useRef(crypto.randomUUID());
  const [discarding, setDiscarding] = useState(false);
  const [saved, setSaved] = useState(false);
  // Set by the organizer's own edits only: the tag and week defaults that fill in after mount don't count.
  const [edited, setEdited] = useState(false);
  const dirty = edited && !saved;
  useUnsavedGuard(dirty);

  // A new theme starts with its picked theme's tag, once the shared catalog is in.
  useEffect(() => {
    if (editing || touched.current.tags || catalog.status !== "ready") return;
    const name = resolveTheme(draft.coverImageURL).defaultTagName.toLowerCase();
    setDraft((current) => ({ ...current, tagIds: catalog.tags.filter((tag) => tag.name.toLowerCase() === name).map((tag) => tag.id) }));
    // Applies once when the catalog arrives; the draft's theme at that moment picks the default tag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.status]);

  useEffect(() => {
    let cancelled = false;
    api.listThemes().then((list) => {
      if (cancelled) return;
      const rest = list.filter((item) => item.id !== theme?.id);
      setOthers(rest);
      if (!editing && !touched.current.weeks) {
        const monday = firstFreeMonday(rest, nextMonday());
        setDraft((current) => ({ ...current, startDate: weekStartIso(monday), endDate: weekEndIso(addDays(monday, 6)) }));
      }
    }, () => !cancelled && setOthers([]));
    return () => { cancelled = true; };
    // Loads once per form; the draft's theme at mount picks the default tag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const set = <K extends keyof ThemeDraft>(key: K, value: ThemeDraft[K]) => { setEdited(true); setDraft((current) => ({ ...current, [key]: value })); };

  const startOptions = useMemo(
    () => startWeekOptions(others, new Date(), { currentStart: theme?.startDate ?? draft.startDate }),
    [others, theme?.startDate, draft.startDate],
  );
  const endOptions = useMemo(
    () => endWeekOptions(others, draft.startDate, { currentEnd: theme?.endDate }),
    [others, draft.startDate, theme?.endDate],
  );
  const startValue = Number.isNaN(Date.parse(draft.startDate)) ? "" : mondayOfIso(draft.startDate);
  const endValue = Number.isNaN(Date.parse(draft.endDate)) ? "" : lastDayOfIso(draft.endDate);

  function pickStart(monday: string) {
    touched.current.weeks = true;
    const weeks = endValue && startValue && endValue > addDays(startValue, 6) ? 2 : 1;
    // Picking the saved week again restores the saved instants exactly, even if they aren't week-aligned.
    const startDate = theme && monday === mondayOfIso(theme.startDate) ? theme.startDate : weekStartIso(monday);
    const sunday = addDays(monday, weeks * 7 - 1);
    const endDate = theme && sunday === lastDayOfIso(theme.endDate) ? theme.endDate : weekEndIso(sunday);
    setEdited(true);
    setDraft((current) => ({ ...current, startDate, endDate }));
  }

  function pickEnd(sunday: string) {
    touched.current.weeks = true;
    set("endDate", theme && sunday === lastDayOfIso(theme.endDate) ? theme.endDate : weekEndIso(sunday));
  }

  function pickTheme(url: string) {
    const previous = resolveTheme(draft.coverImageURL);
    const next = resolveTheme(url);
    setEdited(true);
    // Carry the catalog defaults over only where the organizer kept the previous theme's defaults.
    setDraft((current) => ({
      ...current,
      coverImageURL: url,
      title: !current.title.trim() || current.title === previous.displayName ? next.displayName : current.title,
      description: !current.description.trim() || current.description === previous.defaultDescription ? next.defaultDescription : current.description,
      goalUnit: !current.goalUnit.trim() || current.goalUnit === previous.goalUnits[0] ? (next.goalUnits[0] ?? current.goalUnit) : current.goalUnit,
      goal: current.goal === previous.defaultGoal && next.goalUnits.length ? next.defaultGoal : current.goal,
      // A new theme follows the picked theme's tag until the organizer chooses tags themselves.
      tagIds: !editing && !touched.current.tags && next.defaultTagName
        ? tags.filter((tag) => tag.name.toLowerCase() === next.defaultTagName.toLowerCase()).map((tag) => tag.id)
        : current.tagIds,
    }));
  }

  async function submit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault();
    if (saving) return;
    const candidate = normalizeThemeDraft(draft);
    const found = validateThemeDraft(candidate, {
      // The server owns tag existence; the client checks it only against a catalog it managed to load.
      knownTagIds: tags.length ? tags.map((tag) => tag.id) : undefined,
      now: editing ? undefined : new Date(),
    });
    if (!found.startDate && !found.endDate) {
      const conflict = findOverlap(candidate, others);
      if (conflict) found.startDate = overlapMessage(conflict);
    }
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length) {
      focusFirstInvalid(found);
      return;
    }
    setSaving(true);
    try {
      if (theme) await api.updateTheme(theme.id, theme.revision, candidate);
      else await api.createTheme(requestId.current, candidate);
      setSaved(true);
      toast(editing ? `Saved changes to “${candidate.title}”.` : `Created “${candidate.title}”.`);
      router.push("/themes/");
    } catch (error) {
      if (error instanceof ApiError && error.reason === THEME_REASONS.overlap) {
        // Someone added a theme for these weeks meanwhile: refresh the taken weeks and name the conflict.
        const latest = await api.listThemes().catch(() => others);
        const rest = latest.filter((item) => item.id !== theme?.id);
        setOthers(rest);
        // The server names the conflicting theme (details.conflict); fall back to the refreshed list.
        const named = error.conflict ? rest.find((item) => item.id === error.conflict!.challengeId) : undefined;
        const conflict = named ?? findOverlap(candidate, rest);
        const message = conflict
          ? overlapMessage(conflict)
          : error.conflict
            ? `Overlaps another theme (${formatWindow(error.conflict.startDate, error.conflict.endDate)}). Pick a week without a theme.`
            : error.message;
        setErrors({ startDate: message });
        setFailure(new ApiError(error.code, message, {}, error.reason, error.conflict));
        focusFirstInvalid({ startDate: message });
        return;
      }
      // A lost response is ambiguous: creates are safe to retry (same requestId); edits must reload the
      // saved revision before saving again, per the callable contract.
      const apiError = error instanceof ApiError ? error : new ApiError(
        editing ? "aborted" : "failed-precondition",
        editing
          ? "We couldn’t confirm whether your changes were saved. Reload the latest version to check before saving again."
          : "Couldn’t create the theme. Your draft is kept; trying again is safe and won’t create a duplicate.",
      );
      setFailure(apiError);
      if (apiError.fields) setErrors(apiError.fields);
    } finally {
      setSaving(false);
    }
  }

  const err = (key: string) => errors[key];
  const invalid = (key: string) => (errors[key] ? true : undefined);
  const describedBy = (key: string, hint?: string) => [err(key) ? `${FIELD_IDS[key] ?? key}-error` : "", hint ?? ""].filter(Boolean).join(" ") || undefined;
  const selected = resolveTheme(draft.coverImageURL);
  const units = selected.goalUnits;

  return (
    <div className="form-layout">
      <form className="form" onSubmit={submit} noValidate>
        {Object.keys(errors).length > 0 && !failure && (
          <div className="banner error" role="alert">
            <span>Fix {Object.keys(errors).length} {Object.keys(errors).length === 1 ? "field" : "fields"} to continue.</span>
          </div>
        )}
        {failure && (
          <div className="banner error" role="alert">
            <span>{failure.message}</span>
            {failure.code === "aborted" && onReload && (
              <Button onClick={onReload}>Reload latest</Button>
            )}
          </div>
        )}

        <div className="section wide">
          <fieldset className="field">
            <legend>Theme</legend>
            <span className="hint">Each theme is a designed illustration that ships with the app. Pick one to fill in a title, description, goal and tag you can still change.</span>
            <RadioGrid label="Theme" value={draft.coverImageURL} onChange={pickTheme} optionClassName="theme-option"
              describedBy={err("coverImageURL") ? "theme-first-error" : undefined} invalid={!!err("coverImageURL")}
              options={THEMES.map((option, index) => ({
                value: option.url, label: option.displayName, id: index === 0 ? "theme-first" : undefined,
                content: <><ThemeArt url={option.url} className="swatch" /><span>{option.displayName}</span></>,
              }))} />
            {selected.whyItsFun && (
              <span className="hint" aria-live="polite"><strong>Why it’s fun:</strong> {selected.whyItsFun} Members post: {selected.submissionPrompt}</span>
            )}
            {err("coverImageURL") && <span className="error" id="theme-first-error">{err("coverImageURL")}</span>}
          </fieldset>
          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" aria-describedby={describedBy("title", "title-hint")} value={draft.title} maxLength={THEME_LIMITS.titleMax} aria-invalid={invalid("title")} onChange={(e) => set("title", e.target.value)} />
            <span className="hint" id="title-hint">Shown in capitals on the app’s Home card.</span>
            {err("title") && <span className="error" id="title-error">{err("title")}</span>}
          </div>
          <div className="field">
            <label htmlFor="description">Description</label>
            <textarea id="description" aria-describedby={describedBy("description")} value={draft.description} maxLength={THEME_LIMITS.descriptionMax} aria-invalid={invalid("description")} onChange={(e) => set("description", e.target.value)} />
            {err("description") && <span className="error" id="description-error">{err("description")}</span>}
          </div>
          <fieldset className="field">
            <legend>Tags</legend>
            <div className="chips">
              {catalog.status === "loading" && <span className="hint">Loading tags…</span>}
              {catalog.status === "error" && <span className="hint">Couldn’t load tags. <button type="button" className="link-btn" onClick={catalog.reload}>Try again</button></span>}
              {tags.map((tag) => (
                <ChipToggle key={tag.id} pressed={draft.tagIds.includes(tag.id)}
                  onClick={() => {
                    touched.current.tags = true;
                    set("tagIds", draft.tagIds.includes(tag.id) ? draft.tagIds.filter((t) => t !== tag.id) : [...draft.tagIds, tag.id]);
                  }}>
                  {tag.name}
                </ChipToggle>
              ))}
            </div>
            {err("tagIds") && <span className="error" id="tags-error">{err("tagIds")}</span>}
          </fieldset>
        </div>

        <div className="section">
          <h2>Weeks</h2>
          <div className="field">
            <label htmlFor="start-week">First week</label>
            <select id="start-week" value={startValue} disabled={startLocked} aria-invalid={invalid("startDate")} aria-describedby={describedBy("startDate", "weeks-hint")}
              onChange={(e) => pickStart(e.target.value)}>
              {!startValue && <option value="">Choose a week</option>}
              {startOptions.map((option) => (
                <option key={option.value} value={option.value} disabled={Boolean(option.takenBy) && option.value !== startValue}>
                  {option.label}{option.takenBy ? ` (taken: ${option.takenBy.title})` : ""}
                </option>
              ))}
            </select>
            {err("startDate") && <span className="error" id="start-week-error">{err("startDate")}</span>}
          </div>
          <div className="field">
            <label htmlFor="end-week">Runs until</label>
            <select id="end-week" value={endValue} aria-invalid={invalid("endDate")} aria-describedby={describedBy("endDate", "weeks-hint")}
              onChange={(e) => pickEnd(e.target.value)}>
              {!endValue && <option value="">Choose the last day</option>}
              {endOptions.map((option) => (
                <option key={option.value} value={option.value} disabled={Boolean(option.takenBy) && option.value !== endValue}>
                  {option.label}{option.takenBy ? ` (overlaps ${option.takenBy.title})` : ""}
                </option>
              ))}
            </select>
            {err("endDate") && <span className="error" id="end-week-error">{err("endDate")}</span>}
          </div>
          <span className="hint" id="weeks-hint">
            {startLocked
              ? "The start is locked because people have joined. You can still change when it ends, as long as that isn’t in the past."
              : `Themes run Monday 12:00 AM to Sunday 11:59 PM ${THEME_TIME_ZONE_LABEL}, for one or two weeks. Weeks that already have a theme are marked taken.`}
          </span>
        </div>

        <div className="section">
          <h2>Goal &amp; reward</h2>
          <div className="row">
            <div className="field">
              <label htmlFor="goal">Goal</label>
              <input id="goal" type="number" min={1} max={THEME_LIMITS.goalMax} step="any" inputMode="decimal" value={Number.isNaN(draft.goal) ? "" : draft.goal}
                aria-invalid={invalid("goal")} aria-describedby={describedBy("goal")} onChange={(e) => set("goal", e.target.valueAsNumber)} />
              {err("goal") && <span className="error" id="goal-error">{err("goal")}</span>}
            </div>
            <div className="field">
              <label htmlFor="unit">Unit</label>
              <input id="unit" list="unit-suggestions" value={draft.goalUnit} maxLength={THEME_LIMITS.goalUnitMax}
                aria-invalid={invalid("goalUnit")} aria-describedby={describedBy("goalUnit")} onChange={(e) => set("goalUnit", e.target.value)} />
              <datalist id="unit-suggestions">{units.map((unit) => <option key={unit} value={unit} />)}</datalist>
              {err("goalUnit") && <span className="error" id="unit-error">{err("goalUnit")}</span>}
            </div>
          </div>
          <div className="field">
            <label htmlFor="points">Points reward</label>
            <input id="points" type="number" min={0} max={THEME_LIMITS.pointsMax} step={1} inputMode="numeric" value={Number.isNaN(draft.pointsReward) ? "" : draft.pointsReward}
              aria-invalid={invalid("pointsReward")} aria-describedby={describedBy("pointsReward", "points-hint")} onChange={(e) => set("pointsReward", e.target.valueAsNumber)} />
            <span className="hint" id="points-hint">Added to a member’s points when an organizer approves their entry (0 to {THEME_LIMITS.pointsMax}).</span>
            {err("pointsReward") && <span className="error" id="points-error">{err("pointsReward")}</span>}
          </div>
          {editing && theme && (
            <p className="hint">{theme.participantCount} joined · {theme.completedCount} completed. These counts update as members take part.</p>
          )}
        </div>

        <div className="actions">
          <button className="big-pill dark" type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Create theme"}</button>
            <button className="big-pill gray" type="button" disabled={saving} onClick={() => (dirty ? setDiscarding(true) : router.push("/themes/"))}>Cancel</button>
        </div>
      </form>
      <ThemePreview draft={draft} participantCount={theme?.participantCount ?? 0} />
      {discarding && (
        <Dialog danger title="Discard your changes?" confirmLabel="Discard changes" onClose={() => setDiscarding(false)}
          onConfirm={async () => { setSaved(true); router.push("/themes/"); }}>
          <p>{editing ? "The changes you made to this theme" : "The theme you started"} won’t be saved.</p>
        </Dialog>
      )}
    </div>
  );
}
