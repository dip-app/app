"use client";
// @i18n-migrated

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTags } from "./TagCatalog";
import {
  THEME_LIMITS, THEME_REASONS, type ThemeDraft, type WeeklyTheme, endWeekOptions, findOverlap, firstFreeMonday,
  normalizeThemeDraft, overlapMessage, startWeekOptions, validateThemeDraft, windowLocked,
} from "@/lib/challenge";
import { ApiError, type FieldErrors } from "@/lib/contract";
import { THEMES, resolveTheme } from "@/lib/themes";
import { parseThemeSnapshot, restoreTheme, themeSnapshot } from "@/lib/formDraftSnapshots";
import { useFormDraft } from "@/lib/useFormDraft";
import { t } from "@/lib/i18n";
import {
  themeTimeZoneLabel, addDays, formatWindow, lastDayOfIso, mondayOfIso, nextMonday, weekEndIso, weekStartIso,
} from "@/lib/weeks";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { useApp } from "./AppProvider";
import { Dialog } from "./Dialog";
import { DraftOffer, DraftStatusLine, agoText } from "./DraftUi";
import { RadioGrid } from "./RadioGrid";
import { ThemeArt } from "./ThemeArt";
import { ThemePreview } from "./ThemePreview";
import { toast } from "./Toast";
import { Button, ChipToggle, InlineNotice } from "@/components/kit";
import { saveFailureMessage, userErrorMessage } from "@/lib/userError";
import type { ThemeSuggestField } from "@/lib/adminTypes";
import { applySuggestion, fieldList } from "@/lib/themeSuggest";
import { t as tAi } from "@/lib/aiStrings";
import { type PanelState, type SuggestRun, SuggestedTag, ThemeSuggestPanel, useThemeSuggest } from "./ThemeSuggest";

interface Props {
  /** Present when editing. */
  theme?: WeeklyTheme;
  /** Called when the user asks to discard local edits and reload the latest saved theme. */
  onReload?: () => void;
}

/** Which Suggest theme field a draft key belongs to (the admin's own edits are never overwritten without asking). */
const SUGGEST_FIELD_OF: Partial<Record<keyof ThemeDraft, ThemeSuggestField>> = {
  title: "title", description: "description", tagIds: "tags", startDate: "week", endDate: "week", coverImageURL: "illustration",
};

