"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { EventIdeaContext, GenerateDraftsResult, GeneratedEventDraft } from "@/lib/adminTypes";
import { COVERS, TAGS, tagName } from "@/lib/catalog";
import { ApiError } from "@/lib/contract";
import {
  type Answers, type Attempt, BUDGETS, GOALS, GROUP_SIZES, MAX_FOCUS, MAX_PROMPT, NOTE_SUGGESTIONS, RETRYABLE_REASONS, SETTINGS, STEPS, TIMINGS,
  bucketLevel, bucketText, capacityLabel, chooseSurprise, choicesOf, costLabel, daypartLabel, draftText, durationLabel, emptyAnswers,
  presetAnswers, presetFor, readyToGenerate, requestIdFor, saveAiDraft, signatureOf, stepValid, summaryLines, toggleInterest, venueLabel,
} from "@/lib/ideas";
import { useApp } from "./AppProvider";
import { Empty, LoadError, Loading } from "./Ui";
import { useLoad } from "./useLoad";

type Phase = "edit" | "generating" | "results" | "error";

const LIMIT_MESSAGES: Record<string, (ctx: EventIdeaContext | null) => string> = {
  AI_DAILY_LIMIT: (c) => `You have used ${c ? `all ${c.usage.dailyGenerationLimit}` : "all"} of today’s drafts. The limit resets tomorrow.`,
  AI_MONTHLY_LIMIT: (c) => `Your company has used ${c ? `all ${c.usage.monthlyGenerationLimit}` : "all"} of this month’s generations. The limit resets on the first of next month.`,
  AI_BUDGET_EXHAUSTED: () => "This month’s AI budget is used up. It resets on the first of next month.",
  AI_FLAG_LIMIT: () => "Several notes were turned down today, so generating is paused. Try again tomorrow.",
  AI_OUTPUT_INVALID: () => "The AI returned drafts we couldn’t use. Nothing was counted against your limit. Try again.",
  AI_UNAVAILABLE: () => "The AI service is busy right now. Nothing was counted against your limit. Try again in a moment.",
  REQUEST_IN_PROGRESS: () => "This request is still running. Wait a moment, then try again.",
  REQUEST_REUSED: () => "That request was already used for different choices. Generate again to start a new one.",
  INSUFFICIENT_ROLE: () => "Only admins can use AI event ideas.",
};

function failureMessage(error: unknown, ctx: EventIdeaContext | null): string {
  if (error instanceof ApiError) {
    const known = error.reason ? LIMIT_MESSAGES[error.reason] : undefined;
    return known ? known(ctx) : error.message;
  }
  return "We couldn’t reach the server. Check your connection and try again.";
}

const Check = () => (
  <svg className="opt-check" viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
);

