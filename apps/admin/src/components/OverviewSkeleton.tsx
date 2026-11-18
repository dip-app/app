"use client";

// @i18n-migrated

import type { ReactNode } from "react";
import { type Role, can } from "@/lib/adminTypes";
import { shortcutsFor } from "@/lib/insights";
import { t } from "@/lib/i18n";
import { useInterestsView } from "@/lib/interestsView";
import { CHART_HEIGHT, INTEREST_CARD_HEIGHT, OVERVIEW_LAYOUT as L } from "@/lib/skeletonLayout";
import { Sk, SkeletonAvatar, SkeletonBlock, SkeletonChart, SkeletonCircle, SkeletonRegion, SkeletonStatTile } from "./Skeleton";

// The Overview while it loads. Same markup and classes as the loaded cards (see Overview.tsx), counts and heights from
// `OVERVIEW_LAYOUT`, so the page keeps its height and nothing moves when the data arrives.

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

function Panel({ title, className = "", children }: { title: number; className?: string; children: ReactNode }) {
  return <section className={`panel ${className}`.trim()} aria-hidden><h2><Sk w={title} /></h2>{children}</section>;
}

function RankRows({ rows, person = false }: { rows: number; person?: boolean }) {
  return (
    <ol className="rank-list">
      {range(rows).map((i) => (
        <li key={i}>
          <span className="rank sk-rank" />
          {person
            ? <div className="rank-main person"><SkeletonAvatar /><span className="rank-title"><Sk w={`${64 + ((i * 11) % 24)}%`} /></span></div>
            : <div className="rank-main"><span className="rank-title"><Sk w={`${60 + ((i * 13) % 30)}%`} /></span><p className="muted"><Sk w="44%" /></p><div className="meter"><span style={{ width: `${70 - i * 12}%` }} /></div></div>}
          <span className="rank-value"><Sk w={44} /></span>
        </li>
      ))}
    </ol>
  );
}

/** The Interests card while the counts load; follows the saved grid/list choice. `count` is the catalog size once it is known. */
export function InterestsSkeleton({ count = L.interestCards }: { count?: number }) {
  const [view] = useInterestsView();
  return (
    <section className="panel interests-panel" aria-hidden>
      <div className="panel-head"><h2><Sk w={84} /></h2><span className="view-toggle"><span className="view-toggle-btn sk" /><span className="view-toggle-btn sk" /></span></div>
      <p className="muted"><Sk w={220} /></p>
      {view === "grid" ? (
        <ul className="tag-grid">
          {range(count).map((i) => (
            <li key={i} className="tag-card sk-tag-card" style={{ height: INTEREST_CARD_HEIGHT }}>
              <span className="tag-card-art sk" />
              <span className="tag-card-text"><span className="tag-card-name"><Sk w={`${46 + ((i * 7) % 30)}%`} /></span><span className="tag-card-blurb"><Sk w={`${62 + ((i * 5) % 26)}%`} /></span><span className="tag-card-meta"><Sk w="40%" /></span></span>
              <span className="tag-card-bar meter"><span style={{ width: `${80 - ((i * 9) % 60)}%` }} /></span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="table-wrap">
          <table className="table compact interest-table">
            <thead><tr><th scope="col">{t("overview.interests.col.interest")}</th><th scope="col" /><th scope="col" className="num">{t("overview.interests.col.members")}</th><th scope="col" className="num">{t("overview.interests.col.share")}</th></tr></thead>
            <tbody>
              {range(count).map((i) => (
                <tr key={i}><th scope="row" className="interest-name"><Sk w={`${50 + ((i * 7) % 40)}%`} /></th><td className="interest-bar"><div className="meter"><span style={{ width: `${80 - ((i * 9) % 60)}%` }} /></div></td><td className="num"><Sk w={24} /></td><td className="num"><Sk w={32} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * The loading page: every card of the loaded page as a placeholder, plus whatever is already ready (the Interests card),
 * stacked in the same `.overview` grid so each section keeps its gap. `role` decides whether "Top members" exists.
 */
export function OverviewLoading({ children, role = "admin", interestCount }: { children?: ReactNode; role?: Role; interestCount?: number }) {
  const showPoints = can(role, "insights.points");
  const shortcuts = shortcutsFor(role);
  return (
    <SkeletonRegion label={t("overview.loading")} className="overview">
      <section className="stat-grid" aria-hidden>{range(L.tiles).map((i) => <SkeletonStatTile key={i} />)}</section>

      <div className="overview-row wide-left" aria-hidden>
        <section className="panel chart-panel">
          <div className="panel-head">
            <h2><Sk w={150} /></h2>
            <ul className="legend"><li><span className="swatch bar" /><Sk w={64} /></li><li><span className="swatch line" /><Sk w={64} /></li></ul>
          </div>
          <SkeletonChart height={CHART_HEIGHT} />
          <div className="disclosure"><span className="sk-disclosure"><SkeletonCircle size={16} /><Sk w={78} /></span></div>
        </section>
        <Panel title={130}>
          <ul className="action-list">
            {range(L.pendingRows).map((i) => (
              <li key={i}><div className="action-row static"><SkeletonBlock w={28} h={28} r={4} /><span className="action-text"><strong><Sk w="58%" /></strong><span className="muted"><Sk w={`${70 - i * 14}%`} /></span></span></div></li>
            ))}
          </ul>
          {shortcuts.length > 0 && (
            <div className="shortcuts"><h3><Sk w={76} /></h3>
              <ul className="shortcut-list">{shortcuts.map((s) => <li key={s.id}><span className="shortcut"><span className="sk-shortcut"><Sk w={`${40 + (s.label.length % 5) * 8}%`} /></span></span></li>)}</ul></div>
          )}
        </Panel>
      </div>

      <div className="overview-row" aria-hidden>
        <Panel title={180}><RankRows rows={L.topEventRows} /></Panel>
        <Panel title={150} className="theme-panel">
          <div className="theme-hero"><SkeletonBlock w={72} h={72} r={8} className="theme-hero-art" /><div className="theme-hero-text"><p className="theme-title"><Sk w="60%" /></p><p className="muted"><Sk w="72%" /></p></div></div>
          <dl className="mini-stats">{["a", "b", "c"].map((k) => <div key={k}><dt><Sk w="70%" /></dt><dd><Sk w="40%" /></dd></div>)}</dl>
          <div className="theme-meters">{["a", "b"].map((k) => <div key={k} className="theme-meter"><p className="muted"><Sk w="100%" /></p><div className="meter"><span style={{ width: k === "a" ? "34%" : "58%" }} /></div></div>)}</div>
          {can(role, "challenges.review") && <SkeletonBlock w={138} h={28} r={6} className="self-start theme-cta" />}
        </Panel>
      </div>

      <div className={`overview-row${showPoints ? "" : " single"}`} aria-hidden>
        <Panel title={70}>
          <div className="stack-bar"><span className="seg-active" style={{ flexGrow: 8 }} /><span className="seg-invited" style={{ flexGrow: 2 }} /><span className="seg-off" style={{ flexGrow: 1 }} /></div>
          <dl className="breakdown">{range(L.peopleRows).map((i) => <div key={i} className={i === L.peopleRows - 1 ? "total" : undefined}><dt><Sk w={110} /></dt><dd><Sk w={24} /></dd></div>)}</dl>
        </Panel>
        {showPoints && <Panel title={190}><RankRows rows={L.topMemberRows} person /></Panel>}
      </div>

      {children ?? <InterestsSkeleton count={interestCount} />}
    </SkeletonRegion>
  );
}