interface SuggestUndo { draft: ThemeDraft; mine: Set<ThemeSuggestField>; dipbot: Set<ThemeSuggestField>; touched: { tags: boolean; weeks: boolean }; edited: boolean }

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
  const { api, session } = useApp();
  const router = useRouter();
  const editing = Boolean(theme);
  // Once people have joined or completed, the start stays put (server: WINDOW_CHANGE_BLOCKED).
  const startLocked = Boolean(theme && windowLocked(theme));
  const [draft, setDraft] = useState<ThemeDraft>(() => (theme ? normalizeThemeDraft(theme) : newDraft()));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  // A save that failed without a field to fix: focus the alert so it is read and seen (fields get focus themselves).
  useEffect(() => {
    if (failure && Object.keys(failure.fields).length === 0) failureRef.current?.focus();
  }, [failure]);
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

  // New themes autosave to this browser (docs/design/admin-drafts.md). Editing a saved theme has no draft.
  const snapshot = useMemo(() => themeSnapshot(draft), [draft]);
  const scope = useMemo(() => (session ? { uid: session.uid, companyId: session.companyId } : null), [session]);
  const picked = resolveTheme(draft.coverImageURL);
  // Only the defaults a theme starts with (and its tags and weeks, which the page fills in) are not worth keeping.
  const hasContent = edited && (
    draft.coverImageURL !== THEMES[0].url || draft.title !== picked.displayName || draft.description !== picked.defaultDescription
    || draft.goal !== picked.defaultGoal || draft.goalUnit !== picked.goalUnits[0] || draft.pointsReward !== 50
  );
  const autosave = useFormDraft({ kind: "theme", scope, enabled: !editing, value: snapshot, touched: edited && !saved, meaningful: hasContent, parse: parseThemeSnapshot });
  // With autosave the browser's leave-page dialog is only for content that no draft holds (storage blocked or full).
  useUnsavedGuard(editing ? dirty : autosave.unsaved);
  const [restoreNote, setRestoreNote] = useState<"restored" | "weeksReset" | null>(null);
  const [draftDialog, setDraftDialog] = useState<"restore" | "decline" | null>(null);
  const focusFirst = () => requestAnimationFrame(() => setTimeout(() => document.getElementById("title")?.focus(), 0));
  function restoreOffer() {
    const taken = autosave.acceptOffer();
    if (!taken) return;
    const restored = restoreTheme(taken.data, catalog.status === "ready" ? catalog.tags.map((tag) => tag.id) : undefined);
    // The weeks are re-checked against today and the themes that exist now: a taken or passed week is never kept silently.
    const open = startWeekOptions(others, new Date()).some((option) => option.value === mondayOfIso(restored.startDate) && !option.takenBy);
    const stale = !open || Number.isNaN(Date.parse(restored.endDate)) || Boolean(findOverlap(restored, others)) || Object.keys(validateThemeDraft(restored, { now: new Date() })).some((key) => key === "startDate" || key === "endDate");
    if (stale) {
      const monday = firstFreeMonday(others, nextMonday());
      restored.startDate = weekStartIso(monday);
      restored.endDate = weekEndIso(addDays(monday, 6));
    }
    touched.current.tags = true;
    touched.current.weeks = true;
    // A restored draft is the admin's own work: Dipbot never fills over it without asking, and its Undo no longer applies.
    mine.current = new Set(SUGGEST_FIELDS);
    setDipbot(new Set());
    undo.current = null;
    setPanel(null);
    if (suggest) setClosedAttempt(suggest.attempt);
    setEdited(true);
    setDraft(restored);
    setErrors({});
    setRestoreNote(stale ? "weeksReset" : "restored");
    focusFirst();
  }
  const offerAgo = autosave.offer ? agoText(autosave.offer.savedAt) : "";
  function leave() {
    setSaved(true);
    autosave.clear({ keepOffer: true });
    router.push("/themes/");
  }

  // Suggest theme (New theme page only): fields the admin changed by hand, fields Dipbot filled, the card and Undo.
  const suggest = useThemeSuggest();
  const mine = useRef(new Set<ThemeSuggestField>());
  const [dipbot, setDipbot] = useState<ReadonlySet<ThemeSuggestField>>(new Set());
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [closedRun, setClosedRun] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const undo = useRef<SuggestUndo | null>(null);
  const markMine = (key: keyof ThemeDraft) => {
    const field = SUGGEST_FIELD_OF[key];
    if (!field) return;
    mine.current.add(field);
    setDipbot((current) => (current.has(field) ? new Set([...current].filter((f) => f !== field)) : current));
  };

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

  const set = <K extends keyof ThemeDraft>(key: K, value: ThemeDraft[K]) => { markMine(key); setEdited(true); setDraft((current) => ({ ...current, [key]: value })); };

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
    markMine("startDate");
    const weeks = endValue && startValue && endValue > addDays(startValue, 6) ? 2 : 1;
    // Picking the saved week again restores the saved instants exactly, even if they aren't week-aligned.
    const startDate = theme && monday === mondayOfIso(theme.startDate) ? theme.startDate : weekStartIso(monday);
    const sunday = addDays(monday, weeks * 7 - 1);
    const endDate = theme && sunday === lastDayOfIso(theme.endDate) ? theme.endDate : weekEndIso(sunday);
    setEdited(true);
    setDraft((current) => ({ ...current, startDate, endDate }));
  }

  /** A free Monday for a suggestion: its own week when the list still shows it free, else the first free week from next Monday. */
  function freeMonday(preferred: string | undefined): string | null {
    const from = nextMonday();
    const open = startOptions.filter((option) => !option.takenBy && option.value >= from);
    return (preferred ? open.find((option) => option.value === preferred)?.value : undefined) ?? open[0]?.value ?? null;
  }

  /** Fills the form from suggestion `index` of `run`: untouched fields only unless `replaceMine`. Undo goes back to before the first fill. */
  function applyRun(run: SuggestRun, index: number, replaceMine = false) {
    const suggestion = run.list[index];
    if (!suggestion) return;
    undo.current ??= { draft, mine: new Set(mine.current), dipbot: new Set(dipbot), touched: { ...touched.current }, edited };
    const result = applySuggestion(draft, suggestion, { mine: mine.current, replaceMine, knownTagIds: tags.length ? tags.map((tag) => tag.id) : null, freeMonday });
    if (replaceMine) for (const field of result.filled) mine.current.delete(field);
    if (result.filled.includes("tags")) touched.current.tags = true;
    if (result.filled.includes("week")) touched.current.weeks = true;
    const owned = new Set([...dipbot, ...result.filled].filter((field) => !mine.current.has(field)));
    const filled = (["illustration", "title", "description", "tags", "week"] as const).filter((field) => owned.has(field));
    setDraft(result.draft);
    setEdited(true);
    setErrors({});
    setDipbot(owned);
    setPanel({ index, applied: true, filled, kept: result.kept });
    setAnnouncement(filled.length ? tAi("themeSuggest.announceFilled", { fields: fieldList(filled) }) : "");
  }

  function undoSuggestion() {
    const saved = undo.current;
    if (!saved) return;
    undo.current = null;
    setDraft(saved.draft);
    mine.current = saved.mine;
    touched.current = saved.touched;
    setDipbot(saved.dipbot);
    setEdited(saved.edited);
    setPanel((current) => (current ? { ...current, applied: false, filled: [], kept: [] } : current));
    setAnnouncement(tAi("themeSuggest.announceUndone"));
  }

  // Each new answer fills the form once (its first suggestion); Another idea moves through the rest.
  const runId = suggest?.run?.id ?? 0;
  useEffect(() => {
    if (suggest?.run) applyRun(suggest.run, 0);
    // Applies once per answer; the handlers read the latest draft through this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  function pickEnd(sunday: string) {
    touched.current.weeks = true;
    markMine("endDate");
    set("endDate", theme && sunday === lastDayOfIso(theme.endDate) ? theme.endDate : weekEndIso(sunday));
  }

  function pickTheme(url: string) {
    const previous = resolveTheme(draft.coverImageURL);
    const next = resolveTheme(url);
    markMine("coverImageURL");
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
      autosave.clear();
      toast(t(editing ? "themeForm.toast.saved" : "themeForm.toast.created", { title: candidate.title }));
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
            ? t("themeForm.error.overlap", { window: formatWindow(error.conflict.startDate, error.conflict.endDate) })
            : userErrorMessage(error);
        setErrors({ startDate: message });
        setFailure(new ApiError(error.code, message, { startDate: message }, error.reason, error.conflict));
        focusFirstInvalid({ startDate: message });
        return;
      }
      // A lost response is ambiguous: creates are safe to retry (same requestId); edits must reload the
      // saved revision before saving again, per the callable contract.
      const apiError = error instanceof ApiError ? error : new ApiError(
        editing ? "aborted" : "failed-precondition",
        t(editing ? "themeForm.error.unconfirmedSave" : "themeForm.error.createFailed"),
      );
      setFailure(apiError);
      if (apiError.fields) { setErrors(apiError.fields); focusFirstInvalid(apiError.fields); }
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
        {autosave.offer && (
          <DraftOffer kind="theme" ago={offerAgo} replaces={hasContent} onRestore={() => (hasContent ? setDraftDialog("restore") : restoreOffer())} onDiscard={() => setDraftDialog("decline")} />
        )}
        {restoreNote && (
          <InlineNotice tone={restoreNote === "weeksReset" ? "warn" : "info"} className="draft-restored">
            {t(restoreNote === "weeksReset" ? "drafts.restored.weeksReset" : "drafts.restored")}
          </InlineNotice>
        )}
        {suggest && suggest.phase !== "idle" && !(suggest.phase === "done" && closedRun === runId) && (
          <ThemeSuggestPanel ctl={suggest} state={panel}
            onAnother={() => suggest.run && panel && applyRun(suggest.run, (panel.index + 1) % suggest.run.list.length)}
            onUndo={undoSuggestion}
            onReapply={() => suggest.run && panel && applyRun(suggest.run, panel.index)}
            onReplaceKept={() => suggest.run && panel && applyRun(suggest.run, panel.index, true)}
            onClose={() => setClosedRun(runId)} />
        )}
        {suggest && <p className="sr-only" role="status" aria-live="polite">{announcement}</p>}
        {Object.keys(errors).length > 0 && !failure && (
          <InlineNotice tone="error">{t("themeForm.fixFields", { count: Object.keys(errors).length })}</InlineNotice>
        )}
        {failure && (
          <InlineNotice tone="error" ref={failureRef} announce={Object.keys(failure.fields).length > 0} title={t("failure.title.save")}
            action={failure.code === "aborted" && onReload ? <Button variant="plain" onClick={onReload}>{t("themeForm.reloadLatest")}</Button> : undefined}>
            {saveFailureMessage(failure, Boolean(onReload))}
          </InlineNotice>
        )}

        <div className="section wide">
          <fieldset className="field">
            <legend>{t("themeForm.theme")}{dipbot.has("illustration") && <SuggestedTag />}</legend>
            <span className="hint">{t("themeForm.themeHint")}</span>
            <RadioGrid label={t("themeForm.theme")} value={draft.coverImageURL} onChange={pickTheme} optionClassName="theme-option"
              describedBy={err("coverImageURL") ? "theme-first-error" : undefined} invalid={!!err("coverImageURL")}
              options={THEMES.map((option, index) => ({
                value: option.url, label: option.displayName, id: index === 0 ? "theme-first" : undefined,
                content: <><ThemeArt url={option.url} className="swatch" /><span>{option.displayName}</span></>,
              }))} />
            {selected.whyItsFun && (
              <span className="hint" aria-live="polite"><strong>{t("themeForm.whyItsFun")}</strong> {selected.whyItsFun} {t("themeForm.membersPost", { prompt: selected.submissionPrompt })}</span>
            )}
            {err("coverImageURL") && <span className="error" id="theme-first-error">{err("coverImageURL")}</span>}
          </fieldset>
          <div className="field">
            <label htmlFor="title">{t("themeForm.titleLabel")}{dipbot.has("title") && <SuggestedTag />}</label>
            <input id="title" aria-describedby={describedBy("title", "title-hint")} value={draft.title} maxLength={THEME_LIMITS.titleMax} aria-invalid={invalid("title")} onChange={(e) => set("title", e.target.value)} />
            <span className="hint" id="title-hint">{t("themeForm.titleHint")}</span>
            {err("title") && <span className="error" id="title-error">{err("title")}</span>}
          </div>
          <div className="field">
            <label htmlFor="description">{t("themeForm.description")}{dipbot.has("description") && <SuggestedTag />}</label>
            <textarea id="description" aria-describedby={describedBy("description")} value={draft.description} maxLength={THEME_LIMITS.descriptionMax} aria-invalid={invalid("description")} onChange={(e) => set("description", e.target.value)} />
            {err("description") && <span className="error" id="description-error">{err("description")}</span>}
          </div>
          <fieldset className="field">
            <legend>{t("themeForm.tags")}{dipbot.has("tags") && <SuggestedTag />}</legend>
            <div className="chips">
              {catalog.status === "loading" && <span className="hint">{t("themeForm.tagsLoading")}</span>}
              {catalog.status === "error" && <span className="hint">{t("themeForm.tagsError")} <button type="button" className="link-btn" onClick={catalog.reload}>{t("themeForm.tagsRetry")}</button></span>}
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
          <h2>{t("themeForm.weeks")}</h2>
          <div className="field">
            <label htmlFor="start-week">{t("themeForm.firstWeek")}{dipbot.has("week") && <SuggestedTag />}</label>
            <select id="start-week" value={startValue} disabled={startLocked} aria-invalid={invalid("startDate")} aria-describedby={describedBy("startDate", "weeks-hint")}
              onChange={(e) => pickStart(e.target.value)}>
              {!startValue && <option value="">{t("themeForm.chooseWeek")}</option>}
              {startOptions.map((option) => (
                <option key={option.value} value={option.value} disabled={Boolean(option.takenBy) && option.value !== startValue}>
                  {option.takenBy ? t("themeForm.optionTaken", { label: option.label, title: option.takenBy.title }) : option.label}
                </option>
              ))}
            </select>
            {err("startDate") && <span className="error" id="start-week-error">{err("startDate")}</span>}
          </div>
          <div className="field">
            <label htmlFor="end-week">{t("themeForm.runsUntil")}</label>
            <select id="end-week" value={endValue} aria-invalid={invalid("endDate")} aria-describedby={describedBy("endDate", "weeks-hint")}
              onChange={(e) => pickEnd(e.target.value)}>
              {!endValue && <option value="">{t("themeForm.chooseLastDay")}</option>}
              {endOptions.map((option) => (
                <option key={option.value} value={option.value} disabled={Boolean(option.takenBy) && option.value !== endValue}>
                  {option.takenBy ? t("themeForm.optionOverlaps", { label: option.label, title: option.takenBy.title }) : option.label}
                </option>
              ))}
            </select>
            {err("endDate") && <span className="error" id="end-week-error">{err("endDate")}</span>}
          </div>
          <span className="hint" id="weeks-hint">
            {startLocked ? t("themeForm.weeksHintLocked") : t("themeForm.weeksHint", { zone: themeTimeZoneLabel() })}
          </span>
        </div>

        <div className="section">
          <h2>{t("themeForm.goalReward")}</h2>
          <div className="row">
            <div className="field">
              <label htmlFor="goal">{t("themeForm.goal")}</label>
              <input id="goal" type="number" min={1} max={THEME_LIMITS.goalMax} step="any" inputMode="decimal" value={Number.isNaN(draft.goal) ? "" : draft.goal}
                aria-invalid={invalid("goal")} aria-describedby={describedBy("goal")} onChange={(e) => set("goal", e.target.valueAsNumber)} />
              {err("goal") && <span className="error" id="goal-error">{err("goal")}</span>}
            </div>
            <div className="field">
              <label htmlFor="unit">{t("themeForm.unit")}</label>
              <input id="unit" list="unit-suggestions" value={draft.goalUnit} maxLength={THEME_LIMITS.goalUnitMax}
                aria-invalid={invalid("goalUnit")} aria-describedby={describedBy("goalUnit")} onChange={(e) => set("goalUnit", e.target.value)} />
              <datalist id="unit-suggestions">{units.map((unit) => <option key={unit} value={unit} />)}</datalist>
              {err("goalUnit") && <span className="error" id="unit-error">{err("goalUnit")}</span>}
            </div>
          </div>
          <div className="field">
            <label htmlFor="points">{t("themeForm.pointsReward")}</label>
            <input id="points" type="number" min={0} max={THEME_LIMITS.pointsMax} step={1} inputMode="numeric" value={Number.isNaN(draft.pointsReward) ? "" : draft.pointsReward}
              aria-invalid={invalid("pointsReward")} aria-describedby={describedBy("pointsReward", "points-hint")} onChange={(e) => set("pointsReward", e.target.valueAsNumber)} />
            <span className="hint" id="points-hint">{t("themeForm.pointsHint", { max: THEME_LIMITS.pointsMax })}</span>
            {err("pointsReward") && <span className="error" id="points-error">{err("pointsReward")}</span>}
          </div>
          {editing && theme && (
            <p className="hint">{t("themeForm.counts", { joined: theme.participantCount, completed: theme.completedCount })}</p>
          )}
        </div>

        <div className="actions">
          <button className="big-pill dark" type="submit" disabled={saving}>{saving ? t("themeForm.saving") : editing ? t("themeForm.saveChanges") : t("themeForm.create")}</button>
            <button className="big-pill gray" type="button" disabled={saving} onClick={() => ((editing ? dirty : dirty && hasContent) ? setDiscarding(true) : leave())}>{t("themeForm.cancel")}</button>
          {!editing && <DraftStatusLine status={autosave.status} />}
        </div>
      </form>
      <ThemePreview draft={draft} participantCount={theme?.participantCount ?? 0} />
      {discarding && (
        <Dialog danger title={editing ? t("themeForm.discard.title") : t("drafts.discard.title")} confirmLabel={editing ? t("themeForm.discard.confirm") : t("drafts.discard.confirm")} onClose={() => setDiscarding(false)}
          onConfirm={async () => { leave(); }}>
          <p>{editing ? t("themeForm.discard.bodyEdit") : t("drafts.discard.theme")}</p>
        </Dialog>
      )}
      {draftDialog === "restore" && (
        <Dialog title={t("drafts.replace.title")} confirmLabel={t("drafts.restore")} onClose={() => setDraftDialog(null)}
          onConfirm={async () => { setDraftDialog(null); restoreOffer(); }}>
          <p>{t("drafts.replace.body", { ago: offerAgo })}</p>
        </Dialog>
      )}
      {draftDialog === "decline" && (
        <Dialog danger title={t("drafts.decline.title")} confirmLabel={hasContent ? t("drafts.deleteOld") : t("drafts.startFresh")} onClose={() => setDraftDialog(null)}
          onConfirm={async () => { setDraftDialog(null); autosave.declineOffer(); focusFirst(); }}>
          <p>{t("drafts.decline.body", { ago: offerAgo })}</p>
        </Dialog>
      )}
    </div>
  );
}
