"use client";
// @i18n-migrated

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AdminApi } from "@/lib/api";
import { ApiError } from "@/lib/contract";
import type { AiCredits, DipbotIdea, DipbotIdeas } from "@/lib/adminTypes";
import { t } from "@/lib/aiStrings";
import { coverByURL, coverThumb, lexicalPick } from "@/lib/covers";
import {
  answersFromIdea, customizeAria, dayTimeLabel, ideasCost, openAria, readCollapsed, refreshState, updatedLine, writeCollapsed,
} from "@/lib/dipbotIdeas";
import { type Answers, BUDGETS, durationLabel, saveAiDraft } from "@/lib/ideas";
import { labelOf } from "@/lib/suggestionLabels";
import { useApp } from "./AppProvider";
import { DipbotAction } from "./DipbotAction";
import { DipbotMark } from "./DipbotMark";
import { Button, Chip, InlineNotice, SectionHeader } from "./kit";
import { dismissToast, toast } from "./Toast";

interface Props {
  /** The balance after a run, so the page's credit meter stays right. */
  onCredits: (credits: AiCredits) => void;
  /** "Customize with Dipbot": prefill the wizard with the idea and jump to its last step. */
  onCustomize: (answers: Answers) => void;
}

const SKELETONS = 3;
const quietToast = (message: string) => {
  const id = toast(message);
  setTimeout(() => dismissToast(id), 2500);
};

function IdeaCard({ idea, onUse, onCustomize }: { idea: DipbotIdea; onUse: (idea: DipbotIdea) => void; onCustomize: (idea: DipbotIdea) => void }) {
  const cover = coverByURL(idea.coverImageURL) ?? lexicalPick(idea.draft);
  const cost = BUDGETS.find((b) => b.value === idea.costBucket)?.label;
  return (
    <li className="ifu-card">
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, unoptimized images */}
      <img className="ifu-thumb" src={coverThumb(cover)} alt="" width={96} height={140} loading="lazy" draggable={false} />
      <div className="ifu-body">
        <h3 className="ifu-title" title={idea.title}>{idea.title}</h3>
        <p className="ifu-why" title={idea.why}>{idea.why}</p>
        <ul className="ifu-chips" aria-label={t("ideasForYou.details")}>
          <li><Chip>{dayTimeLabel(idea)}</Chip></li>
          <li><Chip>{durationLabel(idea.durationMinutes)}</Chip></li>
          {cost && <li><Chip>{cost}</Chip></li>}
          {idea.fitLabel && (
            <li>
              <span className="sg-tag" data-level={idea.fitLabel}>
                <DipbotMark size={14} strong={idea.fitLabel === "perfect"} />
                <span aria-hidden>{labelOf(idea.fitLabel)}</span>
                <span className="sr-only">{t("ideasForYou.fitSpoken", { label: labelOf(idea.fitLabel).toLowerCase() })}</span>
              </span>
            </li>
          )}
        </ul>
        <div className="ifu-actions">
          <Button variant="primary" size="sm" aria-label={openAria(idea.title)} onClick={() => onUse(idea)}>{t("ideasForYou.use")}</Button>
          <DipbotAction variant="link" size="sm" icon={null} className="ifu-customize" label={t("ideasForYou.customize")} accessibleLabel={customizeAria(idea.title)} onClick={() => onCustomize(idea)} />
        </div>
      </div>
    </li>
  );
}

/**
 * "Ideas for you": the stored Dipbot ideas above the wizard. It owns its data and fetches on mount only (one `load`, plus at
 * most one background `auto` when the server says a run is due); nothing here depends on the wizard, so step changes never
 * refetch. The only other request is the Refresh button.
 */
