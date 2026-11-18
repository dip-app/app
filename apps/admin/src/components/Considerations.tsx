"use client";
// @i18n-migrated

import { useId, useState } from "react";
import type { AiConsiderationRank, AiSuggestionProvider } from "@/lib/adminTypes";
import { t, tn } from "@/lib/aiStrings";
import { MAX_CONSIDERATIONS, considerationById, type Consideration } from "@/lib/considerations";
import { considerationHint, considerationLabel, frontRow, groupedConsiderations } from "@/lib/considerationsView";
import type { Answers } from "@/lib/ideas";
import { DipbotMark } from "./DipbotMark";

interface Props {
  /** The saved company ranking (every consideration, best first); empty while it loads or when there is none. */
  ranking: readonly AiConsiderationRank[];
  provider: AiSuggestionProvider;
  answers: Answers;
  onToggle: (id: string) => void;
}

function Chip({ item, on, suggested, onToggle }: { item: Consideration; on: boolean; suggested: boolean; onToggle: () => void }) {
  return (
    <li>
      <button type="button" className="pref-chip" aria-pressed={on} data-suggested={suggested ? "true" : undefined} title={considerationHint(item)} onClick={onToggle}>
        <span>{considerationLabel(item)}</span>
        {suggested && <span className="sr-only">. {t("consider.suggested")}</span>}
        <span className="sr-only">. {considerationHint(item)}</span>
      </button>
    </li>
  );
}

/**
 * Preference chips for the draft request. {ai} ranks which ones to show first (from the saved company suggestions,
 * reordered locally by the choices so far); "More options" lists every one grouped by category, with search, so an
 * accommodation or dietary need is never reachable only through the ranking. Selected chips persist across steps and
 * across ranking refreshes because the selection lives in the flow's answers, not here.
 */
export function Considerations({ ranking, provider, answers, onToggle }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const panelId = useId();
  const searchId = useId();
  const { shown, top, suggested, ranked } = frontRow(ranking, answers, provider);
  const groups = groupedConsiderations(ranked, query, new Set(top));
  const selected = answers.considerations.length;
  const atMax = selected >= MAX_CONSIDERATIONS;
  const toggle = (id: string) => onToggle(id);
  return (
    <section className="consider" aria-labelledby={`${panelId}-title`}>
      <div className="consider-head">
        <h3 id={`${panelId}-title`}>{t("consider.title")}</h3>
        <p>{suggested.size > 0 ? <DipbotMark size={14} /> : null}{t(suggested.size > 0 ? "consider.hintSuggested" : "consider.hint")}</p>
      </div>
      <ul className="pref-chips" aria-label={t("consider.group")}>
        {shown.map((id) => {
          const item = considerationById(id);
          return item ? <Chip key={id} item={item} on={answers.considerations.includes(id)} suggested={suggested.has(id)} onToggle={() => toggle(id)} /> : null;
        })}
      </ul>
      <div className="consider-more">
        <button type="button" className="link-btn consider-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
          {t(open ? "consider.less" : "consider.more")}
          {selected > 0 && <span className="muted">({tn("consider.selected", selected)})</span>}
        </button>
        {atMax && <p className="muted" role="status">{t("consider.max", { n: MAX_CONSIDERATIONS })}</p>}
        <div id={panelId} className="consider-panel" hidden={!open}>
          <input id={searchId} type="search" value={query} aria-label={t("consider.search")} placeholder={t("consider.searchPlaceholder")} onChange={(e) => setQuery(e.target.value)} />
          {groups.length === 0 ? (
            <p className="muted" role="status">{t("consider.none")}</p>
          ) : (
            <div className="consider-groups">
              {groups.map((g) => (
                <fieldset key={g.group}>
                  <legend>{g.label}</legend>
                  <ul className="pref-chips">
                    {g.items.map((item) => (
                      <Chip key={item.id} item={item} on={answers.considerations.includes(item.id)} suggested={suggested.has(item.id)} onToggle={() => toggle(item.id)} />
                    ))}
                  </ul>
                </fieldset>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
