"use client";
// @i18n-migrated

import { type ReactNode, createContext, useCallback, useContext, useId, useRef, useState } from "react";
import { type AiCredits, type ThemeSuggestion, can } from "@/lib/adminTypes";
import { t } from "@/lib/aiStrings";
import { ApiError } from "@/lib/contract";
import { resetDate } from "@/lib/credits";
import { getLocale } from "@/lib/i18n";
import { labelOf } from "@/lib/suggestionLabels";
import { type FillField, fieldList } from "@/lib/themeSuggest";
import { useApp } from "./AppProvider";
import { DipbotAction } from "./DipbotAction";
import { DipbotMark } from "./DipbotMark";
import { Button, ErrorNotice, InlineNotice } from "./kit";
import { useLoad } from "./useLoad";

/**
 * Suggest theme (suggestThemeV1) on the New theme page. The provider owns the request; the header button starts it and
 * the form applies the answer in place (ThemeForm). Admins only, and only while Dipbot and theme suggestions are on for
 * the company (the context call is free). See docs/design/stretch/dipbot-suggest-theme.md.
 */

export type SuggestPhase = "idle" | "loading" | "done" | "error";

export interface SuggestRun {
  /** Increments on every answer, so the form applies each one exactly once. */
  id: number;
  list: ThemeSuggestion[];
  outcome: "suggested" | "fallback";
}

export interface ThemeSuggestController {
  available: boolean;
  cost: number;
  credits: AiCredits | null;
  out: boolean;
  phase: SuggestPhase;
  /** Increments on every press (and retry), so a closed card comes back with the next one. */
  attempt: number;
  run: SuggestRun | null;
  error: unknown;
  start: (hint?: string) => void;
  retry: () => void;
}

const Ctx = createContext<ThemeSuggestController | null>(null);

/** The controller for the New theme page; null elsewhere (the edit page has no Suggest theme). */
export const useThemeSuggest = () => useContext(Ctx);