export function IdeasForYou({ onCredits, onCustomize }: Props) {
  const { api } = useApp();
  const router = useRouter();
  const headId = useId();
  const bodyId = useId();
  const [data, setData] = useState<DipbotIdeas | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [updating, setUpdating] = useState(false);
  const [running, setRunning] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Latest callback without making the mount effect depend on it.
  const creditsRef = useRef(onCredits);
  creditsRef.current = onCredits;
  // One load and one auto per mount (a dev double-invoked effect shares them).
  const boot = useRef<{ api: AdminApi; attempt: number; load: Promise<DipbotIdeas>; auto?: Promise<DipbotIdeas | null> } | null>(null);

  useEffect(() => { setCollapsed(readCollapsed()); }, []);

  useEffect(() => {
    let live = true;
    if (!boot.current || boot.current.api !== api || boot.current.attempt !== attempt) {
      boot.current = { api, attempt, load: api.dipbotIdeas({ mode: "load" }) };
    }
    const run = boot.current;
    setFailed(false);
    run.load.then((first) => {
      if (!live) return;
      setData(first);
      if (!first.enabled || !first.autoRefreshDue) return;
      setUpdating(true);
      run.auto ??= api.dipbotIdeas({ mode: "auto" }).catch(() => null);
      void run.auto.then((next) => {
        if (!live) return;
        setUpdating(false);
        if (!next) return;
        creditsRef.current(next.credits);
        if ((next.outcome === "updated" || next.outcome === "extended") && next.ideas.length > 0) setData(next);
        else setData((current) => (current ? { ...current, credits: next.credits, autoRefreshDue: false } : current));
      });
    }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [api, attempt]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeCollapsed(next);
  };

  const refresh = useCallback(async () => {
    if (running || !data) return;
    setRunning(true);
    try {
      const next = await api.dipbotIdeas({ mode: "refresh", requestId: crypto.randomUUID() });
      creditsRef.current(next.credits);
      if (next.ideas.length > 0 && next.outcome !== "failed") setData(next);
      else setData((current) => (current ? { ...current, credits: next.credits, refreshesLeftToday: next.refreshesLeftToday } : current));
      quietToast(t(next.outcome === "updated" ? "ideasForYou.refreshed" : next.outcome === "unchanged" ? "ideasForYou.unchanged" : "ideasForYou.refreshFailed"));
    } catch (error) {
      // A refused refresh changes what the button may do: the daily limit is spent.
      if (error instanceof ApiError && error.reason === "AI_IDEAS_REFRESH_LIMIT") setData((current) => (current ? { ...current, refreshesLeftToday: 0 } : current));
      quietToast(t("ideasForYou.refreshFailed"));
    } finally {
      setRunning(false);
    }
  }, [api, data, running]);

  const use = (idea: DipbotIdea) => {
    try { saveAiDraft(window.sessionStorage, idea.draft); } catch { /* the editor then opens empty */ }
    router.push("/events/new/?from=ai");
  };

  // Switched off for the company: the section is not there at all.
  if (data && !data.enabled) return null;

  const state = data ? refreshState(data, running) : null;
  const ideas = data?.ideas ?? [];
  const showRefresh = data !== null && !failed;
  const retry = () => { boot.current = null; setData(null); setAttempt((n) => n + 1); };

  return (
    <section className="ifu" aria-labelledby={headId} data-collapsed={collapsed ? "true" : "false"} data-state={failed ? "error" : data ? "ready" : "loading"}>
      <SectionHeader id={headId} title={t("ideasForYou.title")}
        updated={data && !failed ? (updating ? <span role="status"><span className="ifu-dots" aria-hidden><i /><i /><i /></span>{t("ideasForYou.updating")}</span> : updatedLine(data, new Date())) : undefined}
        toggle={{ collapsed, controls: bodyId, label: t(collapsed ? "ideasForYou.expand" : "ideasForYou.collapse"), onToggle: toggle }}
        // Out of credits is said once, by the page's credits notice; the button keeps the reason as its tooltip.
        hint={showRefresh && state?.reason && !state.outOfCredits ? state.reason : undefined}
        end={showRefresh && state ? (
          <DipbotAction size="sm" className="ifu-refresh" label={t("ideasForYou.refresh")} credits={ideasCost(data.credits)} loading={running}
            disabled={state.disabled && !running} disabledReason={state.reason ?? undefined} onClick={() => void refresh()} />
        ) : undefined} />
      <div id={bodyId} className="ifu-content" hidden={collapsed}>
        {failed ? (
          <InlineNotice tone="warn" className="ifu-note" action={<Button size="sm" onClick={retry}>{t("ideasForYou.retry")}</Button>}>{t("ideasForYou.error")}</InlineNotice>
        ) : !data ? (
          <div className="ifu-list ifu-skeletons" aria-busy="true"><span className="sr-only">{t("ideasForYou.loading")}</span>
            {Array.from({ length: SKELETONS }, (_, i) => <div className="ifu-card ifu-skeleton" key={i} aria-hidden><span className="ifu-thumb" /><span className="ifu-lines"><i /><i /><i /></span></div>)}
          </div>
        ) : (
          <>
            <ul className="ifu-list" aria-label={t("ideasForYou.list")}>
              {ideas.map((idea) => <IdeaCard key={idea.id} idea={idea} onUse={use} onCustomize={(picked) => onCustomize(answersFromIdea(picked))} />)}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

