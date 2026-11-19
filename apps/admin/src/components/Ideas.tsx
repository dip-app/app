"use client";
// @i18n-migrated

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AiCredits, AiSuggestionProvider, AiSuggestionQuestion, EventIdeaContext, EventIdeaSuggestions, GenerateDraftsResult, GeneratedEventDraft } from "@/lib/adminTypes";
import { type Art, spotArt, stateArt } from "@/lib/ideaArt";
import { tagArt, tagBlurb } from "@/lib/tagArt";
import {
  type LabeledSuggestion, type SuggestionLevel, QUESTION_STEP, applySuggestions, labelOf, labeledSuggestions, spokenSuggestion, suggestedBy, suggestionsApplied, suggestionsForStep,
} from "@/lib/suggestionLabels";
import { coverByURL, coverImage, lexicalPick } from "@/lib/covers";
import { freshnessLine } from "@/lib/suggestCache";
import { quickAnswers, quickRequested, rememberTimeHint, takeQuick } from "@/lib/dipbotTouches";
import { Considerations } from "./Considerations";
import { SectionHeader } from "./kit";
import { CoverPicker } from "./CoverPicker";
import { Disclosure } from "./Disclosure";
import { ApiError } from "@/lib/contract";
import { userErrorMessage } from "@/lib/userError";
import {
  type Answers, type Attempt, type StepId, BUDGETS, GOALS, GROUP_SIZES, MAX_FOCUS, MAX_PROMPT, RETRYABLE_REASONS, SETTINGS, STEPS, TIMINGS,
  bucketLevel, bucketText, capacityLabel, choicesOf, costLabel, daypartLabel, draftText, durationLabel, emptyAnswers,
  presetAnswers, presetFor, readyToGenerate, requestIdFor, saveAiDraft, signatureOf, stepValid, summaryLines, toggleConsideration, toggleInterest, venueLabel,
} from "@/lib/ideas";
import { t, tMaybe, tn } from "@/lib/aiStrings";
import { t as tText } from "@/lib/i18n";
import { creditsView, resetDate } from "@/lib/credits";
import { useApp } from "./AppProvider";
import { CreditsMeter, CreditsNotice, PrivacyInfo } from "./CreditsMeter";
import { DipbotAction } from "./DipbotAction";
import { DipbotMark } from "./DipbotMark";
import { dismissToast, toast } from "./Toast";
import { IdeasForYou } from "./IdeasForYou";
import { Empty, LoadError, Loading } from "./Ui";
import { useLoad } from "./useLoad";
import { useTags } from "./TagCatalog";
import { useSkeletonGate } from "./useDelayedShow";
import { Button, InlineNotice } from "@/components/kit";

type Phase = "edit" | "generating" | "results" | "error";
/** Quick mode ("Generate suggestions" in the New event header): armed by the button's one-time token, then running. */
type Quick = "none" | "armed" | "running";

/** Remembers Dipbot's best timing bucket for this tab so the editor's "Dipbot suggests" times can use it without a request. */
/** Mirrors the server: AI_DAILY_GENERATIONS_PER_ADMIN=Infinity is sent as this large number, and the per-admin counter is hidden. */
const UNLIMITED_DAILY = 1_000_000;
function rememberTiming(s: EventIdeaSuggestions) {
  const timing = labeledSuggestions(s.suggestions, s.provider, (q, v) => q === "timing" && TIMINGS.some((o) => o.value === v)).timing;
  try { rememberTimeHint(window.sessionStorage, timing ? { timing: timing.value as (typeof TIMINGS)[number]["value"] } : null); } catch { /* storage blocked */ }
}

/** Server reasons with their own copy (aiStrings `limit.<REASON>`); anything else shows the server message. */
function failureMessage(error: unknown, ctx: EventIdeaContext | null): string {
  if (error instanceof ApiError) {
    const n = error.reason === "AI_DAILY_LIMIT" ? ctx?.usage.dailyGenerationLimit : ctx?.usage.monthlyGenerationLimit;
    const known = error.reason ? tMaybe(`limit.${error.reason}`, { n: n ?? "", date: ctx ? resetDate(ctx.credits.resetsAt) : "" }) : null;
    if (known) return known.replace("all  of", "all of");
  }
  return userErrorMessage(error, t("error.offline"), { dipbot: true });
}

const isNoteStep = (id: StepId) => id === "note";

const Check = () => (
  <svg className="opt-check" viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
);

const Sparkle = ({ filled = false }: { filled?: boolean }) => <DipbotMark size={14} strong={filled} />;

interface Shown { level: SuggestionLevel; reason: string; provider: AiSuggestionProvider; flash?: boolean }

/** Informational outline tag (not a control): label plus a hover/focus tooltip with who suggested it and why. */
function SuggestTag({ s }: { s: Shown }) {
  return (
    <span className="sg-tag" data-level={s.level}>
      <Sparkle filled={s.level === "perfect"} />
      <span aria-hidden>{labelOf(s.level)}</span>
      <span className="sr-only">. {spokenSuggestion(s.level, s.provider)}. {s.reason}</span>
      <span className="sg-tip" aria-hidden><strong>{suggestedBy(s.provider)}</strong><span>{s.reason}</span></span>
    </span>
  );
}