export function ThemeSuggestProvider({ children }: { children: ReactNode }) {
  const { api, session } = useApp();
  const allowed = can(session?.role, "ai.generate");
  const ctx = useLoad((a) => (allowed ? a.eventIdeaContext() : Promise.resolve(null)), `event-idea-context:${allowed}`).data;
  const [latest, setCredits] = useState<AiCredits | null>(null);
  const [phase, setPhase] = useState<SuggestPhase>("idle");
  const [run, setRun] = useState<SuggestRun | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  // One key per press; a retry of a failed press reuses it so a lost answer is never charged twice.
  const last = useRef<{ requestId: string; hint: string } | null>(null);
  const runs = useRef(0);
  const busy = useRef(false);

  // The balance after the last answer wins over the one the page loaded with.
  const credits = latest ?? ctx?.credits ?? null;

  const available = Boolean(allowed && ctx?.enabled && ctx.themeSuggestEnabled);
  const cost = credits?.creditCost.themeSuggest ?? 2;
  const out = credits !== null && credits.creditsRemaining < cost;

  const send = useCallback(async (requestId: string, hint: string) => {
    if (busy.current) return;
    busy.current = true;
    last.current = { requestId, hint };
    setPhase("loading");
    setAttempt((n) => n + 1);
    setError(null);
    try {
      const result = await api.suggestTheme({ requestId, ...(hint ? { hint } : {}), locale: getLocale() === "es" ? "es" : "en" });
      setCredits(result.credits);
      runs.current += 1;
      setRun({ id: runs.current, list: [result.suggestion, ...result.alternatives], outcome: result.outcome });
      setPhase("done");
      last.current = null;
    } catch (failure) {
      if (failure instanceof ApiError && failure.reason === "AI_CREDITS_EXHAUSTED") {
        setCredits((c) => { const base = c ?? ctx?.credits ?? null; return base ? { ...base, creditsRemaining: 0 } : base; });
      }
      setError(failure);
      setPhase("error");
    } finally {
      busy.current = false;
    }
  }, [api, ctx]);

  const start = useCallback((hint = "") => { void send(crypto.randomUUID(), hint.trim()); }, [send]);
  const retry = useCallback(() => {
    const previous = last.current;
    if (previous) void send(previous.requestId, previous.hint);
    else start();
  }, [send, start]);

  const value: ThemeSuggestController = { available, cost, credits, out, phase, attempt, run, error, start, retry };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The header action: "Suggest theme | 2 credits". Renders nothing when Suggest theme is not available. */
export function SuggestThemeAction() {
  const ctl = useThemeSuggest();
  if (!ctl?.available) return null;
  const reason = ctl.out && ctl.credits ? t("limit.AI_CREDITS_EXHAUSTED", { date: resetDate(ctl.credits.resetsAt) }) : undefined;
  return (
    <DipbotAction className="theme-suggest-btn" label={t("themeSuggest.button")} shortLabel={t("themeSuggest.buttonShort")} credits={ctl.cost}
      loading={ctl.phase === "loading"} loadingLabel={t("themeSuggest.loadingLabel")} disabled={ctl.out} disabledReason={reason}
      aria-controls="theme-suggest" onClick={() => ctl.start()} />
  );
}

/** "Dipbot suggested this", beside a field label Dipbot filled. */
export function SuggestedTag() {
  return <span className="dipbot-tag"><DipbotMark size={14} /><span>{t("themeSuggest.picked")}</span></span>;
}

export interface PanelState {
  index: number;
  applied: boolean;
  filled: FillField[];
  kept: FillField[];
}

interface PanelProps {
  ctl: ThemeSuggestController;
  state: PanelState | null;
  onAnother: () => void;
  onUndo: () => void;
  onReapply: () => void;
  onReplaceKept: () => void;
  onClose: () => void;
}

/** The suggestion card at the top of the form: what Dipbot filled and why, Another idea, Undo and a hint to try again. */
export function ThemeSuggestPanel({ ctl, state, onAnother, onUndo, onReapply, onReplaceKept, onClose }: PanelProps) {
  const uid = useId();
  const [hint, setHint] = useState("");
  const { phase, run } = ctl;
  if (phase === "idle") {
    // Out of credits before the first press: say why the header action is off, on the page (a tooltip alone is not enough on touch).
    return ctl.out && ctl.credits
      ? <InlineNotice tone="info" className="ts-out">{t("limit.AI_CREDITS_EXHAUSTED", { date: resetDate(ctl.credits.resetsAt) })}</InlineNotice>
      : null;
  }
  const current = run && state ? run.list[state.index] ?? null : null;
  const loading = phase === "loading";
  const total = run?.list.length ?? 0;
  const resetsAt = ctl.credits?.resetsAt ?? "";
  const exhausted = phase === "error" && ctl.error instanceof ApiError && ctl.error.reason === "AI_CREDITS_EXHAUSTED";
  const again = () => { if (!loading) ctl.start(hint); };

  return (
    <section id="theme-suggest" className="theme-suggest" aria-labelledby={`${uid}-title`} aria-busy={loading || undefined}>
      {loading && (
        <div className="ts-loading" role="status">
          <span className="ts-spin" aria-hidden><DipbotMark size={16} /></span>
          <span id={`${uid}-title`}>{t("themeSuggest.loading")}</span>
        </div>
      )}
      {phase === "error" && (exhausted
        ? <InlineNotice tone="warn" className="ts-notice">{t("limit.AI_CREDITS_EXHAUSTED", { date: resetDate(resetsAt) })}</InlineNotice>
        : <ErrorNotice error={ctl.error} className="ts-notice" dipbot fallback={t("themeSuggest.error")} onRetry={ctl.retry} retryLabel={t("themeSuggest.retry")} />)}
      {phase === "error" && (
        <div className="ts-head ts-head-error">
          <h2 id={`${uid}-title`} className="sr-only">{t("themeSuggest.button")}</h2>
          <button type="button" className="ts-close link-btn" onClick={onClose}>{t("themeSuggest.close")}</button>
        </div>
      )}

      {!loading && current && state && (
        <>
          <div className="ts-head">
            <DipbotMark size={16} />
            <h2 id={`${uid}-title`} className="ts-title">{t(state.applied ? "themeSuggest.title" : "themeSuggest.titleUndone", { title: current.title })}</h2>
            {state.applied && current.fitLabel && (
              <span className="sg-tag" data-level={current.fitLabel}>
                <span aria-hidden>{labelOf(current.fitLabel)}</span>
                <span className="sr-only">{t("ideasForYou.fitSpoken", { label: labelOf(current.fitLabel).toLowerCase() })}</span>
              </span>
            )}
            {total > 1 && <span className="ts-count">{t("themeSuggest.position", { n: state.index + 1, total })}</span>}
            <button type="button" className="ts-close link-btn" onClick={onClose}>{t("themeSuggest.close")}</button>
          </div>
          {state.applied && <div className="ts-why">
            <span className="ts-label">{t("themeSuggest.whyLabel")}</span>
            <ul>{current.why.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>}
          {run?.outcome === "fallback" && <p className="ts-note">{t("themeSuggest.catalogNote")}</p>}
          {state.applied ? (
            <>
              {state.filled.length > 0 && <p className="ts-note">{t("themeSuggest.filled", { fields: fieldList(state.filled) })}</p>}
              {state.kept.length > 0 && <p className="ts-note">{t("themeSuggest.kept", { fields: fieldList(state.kept) })}</p>}
            </>
          ) : <p className="ts-note">{t("themeSuggest.undone")}</p>}
          <div className="ts-actions">
            {total > 1 && (
              <Button size="sm" onClick={onAnother}>{t("themeSuggest.another")}</Button>
            )}
            {state.applied && state.kept.length > 0 && <Button size="sm" onClick={onReplaceKept}>{t("themeSuggest.replaceKept")}</Button>}
            {state.applied
              ? <Button size="sm" onClick={onUndo}>{t("themeSuggest.undo")}</Button>
              : <Button size="sm" onClick={onReapply}>{t("themeSuggest.reapply")}</Button>}
          </div>
        </>
      )}

      {!loading && phase !== "error" && (
        <div className="ts-hint field">
          <label htmlFor={`${uid}-hint`}>{t("themeSuggest.hintLabel")}</label>
          <div className="ts-hint-row">
            <input id={`${uid}-hint`} value={hint} maxLength={200} placeholder={t("themeSuggest.hintPlaceholder")} onChange={(e) => setHint(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (!ctl.out) again(); } }} />
            <DipbotAction size="sm" label={t("themeSuggest.again")} credits={ctl.cost} disabled={ctl.out}
              disabledReason={ctl.out ? t("limit.AI_CREDITS_EXHAUSTED", { date: resetDate(resetsAt) }) : undefined} onClick={again} />
          </div>
        </div>
      )}
    </section>
  );
}
