"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { can } from "@/lib/adminTypes";
import { t } from "@/lib/aiStrings";
import { creditsText } from "@/lib/credits";
import { armQuick, saveEditorStash } from "@/lib/dipbotTouches";
import { useApp } from "./AppProvider";
import { DipbotMark } from "./DipbotMark";
import { useLoad } from "./useLoad";

/**
 * "Generate suggestions" in the New event header: Dipbot answers every step from the saved suggestions and writes
 * drafts straight away (quick mode on /ideas/). The click is the consent: the cost is on the button. The one-time
 * token it sets is what lets the Dipbot page spend credits, so a bookmarked /ideas/?quick=1 never does.
 * Admins only, and only while Dipbot is on for the company (the context call is free).
 */
export function GenerateSuggestionsButton() {
  const { session } = useApp();
  const router = useRouter();
  const ctx = useLoad((a) => a.eventIdeaContext(), "event-idea-context").data;
  const [going, setGoing] = useState(false);
  if (!can(session?.role, "ai.generate") || !ctx?.enabled) return null;
  const cost = creditsText(ctx.credits.creditCost.generate);
  const go = () => {
    if (going) return;
    setGoing(true);
    saveEditorStash(); // a partly filled form comes back when the admin returns
    armQuick(window.sessionStorage);
    router.push("/ideas/?quick=1");
  };
  return (
    <button type="button" className="pill-btn gray with-mark quick-btn" onClick={go} disabled={going} aria-busy={going || undefined} aria-label={t("quick.buttonCost", { cost })} title={t("quick.buttonCost", { cost })}>
      <DipbotMark size={16} />
      <span className="quick-long" aria-hidden>{t("quick.button")}</span>
      <span className="quick-short" aria-hidden>{t("quick.buttonShort")}</span>
      <span className="quick-cost" aria-hidden>{cost}</span>
    </button>
  );
}