function OptArt({ art }: { art: Art }) {
  return (
    <span className="opt-art" data-kind={art.kind} style={{ background: art.bg }} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, unoptimized images */}
      <img src={art.src} alt="" loading="lazy" draggable={false} />
    </span>
  );
}

interface OptionProps {
  type: "radio" | "checkbox"; name: string; label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: () => void;
  children?: React.ReactNode; art?: Art; suggestion?: Shown | null;
}
function Option({ type, name, label, hint, checked, disabled, onChange, children, art, suggestion }: OptionProps) {
  return (
    <label className="opt" data-flash={suggestion?.flash && checked ? "true" : undefined} data-disabled={disabled ? "true" : undefined} data-suggested={suggestion ? suggestion.level : undefined} data-art={art ? "true" : undefined}>
      <input className="opt-input" type={type} name={name} checked={checked} disabled={disabled} onChange={onChange} />
      <span className="opt-body">
        {art && <OptArt art={art} />}
        <span className="opt-text">
          <span className="opt-name" title={label}>{label}</span>
          {hint && <span className="opt-meta" title={hint}>{hint}</span>}
          {children}
          {suggestion && <span className="opt-sg"><SuggestTag s={suggestion} /></span>}
        </span>
        <Check />
      </span>
    </label>
  );
}