interface OptionProps { type: "radio" | "checkbox"; name: string; label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: () => void; children?: React.ReactNode }
function Option({ type, name, label, hint, checked, disabled, onChange, children }: OptionProps) {
  return (
    <label className="opt" data-disabled={disabled ? "true" : undefined}>
      <input className="opt-input" type={type} name={name} checked={checked} disabled={disabled} onChange={onChange} />
      <span className="opt-body">
        <span className="opt-name">{label}</span>
        {hint && <span className="opt-meta">{hint}</span>}
        {children}
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

  const goStep = useCallback((index: number) => {
    moved.current = true;
    setStep(index);
    setPhase("edit");
  }, []);

  // Focus follows the step: keyboard and screen reader users land on the new heading.
  useEffect(() => {
    if (moved.current && phase === "edit") heading.current?.focus();
  }, [step, phase]);

  const generate = useCallback(async (source: Answers, regenerate: boolean) => {
    const choices = choicesOf(source);
    if (!choices) return;
    const prompt = source.prompt.trim();
    const signature = signatureOf(choices, prompt, source.count);
    const requestId = requestIdFor(attempt.current, signature, regenerate, () => crypto.randomUUID());
    attempt.current = { requestId, signature, retryable: false };
    const mine = ++run.current;
    moved.current = true;
    setPhase("generating");
    setFailure(null);
    setNoteError("");
    try {
      const response = await api.generateEventDrafts({ requestId, choices, prompt, count: source.count });
      if (mine !== run.current) return;
      setResult(response);
      ctxState.setData({ ...(ctx as EventIdeaContext), usage: response.usage });
      setPhase("results");
    } catch (error) {
      if (mine !== run.current) return;
      const reason = error instanceof ApiError ? error.reason : undefined;
      attempt.current = { requestId, signature, retryable: !(error instanceof ApiError) || (reason !== undefined && RETRYABLE_REASONS.includes(reason)) };
      if (reason === "AI_PROMPT_REJECTED") {
        setNoteError(error instanceof ApiError ? (error.fields.prompt ?? error.message) : "");
        setStep(STEPS.length - 1);
        setPhase("edit");
        requestAnimationFrame(() => noteField.current?.focus());
        return;
      }
      if (reason === "AI_DISABLED" && ctx) ctxState.setData({ ...ctx, enabled: false });
      // Limits changed on the server: refresh the meter without losing the screen.
      if (reason && /LIMIT|BUDGET/.test(reason)) ctxState.reload();
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

  if (ctxState.error) return <LoadError error={ctxState.error} onRetry={ctxState.reload} />;
  if (!ctx) return <Loading label="Loading event ideas" />;
  if (!ctx.enabled) {
    return <Empty title="AI event ideas are off for your company" body="An owner can turn them on. Until then, create events the usual way." action={<a className="pill-btn gray" href="/events/new/">New event</a>} />;
  }

  const usage = ctx.usage;
  const dailyLeft = Math.max(0, usage.dailyGenerationLimit - usage.dailyGenerationsUsed);
  const remaining = usage.generationsRemaining;
  const busy = phase === "generating";
  const set = (patch: Partial<Answers>) => { setAnswers((a) => ({ ...a, ...patch })); setNoteError(""); };
  const current = STEPS[step];
  const lines = summaryLines(answers, tagName);
  const reachable = (index: number) => !busy && STEPS.slice(0, index).every((s) => stepValid(s.id, answers));
  const done = (index: number) => phase === "results" || (index < step && stepValid(STEPS[index].id, answers));
  const monthlyPct = usage.monthlyGenerationLimit ? Math.min(100, Math.round((usage.monthlyGenerationsUsed / usage.monthlyGenerationLimit) * 100)) : 0;

  const stepper = (
    <>
      <ol className="stepper" aria-label="Steps">
        {STEPS.map((s, i) => {
          const isDone = done(i);
          const isCurrent = phase !== "results" && i === step;
          const ok = reachable(i);
          return (
            <li key={s.id}>
              <button type="button" className="stepper-item" data-state={isCurrent ? "current" : isDone ? "done" : "todo"} aria-current={isCurrent ? "step" : undefined}
                disabled={!ok || isCurrent} onClick={() => goStep(i)}>
                <span className="stepper-n" aria-hidden>{isDone && !isCurrent ? <Check /> : i + 1}</span>
                <span className="stepper-label">{s.label}</span>
                {isDone && !isCurrent && <span className="sr-only">, done</span>}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="stepper-compact" aria-hidden={busy ? true : undefined}>
        <p>{phase === "results" ? "All steps done" : `Step ${step + 1} of ${STEPS.length}: ${current.label}`}</p>
        <div className="bar-track"><span style={{ width: `${phase === "results" ? 100 : ((step + 1) / STEPS.length) * 100}%` }} /></div>
      </div>
    </>
  );

  const rail = (
    <aside className="ideas-rail" aria-label="Summary">
      <section className="rail-card">
        <h2>Your choices</h2>
        <dl className="choices">
          {lines.map((line) => (
            <div key={line.label}>
              <dt>{line.label}</dt>
              <dd><button type="button" className="choice-edit" disabled={busy} onClick={() => goStep(line.step)} data-empty={line.value === "Not set" || line.value === "None" ? "true" : undefined}>
                <span>{line.value}</span><span className="sr-only">. Edit</span>
              </button></dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="rail-card">
        <h2>Usage</h2>
        <p className="usage-line"><strong>{dailyLeft} of {usage.dailyGenerationLimit}</strong> left today</p>
        <p className="usage-sub">Monthly: {usage.monthlyGenerationsUsed} of {usage.monthlyGenerationLimit} used</p>
        <div className="bar-track" role="img" aria-label={`${usage.monthlyGenerationsUsed} of ${usage.monthlyGenerationLimit} monthly generations used`}><span style={{ width: `${monthlyPct}%` }} /></div>
      </section>
      <p className="privacy">The AI sees rounded interest counts and your choices. It never sees names or personal data.</p>
    </aside>
  );

  const thin = ctx.interestDataAvailable ? ctx.thinInterestTagIds.map(tagName) : [];
  const interestCards = ctx.interestDataAvailable
    ? ctx.topInterests.map((t) => ({ id: t.tagId, name: tagName(t.tagId), bucket: t.bucket as "5-9" | "10-19" | "20+" | null }))
    : TAGS.map((t) => ({ id: t.id, name: t.name, bucket: null as null }));
  const atMax = answers.focusTagIds.length >= MAX_FOCUS;

  const body = () => {
    switch (current.id) {
      case "interests":
        return (
          <fieldset className="opt-fieldset">
            <legend className="sr-only">Interests, pick up to {MAX_FOCUS}</legend>
            <div className="step-head">
              <h2 ref={heading} tabIndex={-1}>{current.heading}</h2>
              <span className="muted" aria-live="polite">{atMax ? "Up to 3" : `Pick up to ${MAX_FOCUS}`}</span>
            </div>
            {ctx.currentTheme && (
              <p className="callout">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M2.5 8.2V2.5h5.7l5.3 5.3-5.7 5.7z" /><circle cx="5.5" cy="5.5" r=".8" fill="currentColor" /></svg>
                <span>This week’s theme: <strong>{ctx.currentTheme.title}</strong>. Drafts can fit it.</span>
              </p>
            )}
            {!ctx.interestDataAvailable && <p className="info-note" role="note">Interest counts are not available yet, so pick any interests or let the AI surprise you.</p>}
            <div className="opt-grid cols-4">
              {interestCards.map((c) => {
                const checked = answers.focusTagIds.includes(c.id);
                return (
                  <Option key={c.id} type="checkbox" name="interest" label={c.name} hint={c.bucket ? bucketText(c.bucket) : undefined} checked={checked}
                    disabled={!checked && atMax} onChange={() => set(toggleInterest(answers, c.id))}>
                    {c.bucket && <span className="level" data-level={bucketLevel(c.bucket)} aria-hidden><i /><i /><i /></span>}
                  </Option>
                );
              })}
              <Option type="checkbox" name="interest" label="Surprise me" hint="Let the AI choose" checked={answers.surprise} onChange={() => set(answers.surprise ? { surprise: false } : chooseSurprise(answers))} />
            </div>
            {thin.length > 0 && <p className="muted thin-line">Fewer than 5 members: {thin.join(", ")}</p>}
          </fieldset>
        );
      case "goal":
        return (
          <fieldset className="opt-fieldset">
            <legend className="sr-only">{current.heading}</legend>
            <div className="step-head"><h2 ref={heading} tabIndex={-1}>{current.heading}</h2></div>
            <div className="opt-grid cols-3">
              {GOALS.map((o) => <Option key={o.value} type="radio" name="goal" label={o.label} hint={o.hint} checked={answers.goal === o.value} onChange={() => set({ goal: o.value })} />)}
            </div>
          </fieldset>
        );
      case "group":
        return (
          <div>
            <div className="step-head"><h2 ref={heading} tabIndex={-1}>{current.heading}</h2></div>
            <div className="two-col">
              <fieldset className="opt-fieldset">
                <legend>Group size</legend>
                <div className="opt-grid cols-1">{GROUP_SIZES.map((o) => <Option key={o.value} type="radio" name="size" label={o.label} hint={o.hint} checked={answers.groupSize === o.value} onChange={() => set({ groupSize: o.value })} />)}</div>
              </fieldset>
              <fieldset className="opt-fieldset">
                <legend>Setting</legend>
                <div className="opt-grid cols-1">{SETTINGS.map((o) => <Option key={o.value} type="radio" name="setting" label={o.label} hint={o.hint} checked={answers.setting === o.value} onChange={() => set({ setting: o.value })} />)}</div>
              </fieldset>
            </div>
          </div>
        );
      case "budget":
        return (
          <div>
            <div className="step-head"><h2 ref={heading} tabIndex={-1}>{current.heading}</h2></div>
            <div className="two-col">
              <fieldset className="opt-fieldset">
                <legend>Budget per person</legend>
                <div className="opt-grid cols-1">{BUDGETS.map((o) => <Option key={o.value} type="radio" name="budget" label={o.label} hint={o.hint} checked={answers.budget === o.value} onChange={() => set({ budget: o.value })} />)}</div>
              </fieldset>
              <fieldset className="opt-fieldset">
                <legend>Timing</legend>
                <div className="opt-grid cols-1">{TIMINGS.map((o) => <Option key={o.value} type="radio" name="timing" label={o.label} hint={o.hint} checked={answers.timing === o.value} onChange={() => set({ timing: o.value })} />)}</div>
              </fieldset>
            </div>
          </div>
        );
      case "note":
        return (
          <div className="note-step">
            <div className="step-head"><h2 ref={heading} tabIndex={-1}>{current.heading}</h2></div>
            <div className="field">
              <label htmlFor={noteId}>Note for the AI (optional)</label>
              <textarea id={noteId} ref={noteField} value={answers.prompt} maxLength={MAX_PROMPT} aria-invalid={noteError ? true : undefined}
                aria-describedby={`${noteId}-count${noteError ? ` ${noteId}-error` : ""}`}
                placeholder="For example: something new, vegetarian food, easy for people who use a wheelchair"
                onChange={(e) => set({ prompt: e.target.value })} />
              <div className="note-meta">
                <span id={`${noteId}-error`} className="error" role={noteError ? "alert" : undefined}>{noteError}</span>
                <span id={`${noteId}-count`} className="muted count">{answers.prompt.length} / {MAX_PROMPT}</span>
              </div>
            </div>
            <div className="suggest" role="group" aria-label="Suggestions">
              {NOTE_SUGGESTIONS.map((text) => (
                <button key={text} type="button" className="suggest-chip" onClick={() => {
                  const base = answers.prompt.trim();
                  const next = base ? `${base}${/[.!?]$/.test(base) ? "" : "."} ${text}` : text;
                  if (next.length <= MAX_PROMPT) set({ prompt: next });
                }}>+ {text}</button>
              ))}
            </div>
            <fieldset className="drafts-count">
              <legend>Drafts</legend>
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

  const lastStep = step === STEPS.length - 1;
  const exhausted = remaining <= 0;
  const edit = (
    <section className="step-panel" aria-label={current.label}>
      {body()}
      <div className="step-actions">
        {lastStep && (
          <p className="muted quota-note" role={exhausted ? "alert" : undefined}>
            {exhausted ? failureMessage(new ApiError("resource-exhausted", "", {}, usage.budgetExhausted ? "AI_BUDGET_EXHAUSTED" : dailyLeft === 0 ? "AI_DAILY_LIMIT" : "AI_MONTHLY_LIMIT"), ctx) : `Uses 1 of your ${remaining} remaining today.`}
          </p>
        )}
        {step > 0 && <button type="button" className="pill-btn gray" onClick={() => goStep(step - 1)}>Back</button>}
        {lastStep
          ? <button type="button" className="pill-btn purple" disabled={!readyToGenerate(answers) || exhausted} onClick={() => void generate(answers, false)}>Generate drafts</button>
          : <button type="button" className="pill-btn purple" disabled={!stepValid(current.id, answers)} onClick={() => goStep(step + 1)}>Next</button>}
      </div>
    </section>
  );

  const generating = (
    <section className="step-panel" aria-label="Generating drafts" aria-busy="true">
      <p className="status-line" role="status" aria-live="polite">Writing {answers.count} {answers.count === 1 ? "draft" : "drafts"}. This can take up to a minute.</p>
      <div className="draft-skeletons" aria-hidden>
        {Array.from({ length: answers.count }, (_, i) => (
          <div className="draft-skeleton" key={i}><span className="sk-thumb" /><span className="sk-lines"><i /><i /><i /></span></div>
        ))}
      </div>
    </section>
  );

  const errorPanel = (
    <section className="step-panel" aria-label="Drafts could not be written">
      <div className="banner error" role="alert"><span>{failureMessage(failure, ctx)}</span></div>
      <div className="step-actions">
        <button type="button" className="pill-btn gray" onClick={() => goStep(STEPS.length - 1)}>Back to choices</button>
        {readyToGenerate(answers) && remaining > 0 && <button type="button" className="pill-btn purple" onClick={() => void generate(answers, false)}>Try again</button>}
      </div>
    </section>
  );

  const results = result && (
    <section className="results" aria-label="Draft results">
      <div className="results-bar">
        <p><strong>AI suggestions.</strong> Review every detail before publishing.</p>
        <div className="results-actions">
          <button type="button" className="pill-btn gray" disabled={remaining <= 0} onClick={() => void generate(answers, true)}>
            Regenerate{remaining > 0 ? ` (${remaining} left)` : ""}
          </button>
          <button type="button" className="pill-btn gray" onClick={() => { attempt.current = null; setAnswers(emptyAnswers()); setResult(null); goStep(0); }}>Start over</button>
        </div>
      </div>
      <ul className="draft-list">
        {result.drafts.map((draft, i) => (
          <DraftCard key={`${i}-${draft.title}`} draft={draft} onOpen={() => {
            try { saveAiDraft(window.sessionStorage, draft); } catch { /* the editor then opens empty */ }
            router.push("/events/new/?from=ai");
          }} />
        ))}
      </ul>
    </section>
  );

  return (
    <div className="ideas">
      <div className="ideas-layout">
        <div className="ideas-main">
          {stepper}
          {phase === "generating" ? generating : phase === "error" ? errorPanel : phase === "results" && results ? results : edit}
        </div>
        {rail}
      </div>
    </div>
  );
}

function DraftCard({ draft, onOpen }: { draft: GeneratedEventDraft; onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const cover = COVERS.find((c) => c.url === draft.coverImageURL) ?? COVERS[0];
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
      <img className="draft-thumb" src={cover.image} alt="" width={120} height={80} />
      <div className="draft-main">
        <h3>{draft.title}</h3>
        <p className="rationale">{draft.rationale}</p>
        <div className="draft-meta-wrap"><ul className="draft-meta" aria-label="Details">
          <li>{daypartLabel(draft.suggestedDaypart)}</li>
          <li>{durationLabel(draft.durationMinutes)}</li>
          <li>{capacityLabel(draft.capacity)}</li>
          <li>{costLabel(draft.costCents)}</li>
          <li>{draft.isOutdoor ? "Outdoors" : "Indoors"}</li>
        </ul></div>
        <p className="venue-line">{venueLabel(draft)}</p>
        {draft.tagIds.length > 0 && <ul className="draft-tags" aria-label="Tags">{draft.tagIds.map((id) => <li key={id}>{tagName(id)}</li>)}</ul>}
        <p className={`draft-desc${open ? " open" : ""}`}>{draft.description}</p>
        {long && <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Show less" : "Show more"}</button>}
        <div className="draft-actions">
          <button type="button" className="pill-btn gray" onClick={() => void copy()}>{copied ? "Copied" : "Copy text"}</button>
          <button type="button" className="pill-btn purple" onClick={onOpen}>Open in editor</button>
        </div>
      </div>
    </li>
  );
}
