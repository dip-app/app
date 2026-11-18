"use client";
// @i18n-migrated

import { useEffect, useId, useRef, useState } from "react";
import type { AiCredits } from "@/lib/adminTypes";
import { t } from "@/lib/aiStrings";
import { creditsText, creditsView } from "@/lib/credits";
import { DipbotMark } from "./DipbotMark";

/**
 * The monthly Dipbot credits as a quiet outline meter: text, a thin bar and the reset date in the tooltip. Credits are
 * the only unit shown for AI use; nothing here ever mentions money.
 */
export function CreditsMeter({ credits, daily, visitCharged }: {
  credits: AiCredits;
  /** The caller's draft runs left today (a separate per-admin limit), folded into the tooltip. */ daily?: { left: number; limit: number };
  /** Credits this page visit charged for the suggestions: 0 for a saved answer, 1 for the very first visit. Undefined while loading. */ visitCharged?: number;
}) {
  const view = creditsView(credits);
  const visit = visitCharged === undefined ? "" : visitCharged === 0 ? t("credits.visit.free") : t("credits.visit.charged", { cost: creditsText(visitCharged) });
  const tip = `${t("credits.tip", { date: view.date, suggest: creditsText(credits.creditCost.suggest), generate: creditsText(credits.creditCost.generate) })}${daily ? ` ${t("credits.daily", daily)}` : ""}${visit ? ` ${visit}` : ""}`;
  const tipId = useId();
  return (
    <p className="credits-meter" data-level={view.level} tabIndex={0} aria-describedby={tipId}>
      <span id={tipId} className="credits-tip" role="tooltip">{tip}</span>
      <span className="credits-text" aria-hidden><DipbotMark size={14} />{t("credits.meter", { left: view.left, total: view.total })}</span>
      <span className="credits-bar" aria-hidden><span style={{ width: `${view.pct}%` }} /></span>
      <span className="sr-only">{t("credits.aria", { left: view.left, total: view.total, date: view.date })}{daily ? ` ${t("credits.daily", daily)}` : ""}</span>
    </p>
  );
}

/** Low and out states as a calm informational note; the admin's choices and note are never touched. */
export function CreditsNotice({ credits }: { credits: AiCredits }) {
  const view = creditsView(credits);
  if (view.level === "ok") return null;
  return (
    <div className="info-note credits-note" data-level={view.level} role={view.level === "out" ? "alert" : "status"}>
      <strong>{t(view.level === "out" ? "credits.out" : "credits.low", { date: view.date })}</strong>
    </div>
  );
}

/** "What does Dipbot see?": the privacy note lives behind a small link in the header instead of a footnote. */
export function PrivacyInfo() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [open]);
  return (
    <div className="privacy-info" ref={box}>
      <button type="button" className="link-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>{t("privacy.link")}</button>
      {open && <p id={id} className="privacy-pop" role="note">{t("privacy")}</p>}
    </div>
  );
}