export function Ideas() {
  const { api } = useApp();
  const router = useRouter();
  const ctxState = useLoad((a) => a.eventIdeaContext(), "event-idea-context");
  const ctx = ctxState.data;
  const holdIdeas = useSkeletonGate(!ctx && !ctxState.error);
  const catalog = useTags();
  const tagName = catalog.nameFor;
  const [answers, setAnswers] = useState<Answers>(emptyAnswers);
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>("edit");
  const [result, setResult] = useState<GenerateDraftsResult | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [noteError, setNoteError] = useState("");
  const attempt = useRef<Attempt | null>(null);
  const run = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const noteField = useRef<HTMLTextAreaElement>(null);
  const moved = useRef(false);
  const presetDone = useRef(false);
  const noteId = useId();
  // Suggestions: ONE fetch per page load. The server answers from the saved company suggestions (free, no model call)
  // and only computes on the very first visit; nothing here refetches on step changes, back/forward or tab refocus.
  // The only other request is the explicit "Refresh" button.
  const [suggest, setSuggest] = useState<EventIdeaSuggestions | "loading" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [slow, setSlow] = useState(false);
  const [settled, setSettled] = useState(false); // the suggestions request finished (answered or failed)
  const [quick, setQuick] = useState<Quick>("none");
  const quickChecked = useRef(false);
  const enabled = ctx?.enabled === true;
  // The suggestions answer carries the balance (a first visit or refresh costs a credit); fold it into the meter.
  const ctxRef = useRef<{ ctx: EventIdeaContext | null; setData: (next: EventIdeaContext) => void }>({ ctx: null, setData: () => undefined });
  ctxRef.current = { ctx, setData: ctxState.setData };
  const applyCredits = useCallback((credits: AiCredits) => {
    const { ctx: latest, setData } = ctxRef.current;
    if (latest) setData({ ...latest, credits });
  }, []);
  const foldCredits = useCallback((s: EventIdeaSuggestions) => {
    if (s.credits) applyCredits(s.credits);
  }, [applyCredits]);
  // "Customize with Dipbot" (Ideas for you): the idea's choices become the answers and the wizard opens on its last step.
  const customize = useCallback((next: Answers) => {
    attempt.current = null;
    run.current += 1;
    moved.current = true;
    setAnswers(next);
    setResult(null);
    setFailure(null);
    setNoteError("");
    setStep(STEPS.length - 1);
    setPhase("edit");
    // Already on that step: the step effect does not fire, so move focus to its heading directly.
    requestAnimationFrame(() => heading.current?.focus());
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setSuggest("loading");
    api.eventIdeaSuggestions()
      .then((s) => {
        if (!live) return;
        setSuggest(s);
        foldCredits(s);
        rememberTiming(s);
        setSettled(true);
      })
      .catch(() => { if (live) { setSuggest(null); setSettled(true); } });
    return () => { live = false; };
  }, [api, enabled, foldCredits]);
  // A saved answer loads fast; the loading line shows only when the first visit is really computing.
  useEffect(() => {
    if (suggest !== "loading") { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), 700);
    return () => clearTimeout(timer);
  }, [suggest]);
  const refreshSuggestions = useCallback(async () => {
    if (refreshing || !suggest || suggest === "loading") return;
    const before = suggest.computedAt;
    setRefreshing(true);
    try {
      const s = await api.eventIdeaSuggestions({ refresh: true, requestId: crypto.randomUUID() });
      setSuggest(s);
      foldCredits(s);
      rememberTiming(s);
      const id = toast(t(s.computedAt !== before ? "suggest.refreshed" : "suggest.refreshFailed"));
      setTimeout(() => dismissToast(id), 2500);
    } catch {
      const id = toast(t("suggest.refreshFailed"));
      setTimeout(() => dismissToast(id), 2500);
    } finally {
      setRefreshing(false);
    }
  }, [api, foldCredits, refreshing, suggest]);
  const panelRef = useRef<HTMLElement>(null);
  // "Let Dipbot pick for me" highlights what it selected for a moment.
  const [flashing, setFlashing] = useState(false);
  // After "Use suggestions" the stepper shows every answered step as complete while the admin stays on the current one.
  const [usedAll, setUsedAll] = useState(false);
  const lastToast = useRef(0);
  useEffect(() => {
    if (!flashing) return;
    const timer = setTimeout(() => setFlashing(false), 1600);
    return () => clearTimeout(timer);
  }, [flashing]);

  const goStep = useCallback((index: number) => {
    moved.current = true;
    if (lastToast.current) dismissToast(lastToast.current);
    setStep(index);
    setPhase("edit");
  }, []);

  // On phones the tab row scrolls: keep the current tab in view.
  useEffect(() => {
    const item = document.querySelector<HTMLElement>('.ideas .stepper-item[data-state="current"]');
    item?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [step, phase]);

  // Focus follows the step: keyboard and screen reader users land on the new heading.
  useEffect(() => {
    if (moved.current && phase === "edit") heading.current?.focus();
  }, [step, phase]);

  // The suggested card is brought into view when it is off screen (never selected for the admin).
  useEffect(() => {
    if (phase !== "edit" || typeof window === "undefined") return;
    const card = panelRef.current?.querySelector<HTMLElement>(".opt[data-suggested]");
    if (!card) return;
    // The page scrolls inside <main>, so "on screen" means inside that scroller's box, not the window's.
    const box = card.getBoundingClientRect();
    const view = card.closest("main")?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
    if (box.top >= view.top && box.bottom <= view.bottom) return;
    card.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [step, phase, suggest, flashing]);

  const generate = useCallback(async (source: Answers, regenerate: boolean) => {
    const choices = choicesOf(source);
    if (!choices) return;
    const prompt = source.prompt.trim();
    const signature = signatureOf(choices, prompt, source.count, source.considerations);
    const requestId = requestIdFor(attempt.current, signature, regenerate, () => crypto.randomUUID());
    attempt.current = { requestId, signature, retryable: false };
    const mine = ++run.current;
    moved.current = true;
    setPhase("generating");
    setFailure(null);
    setNoteError("");
    try {
      const response = await api.generateEventDrafts({ requestId, choices, prompt, count: source.count, considerations: source.considerations });
      if (mine !== run.current) return;
      setResult(response);
      ctxState.setData({ ...(ctx as EventIdeaContext), usage: response.usage, credits: response.credits });
      setPhase("results");
    } catch (error) {
      if (mine !== run.current) return;
      const reason = error instanceof ApiError ? error.reason : undefined;
      attempt.current = { requestId, signature, retryable: !(error instanceof ApiError) || (reason !== undefined && RETRYABLE_REASONS.includes(reason)) };
      if (reason === "AI_PROMPT_REJECTED") {
        setNoteError(error instanceof ApiError ? (error.fields.prompt ?? userErrorMessage(error)) : "");
        setStep(STEPS.length - 1);
        setPhase("edit");
        requestAnimationFrame(() => noteField.current?.focus());
        return;
      }
      if (reason === "AI_DISABLED" && ctx) ctxState.setData({ ...ctx, enabled: false });
      // Limits changed on the server: refresh the meter without losing the screen.
      if (reason && /LIMIT|BUDGET|CREDITS/.test(reason)) ctxState.reload();
      setFailure(error);
      setPhase("error");
    }
  }, [api, ctx, ctxState]);

  // Mock preview only: ?step=1..5 or ?step=results opens that state with preset answers.
  useEffect(() => {
    if (!ctx || presetDone.current || api.mode !== "mock") return;
    presetDone.current = true;
    const wanted = new URLSearchParams(window.location.search).get("step");
    if (!wanted || !ctx.enabled) return;
    if (wanted === "results") {
      const preset = presetAnswers();
      setAnswers(preset);
      setStep(STEPS.length - 1);
      void generate(preset, false);
      return;
    }
    const index = Number(wanted) - 1;
    if (Number.isInteger(index) && index >= 0 && index < STEPS.length) {
      setAnswers(index === STEPS.length - 1 ? { ...presetFor(4), prompt: "" } : presetFor(index + 1));
      setStep(index);
    }
  }, [ctx, api.mode, generate]);

  // Quick mode needs BOTH ?quick=1 and the one-time token the button set; a bookmark or a reload shows the wizard.
  useEffect(() => {
    if (quickChecked.current) return;
    quickChecked.current = true;
    if (!quickRequested(window.location.search)) return;
    let armed = false;
    try { armed = takeQuick(window.sessionStorage); } catch { /* storage blocked: the wizard opens normally */ }
    const rest = new URLSearchParams(window.location.search); // a reload must not repeat it
    rest.delete("quick");
    window.history.replaceState(null, "", `${window.location.pathname}${rest.size ? `?${rest}` : ""}`);
    if (armed) setQuick("armed");
  }, []);
  // Armed: once the saved suggestions and the tag catalog are in, answer every step as Dipbot would (safe defaults where
  // it has no suggestion), then start the drafts once. A refused or failed run lands on the normal error panel.
  useEffect(() => {
    if (quick !== "armed" || !ctx || !settled || catalog.status === "loading") return;
    if (!ctx.enabled) { setQuick("none"); return; }
    setQuick("running");
    const ids = ctx.interestDataAvailable ? ctx.topInterests.map((i) => i.tagId) : catalog.tags.map((tag) => tag.id);
    const options: Record<AiSuggestionQuestion, readonly string[]> = {
      interest: ids, goal: GOALS.map((o) => o.value), groupSize: GROUP_SIZES.map((o) => o.value),
      setting: SETTINGS.map((o) => o.value), budget: BUDGETS.map((o) => o.value), timing: TIMINGS.map((o) => o.value),
    };
    const have = suggest && suggest !== "loading" ? suggest : null;
    const picked = quickAnswers(have ? labeledSuggestions(have.suggestions, have.provider, (q, v) => options[q].includes(v)) : {});
    setAnswers(picked);
    setStep(STEPS.length - 1);
    moved.current = true;
    const left = ctx.usage.generationsRemaining;
    if (creditsView(ctx.credits).out || left <= 0) {
      const daily = ctx.usage.dailyGenerationLimit - ctx.usage.dailyGenerationsUsed <= 0;
      const reason = creditsView(ctx.credits).out ? "AI_CREDITS_EXHAUSTED" : daily ? "AI_DAILY_LIMIT" : ctx.usage.monthlyGenerationsUsed >= ctx.usage.monthlyGenerationLimit ? "AI_MONTHLY_LIMIT" : "AI_BUDGET_EXHAUSTED";
      setFailure(new ApiError("resource-exhausted", "", {}, reason));
      setPhase("error");
      return;
    }
    void generate(picked, false);
  }, [quick, ctx, settled, suggest, catalog.status, catalog.tags, generate]);

  if (ctxState.error) return <LoadError error={ctxState.error} onRetry={ctxState.reload} />;
  if (!ctx || holdIdeas) return <Loading label={t("page.loading")} layout="ideas" />;
  if (!ctx.enabled) {
    return <Empty art={stateArt("empty")} title={t("off.title")} body={t("off.body")} action={<Button href="/events/new/">{t("off.action")}</Button>} />;
  }

  const usage = ctx.usage;
  const dailyLeft = Math.max(0, usage.dailyGenerationLimit - usage.dailyGenerationsUsed);
  const remaining = usage.generationsRemaining;
  const showResults = phase === "results";
  const showGenerating = phase === "generating" || quick === "armed";
  const busy = showGenerating;
  const set = (patch: Partial<Answers>) => { setAnswers((a) => ({ ...a, ...patch })); setNoteError(""); };
  const current = STEPS[step];
  const lines = summaryLines(answers, tagName);
  const reachable = (index: number) => !busy && STEPS.slice(0, index).every((s) => stepValid(s.id, answers));
  const done = (index: number) => phase === "results" || ((index < step || (usedAll && STEPS[index].id !== "note")) && stepValid(STEPS[index].id, answers));
  // Out of credits disables the paid actions only; every selection and the note stay as they are.
  const noCredits = creditsView(ctx.credits).out;

  const stepper = (
    <>
      <ol className="stepper" aria-label={t("stepper.label")}>
        {STEPS.map((s, i) => {
          const isDone = done(i);
          const isCurrent = phase !== "results" && i === step;
          const ok = reachable(i);
          return (
            <li key={s.id}>
              <button type="button" className="stepper-item" data-state={isCurrent ? "current" : isDone ? "done" : "todo"} aria-current={isCurrent ? "step" : undefined}
                disabled={!ok || isCurrent} aria-label={`${t("stepper.item", { n: i + 1, label: s.full })}${isDone && !isCurrent ? t("stepper.done") : ""}`} title={s.full} onClick={() => goStep(i)}>
                <span className="stepper-n" aria-hidden>{isDone && !isCurrent ? <Check /> : i + 1}</span>
                <span className="stepper-label">{isNoteStep(s.id) && <DipbotMark size={14} />}{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="stepper-compact" aria-hidden={busy ? true : undefined}>
        <p>{showResults ? t("stepper.allDone") : t("stepper.compact", { n: step + 1, total: STEPS.length, label: current.full })}</p>
        <div className="bar-track"><span style={{ width: `${showResults ? 100 : ((step + 1) / STEPS.length) * 100}%` }} /></div>
      </div>
    </>
  );

  // A slim summary of the earlier answers, only from step 2 on (each one edits its step).
  const summary = phase === "edit" && step > 0 && (
    <dl className="choices-bar" aria-label={t("rail.label")}>
      {lines.slice(0, step).map((line) => (
        <div key={line.label}>
          <dt>{STEPS[line.step].label}</dt>
          <dd><button type="button" className="choice-edit" disabled={busy} onClick={() => goStep(line.step)} data-empty={line.empty ? "true" : undefined}>
            <span>{line.value}</span><span className="sr-only">{t("rail.edit")}</span>
          </button></dd>
        </div>
      ))}
    </dl>
  );

  const thin = ctx.interestDataAvailable ? ctx.thinInterestTagIds.map(tagName) : [];
  const interestCards = ctx.interestDataAvailable
    ? ctx.topInterests.map((t) => ({ id: t.tagId, name: tagName(t.tagId), description: catalog.byId.get(t.tagId)?.description, bucket: t.bucket as "5-9" | "10-19" | "20+" | null }))
    : catalog.tags.map((t) => ({ id: t.id, name: t.name, description: t.description, bucket: null as null }));
  const atMax = answers.focusTagIds.length >= MAX_FOCUS;

  // ---------- Suggestions: at most one labeled option per question; nothing is ever selected for the admin.
  const OPTIONS: Record<AiSuggestionQuestion, readonly string[]> = {
    interest: interestCards.map((c) => c.id), goal: GOALS.map((o) => o.value), groupSize: GROUP_SIZES.map((o) => o.value),
    setting: SETTINGS.map((o) => o.value), budget: BUDGETS.map((o) => o.value), timing: TIMINGS.map((o) => o.value),
  };
  const loaded = suggest && suggest !== "loading" ? suggest : null;
  const provider: AiSuggestionProvider = loaded?.provider ?? "none";
  const labeled = loaded ? labeledSuggestions(loaded.suggestions, provider, (q, v) => OPTIONS[q].includes(v)) : {};
  const shown = (question: AiSuggestionQuestion, value: string): Shown | null => {
    const s = labeled[question];
    return s && s.value === value ? { level: s.level, reason: s.reason, provider, flash: flashing } : null;
  };
  // The banner counts this step's suggestions; "Use suggestions" applies every step's at once (already cached: no call, no credits).
  const stepLabeled = suggestionsForStep(labeled, current.id);
  const stepCount = Object.keys(stepLabeled).length;
  const totalCount = Object.keys(labeled).length;
  const applied = totalCount > 0 && suggestionsApplied(answers, labeled);
  const useSuggestions = () => {
    set(applySuggestions(answers, labeled));
    setUsedAll(true);
    setFlashing(true);
    const covered = new Set(Object.keys(labeled).map((q) => QUESTION_STEP[q as AiSuggestionQuestion]));
    const suggestible = STEPS.filter((x) => x.id !== "note");
    const skipped = suggestible.filter((x) => !covered.has(x.id)).map((x) => x.label);
    if (lastToast.current) dismissToast(lastToast.current);
    const id = toast(skipped.length === 0 ? t("suggest.appliedAll")
      : t("suggest.appliedSome", { done: suggestible.length - skipped.length, total: suggestible.length, skipped: skipped.join(", ") }));
    lastToast.current = id;
    setTimeout(() => dismissToast(id), 3500);
  };

  // Not on the note step: nothing there can be suggested.
  const freshness = loaded ? freshnessLine(loaded, new Date()) : null;
  const cannotRefresh = ctx.credits.creditsRemaining < ctx.credits.creditCost.suggest;
  // The only way to spend credits on suggestions is this explicit press (never on a visit).
  const refreshAction = freshness && (
    <DipbotAction variant="ghost" size="sm" label={t("suggest.refresh")} accessibleLabel={t("suggest.refreshAria")} credits={ctx.credits.creditCost.suggest}
      loading={refreshing} disabled={refreshing || cannotRefresh || busy} disabledReason={cannotRefresh ? t("suggest.refreshOut") : undefined} onClick={() => void refreshSuggestions()} />
  );
  const useDisabledReason = suggest === "loading" ? t("suggest.useLoading") : busy ? t("suggest.useBusy") : refreshing ? t("suggest.refreshing") : totalCount === 0 ? t("suggest.useNone") : undefined;
  const useAction = (
    <DipbotAction variant="outline" size="sm" label={t("suggest.use")} hint={t("suggest.useTitle")} disabled={useDisabledReason !== undefined} disabledReason={useDisabledReason} onClick={useSuggestions} />
  );
  // One header row, the same component as "Ideas for you": [mark] title, muted "Updated 3 hours ago", then Refresh and Use suggestions.
  const sgHeader = (title: string, withUpdated: boolean, showUse: boolean) => (
    <SectionHeader headingLevel={3} stackActions title={title} updated={withUpdated && freshness ? freshness.text : undefined} staleHint={withUpdated && freshness?.hint ? freshness.hint : undefined} end={<>{refreshAction}{showUse && useAction}</>} />
  );
  const suggestBar = phase === "edit" && current.id !== "note" && suggest !== null && (
    suggest === "loading" || refreshing
      ? (suggest === "loading" && !slow ? null : (
        <div className="sg-bar" data-state="loading" role="status">{sgHeader(t(refreshing ? "suggest.refreshing" : "suggest.loading"), false, true)}</div>
      ))
      : totalCount === 0
        ? (
          <div className="sg-bar" data-state="none">
            {sgHeader(t(current.id === "interests" ? "suggest.noInterestData" : provider === "none" ? "suggest.noData" : "suggest.noStepSuggestion"), true, true)}
          </div>
        )
        : (
          <div className="sg-bar" role="region" aria-label={t("suggest.feature")} data-state={applied ? "applied" : "ready"}>
            {sgHeader(applied ? (stepCount > 0 ? tn("suggest.matched", stepCount) : t("suggest.matchedAll")) : stepCount > 0 ? tn("suggest.count", stepCount) : t("suggest.noStepSuggestion"), true, !applied)}
          </div>
        )
  );

  /** One line per suggested choice under a step heading: what and why (the phone's version of the tooltip). */
  const suggestCaption = (questions: AiSuggestionQuestion[]) => {
    const items = questions.map((q) => labeled[q]).filter((s): s is LabeledSuggestion => Boolean(s));
    if (items.length === 0) return null;
    const name = (s: LabeledSuggestion) => s.question === "interest" ? tagName(s.value)
      : [...GOALS, ...GROUP_SIZES, ...SETTINGS, ...BUDGETS, ...TIMINGS].find((o) => o.value === s.value)?.label ?? s.value;
    return (
      <ul className="sg-caption" aria-label={t("suggest.feature")}>
        {items.map((s) => (
          <li key={s.question}>
            <Sparkle />
            <span><strong>{name(s)}</strong>{" "}<span className="muted">{s.reason}.</span></span>
          </li>
        ))}
      </ul>
    );
  };

  const body = () => {
    switch (current.id) {
      case "interests":
        return (
          <fieldset className="opt-fieldset">
            <legend className="sr-only">{t("interests.legend", { n: MAX_FOCUS })}</legend>
            <div className="step-head">
              <h2 ref={heading} tabIndex={-1}>{current.heading}</h2>
              <span className="muted" aria-live="polite">{t(atMax ? "interests.atMax" : "interests.pick", { n: MAX_FOCUS })}</span>
            </div>
            {ctx.currentTheme && (
              <p className="muted theme-line">{t("interests.theme")} <strong>{ctx.currentTheme.title}</strong>. {t("interests.themeFit")}</p>
            )}
            {suggestCaption(["interest"])}
            <div className="opt-grid cols-4">
              {interestCards.map((c) => {
                const checked = answers.focusTagIds.includes(c.id);
                return (
                  <Option key={c.id} type="checkbox" name="interest" label={c.name} hint={tagBlurb(c)} checked={checked}
                    disabled={!checked && atMax} onChange={() => set(toggleInterest(answers, c.id))} art={tagArt(c)} suggestion={shown("interest", c.id)}>
                    {c.bucket && <span className="level" data-level={bucketLevel(c.bucket)} title={bucketText(c.bucket)}><i aria-hidden /><i aria-hidden /><i aria-hidden /><span className="sr-only">{bucketText(c.bucket)}</span></span>}
                  </Option>
                );
              })}
            </div>
            <p className="muted thin-line">{t(ctx.interestDataAvailable ? "interests.noneHint" : "interests.noData")}</p>
            {thin.length > 0 && <p className="muted thin-line">{t("interests.thin", { names: thin.join(", ") })}</p>}
          </fieldset>
        );
      case "goal":
        return (
          <fieldset className="opt-fieldset">
            <legend className="sr-only">{current.heading}</legend>
            <div className="step-head"><h2 ref={heading} tabIndex={-1}>{current.heading}</h2></div>
            {suggestCaption(["goal"])}
            <div className="opt-grid cols-3">
              {GOALS.map((o) => <Option key={o.value} type="radio" name="goal" label={o.label} hint={o.hint} checked={answers.goal === o.value} onChange={() => set({ goal: o.value })} art={spotArt("goal", o.value)} suggestion={shown("goal", o.value)} />)}
            </div>
          </fieldset>
        );
      case "group":
        return (
          <div>
            <div className="step-head"><h2 ref={heading} tabIndex={-1}>{current.heading}</h2></div>
            {suggestCaption(["groupSize", "setting"])}
            <div className="two-col">
              <fieldset className="opt-fieldset">
                <legend>{t("legend.groupSize")}</legend>
                <div className="opt-grid cols-1">{GROUP_SIZES.map((o) => <Option key={o.value} type="radio" name="size" label={o.label} hint={o.hint} checked={answers.groupSize === o.value} onChange={() => set({ groupSize: o.value })} art={spotArt("size", o.value)} suggestion={shown("groupSize", o.value)} />)}</div>
              </fieldset>
              <fieldset className="opt-fieldset">
                <legend>{t("legend.setting")}</legend>
                <div className="opt-grid cols-1">{SETTINGS.map((o) => <Option key={o.value} type="radio" name="setting" label={o.label} hint={o.hint} checked={answers.setting === o.value} onChange={() => set({ setting: o.value })} art={spotArt("setting", o.value)} suggestion={shown("setting", o.value)} />)}</div>
              </fieldset>
            </div>
          </div>
        );
      case "budget":
        return (
          <div>
            <div className="step-head"><h2 ref={heading} tabIndex={-1}>{current.heading}</h2></div>
            {suggestCaption(["budget", "timing"])}
            <div className="two-col">
              <fieldset className="opt-fieldset">
                <legend>{t("legend.budget")}</legend>
                <div className="opt-grid cols-1">{BUDGETS.map((o) => <Option key={o.value} type="radio" name="budget" label={o.label} hint={o.hint} checked={answers.budget === o.value} onChange={() => set({ budget: o.value })} art={spotArt("budget", o.value)} suggestion={shown("budget", o.value)} />)}</div>
              </fieldset>
              <fieldset className="opt-fieldset">
                <legend>{t("legend.timing")}</legend>
                <div className="opt-grid cols-1">{TIMINGS.map((o) => <Option key={o.value} type="radio" name="timing" label={o.label} hint={o.hint} checked={answers.timing === o.value} onChange={() => set({ timing: o.value })} art={spotArt("timing", o.value)} suggestion={shown("timing", o.value)} />)}</div>
              </fieldset>
            </div>
          </div>
        );
      case "note":
        return (
          <div className="note-step">
            <div className="step-head"><h2 ref={heading} tabIndex={-1}><DipbotMark size={20} className="h-mark" />{current.heading}</h2></div>
            <Considerations ranking={loaded?.considerations ?? []} provider={provider} answers={answers} onToggle={(id) => setAnswers((a) => toggleConsideration(a, id))} />
            <div className="field">
              <label htmlFor={noteId}>{t("note.label")}</label>
              <textarea id={noteId} ref={noteField} value={answers.prompt} maxLength={MAX_PROMPT} aria-invalid={noteError ? true : undefined}
                aria-describedby={`${noteId}-count${noteError ? ` ${noteId}-error` : ""}`}
                placeholder={t("note.placeholder")}
                onChange={(e) => set({ prompt: e.target.value })} />
              <div className="note-meta">
                <span id={`${noteId}-error`} className="error" role={noteError ? "alert" : undefined}>{noteError}</span>
                <span id={`${noteId}-count`} className="muted count">{answers.prompt.length} / {MAX_PROMPT}</span>
              </div>
            </div>
            <fieldset className="drafts-count">
              <legend>{t("note.count")}</legend>
              <div className="seg-radio">
                {([1, 2, 3] as const).map((n) => (
                  <label key={n}><input type="radio" name="count" checked={answers.count === n} onChange={() => set({ count: n })} /><span>{n}</span></label>
                ))}
              </div>
            </fieldset>
          </div>
        );
    }
  };

  const isGenerating = phase === "generating";
  const hasError = phase === "error";
  const lastStep = step === STEPS.length - 1;
  const exhausted = remaining <= 0;
  const quotaReason = failureMessage(new ApiError("resource-exhausted", "", {}, dailyLeft === 0 ? "AI_DAILY_LIMIT" : usage.monthlyGenerationsUsed >= usage.monthlyGenerationLimit ? "AI_MONTHLY_LIMIT" : "AI_BUDGET_EXHAUSTED"), ctx);
  const edit = (
    <section className="step-panel" aria-label={current.label} ref={panelRef}>
      {body()}
      <div className="step-actions">
        {lastStep && exhausted && !noCredits && (
          <p className="muted quota-note" role="alert">
            {failureMessage(new ApiError("resource-exhausted", "", {}, dailyLeft === 0 ? "AI_DAILY_LIMIT" : usage.monthlyGenerationsUsed >= usage.monthlyGenerationLimit ? "AI_MONTHLY_LIMIT" : "AI_BUDGET_EXHAUSTED"), ctx)}
          </p>
        )}
        {step > 0 && <Button onClick={() => goStep(step - 1)}>{t("action.back")}</Button>}
        {lastStep
          ? <DipbotAction variant="solid" label={t("action.generate")} credits={ctx.credits.creditCost.generate} disabled={!readyToGenerate(answers) || exhausted || noCredits} disabledReason={noCredits ? t("credits.not") : undefined} onClick={() => void generate(answers, false)} />
          : <Button variant="primary" disabled={!stepValid(current.id, answers)} onClick={() => goStep(step + 1)}>{t("action.next")}</Button>}
      </div>
    </section>
  );

  const generating = (
    <section className="step-panel" aria-label={t("generating.label")} aria-busy="true">
      <div className="status-row">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="state-art" src={stateArt("thinking")} alt="" width={64} height={48} draggable={false} />
        <p className="status-line" role="status" aria-live="polite">{tn(quick === "none" ? "generating.status" : "quick.waiting", answers.count)}</p>
      </div>
      <div className="draft-skeletons" aria-hidden>
        {Array.from({ length: answers.count }, (_, i) => (
          <div className="draft-skeleton" key={i}><span className="sk-thumb" /><span className="sk-lines"><i /><i /><i /></span></div>
        ))}
      </div>
    </section>
  );

  const errorPanel = (
    <section className="step-panel" aria-label={t("error.label")}>
      <InlineNotice tone="error">{failureMessage(failure, ctx)}</InlineNotice>
      <div className="step-actions">
        <Button onClick={() => goStep(quick === "none" ? STEPS.length - 1 : 0)}>{t(quick === "none" ? "error.backToChoices" : "quick.manual")}</Button>
        {readyToGenerate(answers) && remaining > 0 && !noCredits && <Button variant="primary" onClick={() => void generate(answers, false)}>{t("error.retry")}</Button>}
      </div>
    </section>
  );

  const results = result && (
    <section className="results" aria-label={t("results.label")}>
      <div className="results-bar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="state-art" src={stateArt("results")} alt="" width={48} height={36} draggable={false} />
        <p><strong>{t("results.ready", { n: result.drafts.length })}</strong> {t("results.review")}</p>
        <div className="results-actions">
          <DipbotAction label={t("results.regenerate")} credits={ctx.credits.creditCost.regenerate} disabled={remaining <= 0 || noCredits} disabledReason={noCredits ? t("credits.not") : remaining <= 0 ? quotaReason : undefined} onClick={() => void generate(answers, true)} />
          <Button onClick={() => { attempt.current = null; setAnswers(emptyAnswers()); setResult(null); goStep(0); }}>{t("results.startOver")}</Button>
        </div>
      </div>
      <ul className="draft-list">
        {result.drafts.map((draft, i) => (
          <DraftCard key={`${i}-${draft.title}`} draft={draft} credits={ctx.credits} siblingCovers={result.drafts.filter((_, j) => j !== i).map((d) => d.coverImageURL)} onOpen={(coverImageURL) => {
            try { saveAiDraft(window.sessionStorage, { ...draft, coverImageURL }, Date.now(), coverImageURL === draft.coverImageURL ? "dipbot" : "admin"); } catch { /* the editor then opens empty */ }
            router.push("/events/new/?from=ai");
          }} />
        ))}
      </ul>
    </section>
  );

  return (
    <div className="ideas">
      <div className="ideas-head"><PrivacyInfo /><CreditsMeter credits={ctx.credits} visitCharged={loaded ? loaded.creditsCharged : undefined} daily={usage.dailyGenerationLimit >= UNLIMITED_DAILY ? undefined : { left: dailyLeft, limit: usage.dailyGenerationLimit }} /></div>
      <IdeasForYou onCredits={applyCredits} onCustomize={customize} />
      <div className="ideas-layout">
        <div className="ideas-main">
          {stepper}
          {!isGenerating && <CreditsNotice credits={ctx.credits} />}
          {summary}
          {suggestBar}
          {showGenerating ? generating : hasError ? errorPanel : showResults && results ? results : edit}
        </div>
      </div>
    </div>
  );
}

export function DraftCard({ draft, onOpen, siblingCovers = [], credits }: { draft: GeneratedEventDraft; onOpen: (coverImageURL: string) => void; siblingCovers?: string[]; credits?: AiCredits }) {
  const { nameFor: tagName } = useTags();
  const [coverURL, setCoverURL] = useState(draft.coverImageURL);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const cover = coverByURL(coverURL) ?? lexicalPick(draft);
  const long = draft.description.length > 190;
  async function copy() {
    try {
      await navigator.clipboard.writeText(draftText(draft, tagName));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked: nothing to do */ }
  }
  return (
    <li className="draft-card">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="draft-thumb" src={coverImage(cover)} alt="" width={120} height={80} draggable={false} />
      <div className="draft-main">
        <h3>{draft.title}</h3>
        <p className="rationale">{draft.rationale}</p>
        <div className="draft-meta-wrap"><ul className="draft-meta" aria-label={t("draft.details")}>
          <li>{daypartLabel(draft.suggestedDaypart)}</li>
          <li>{durationLabel(draft.durationMinutes)}</li>
          <li>{capacityLabel(draft.capacity)}</li>
          <li>{costLabel(draft.costCents)}</li>
          <li>{t(draft.isOutdoor ? "draft.outdoors" : "draft.indoors")}</li>
        </ul></div>
        <p className="venue-line">{venueLabel(draft)}</p>
        {draft.tagIds.length > 0 && <ul className="draft-tags" aria-label={t("draft.tags")}>{draft.tagIds.map((id) => <li key={id}>{tagName(id)}</li>)}</ul>}
        <p className={`draft-desc${open ? " open" : ""}`}>{draft.description}</p>
        {long && <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{t(open ? "draft.showLess" : "draft.showMore")}</button>}
        <Disclosure className="draft-cover" summary={tText("dipbot.draft.changeCover")}>
          <CoverPicker compact label={tText("dipbot.draft.coverFor", { title: draft.title })} value={coverURL} onChange={setCoverURL} excludeURLs={siblingCovers} credits={credits}
            event={{ title: draft.title, description: draft.description, tagIds: draft.tagIds }} />
        </Disclosure>
        <div className="draft-actions">
          <Button onClick={() => void copy()}>{t(copied ? "draft.copied" : "draft.copy")}</Button>
          <Button variant="primary" onClick={() => onOpen(coverURL)}>{t("draft.open")}</Button>
        </div>
      </div>
    </li>
  );
}
