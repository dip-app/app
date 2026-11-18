"use client";

// @i18n-migrated

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { type CompanyInsights, type InsightsSection, type Role, can } from "@/lib/adminTypes";
import {
  chartModel, completionRate, formatCount, formatPercent, isQuiet, pendingActions, placeTooltip, shortcutsFor, shortDay, stepDay, tooltipDay, weekProgress,
} from "@/lib/insights";
import type { Tag } from "@/lib/catalog";
import { type TagStat, hasStats, interestLabel, interestRows } from "@/lib/tagStats";
import { type InterestsView, useInterestsView } from "@/lib/interestsView";
import { tagArt, tagBlurb } from "@/lib/tagArt";
import { Disclosure } from "./Disclosure";
import { ThemeArt } from "./ThemeArt";
import { TableRegion } from "./TableRegion";
import { Avatar } from "./Ui";
import { formatDate as formatDateWith, t } from "@/lib/i18n";
import { Button, Chip, InlineNotice, Panel, SegmentedControl } from "@/components/kit";

/** "Nov 9, 2026" in the current language (Ui's helper is English only). */
const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : formatDateWith(d, { month: "short", day: "numeric", year: "numeric" });
};

// The Overview page's building blocks. Everything is presentational: numbers come from getCompanyInsightsV1
// (cached on the server), so nothing here fetches or computes company data.

interface TileProps { label: string; value: string; note?: string; accent?: boolean; unavailable?: boolean }

const off = (insights: CompanyInsights, section: InsightsSection) => insights.unavailable.includes(section);

/** A section whose numbers the server could not compute this time: never show its placeholder zeros. */
export function SectionUnavailable() {
  return <p className="section-unavailable" role="status">{t("overview.unavailable.section")}</p>;
}

export function StatTile({ label, value, note, accent, unavailable }: TileProps) {
  return (
    <div className={`stat-tile${accent ? " accent" : ""}`} role="group" aria-label={label}>
      <p className="stat-label">{label}</p>
      {unavailable ? (
        <>
          <p className="stat-value" aria-hidden>–</p>
          <p className="stat-note">{t("overview.unavailable.tile")}</p>
        </>
      ) : (
        <>
          <p className="stat-value">{value}</p>
          {note && <p className="stat-note">{note}</p>}
        </>
      )}
    </div>
  );
}

export function StatTiles({ insights, role }: { insights: CompanyInsights; role: Role }) {
  const { members, events, participation, content, points } = insights;
  const m = off(insights, "members"), e = off(insights, "events"), p = off(insights, "participation");
  return (
    <section className="stat-grid" aria-label={t("overview.stats.label")}>
      <StatTile accent unavailable={m} label={t("overview.stats.members.label")} value={formatCount(members.total)} note={t("overview.stats.members.note", { count: formatCount(members.active) })} />
      <StatTile unavailable={m} label={t("overview.stats.active.label")} value={formatCount(members.activeLast30Days)} note={members.activeCapped ? t("overview.stats.active.capped") : t("overview.stats.active.note")} />
      <StatTile unavailable={m} label={t("overview.stats.invited.label")} value={formatCount(members.invited)} note={t("overview.stats.invited.note", { count: members.invited })} />
      <StatTile unavailable={e} label={t("overview.stats.upcoming.label")} value={formatCount(events.upcoming)} note={t("overview.stats.upcoming.note", { count: formatCount(events.thisMonth) })} />
      <StatTile unavailable={p} label={t("overview.stats.rsvps.label")} value={formatCount(participation.rsvpsLast30Days)} note={t("overview.stats.rsvps.note")} />
      <StatTile unavailable={p} label={t("overview.stats.attendance.label")} value={formatPercent(participation.attendanceRate)}
        note={participation.attendanceSample > 0 ? t("overview.stats.attendance.note", { count: participation.attendanceSample }) : t("overview.stats.attendance.none")} />
      <StatTile unavailable={off(insights, "content")} label={t("overview.stats.photos.label")} value={formatCount(content.photosLast30Days)} note={t("overview.stats.photos.note", { formatted: formatCount(content.commentsLast30Days), count: content.commentsLast30Days })} />
      {can(role, "insights.points") && points
        ? <StatTile unavailable={off(insights, "points")} label={t("overview.stats.points.label")} value={formatCount(points.issuedLast30Days)} note={t("overview.stats.points.note")} />
        : <StatTile unavailable={e} label={t("overview.stats.completed.label")} value={formatCount(events.completed)} note={t("overview.stats.completed.note", { count: formatCount(events.cancelled) })} />}
    </section>
  );
}

export { OverviewLoading } from "./OverviewSkeleton";

export function ActivityChart({ insights }: { insights: CompanyInsights }) {
  const id = useId();
  // The chart is drawn at its real pixel width, so axis text keeps its size on phones.
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const node = frame.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => { if (entry && entry.contentRect.width > 0) setWidth(Math.round(entry.contentRect.width)); });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const model = chartModel(insights.activity, Math.max(280, width), width < 480 ? 220 : 260);
  // Hover, focus and tap all drive one active day; `via` decides whether the live region announces it (keyboard and touch only).
  const [active, setActive] = useState<number | null>(null);
  const [via, setVia] = useState<"pointer" | "keyboard">("pointer");
  const tip = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; flipped: boolean }>({ left: 0, top: 0, flipped: false });
  const count = insights.activity.length;
  const slot = count > 0 ? (model.plotRight - model.plotLeft) / count : 0;
  const linePoints = model.line.split(" ").map((pair) => Number(pair.split(",")[1]));
  useLayoutEffect(() => {
    const frameNode = frame.current, tipNode = tip.current;
    if (active === null || !frameNode || !tipNode) return;
    const f = frameNode.getBoundingClientRect();
    const svg = frameNode.querySelector("svg")?.getBoundingClientRect();
    const sx = svg && svg.width > 0 ? svg.width / model.width : 1, sy = svg && svg.height > 0 ? svg.height / model.height : 1;
    const ox = svg ? svg.left - f.left : 0, oy = svg ? svg.top - f.top : 0;
    setPlace(placeTooltip({
      anchorX: ox + (model.plotLeft + (active + 0.5) * slot) * sx, anchorY: oy + model.plotTop * sy,
      width: tipNode.offsetWidth, height: tipNode.offsetHeight, boundsWidth: f.width || model.width, boundsHeight: f.height || model.height,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, width]);
  // Tapping anywhere outside the chart dismisses a touch tooltip.
  useEffect(() => {
    if (active === null) return;
    const away = (event: PointerEvent) => { if (!frame.current?.contains(event.target as Node)) setActive(null); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [active]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = stepDay(active, event.key, count);
    if (next === undefined) return;
    event.preventDefault();
    setVia("keyboard");
    setActive(next);
  };
  const activeDay = active !== null ? insights.activity[active] : undefined;
  const unavailable = off(insights, "activity");
  const quiet = model.total.rsvps === 0 && model.total.photos === 0;
  const first = insights.activity[0]?.date, last = insights.activity[insights.activity.length - 1]?.date;
  const summary = t("overview.activity.summary", { from: first ? shortDay(first) : "", to: last ? shortDay(last) : "", rsvps: formatCount(model.total.rsvps), photos: formatCount(model.total.photos) });
  return (
    <section className="panel chart-panel" aria-labelledby={`${id}-h`}>
      <div className="panel-head">
        <h2 id={`${id}-h`}>{t("overview.activity.title")}</h2>
        {!unavailable && <ul className="legend" aria-label={t("overview.activity.legend")}>
          <li><span className="swatch bar" aria-hidden />{t("overview.activity.rsvps")} <strong>{formatCount(model.total.rsvps)}</strong></li>
          <li><span className="swatch line" aria-hidden />{t("overview.activity.photos")} <strong>{formatCount(model.total.photos)}</strong></li>
        </ul>}
      </div>
      {unavailable ? <SectionUnavailable /> : quiet ? (
        <p className="chart-empty">{t("overview.activity.empty")}</p>
      ) : (
        <div ref={frame} className="chart-frame" tabIndex={0} role="group" aria-roledescription={t("overview.activity.chartRole")} aria-label={t("overview.activity.chartLabel")}
          onKeyDown={onKeyDown}
          onFocus={(event) => {
            let visible = true;
            try { visible = event.currentTarget.matches(":focus-visible"); } catch { /* older engines: treat as keyboard focus */ }
            if (visible && active === null) { setVia("keyboard"); setActive(count - 1); }
          }}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(null); }}
          onPointerLeave={(event) => { if (event.pointerType === "mouse") setActive(null); }}>
          <svg className="chart" viewBox={`0 0 ${model.width} ${model.height}`} role="img" aria-labelledby={`${id}-t ${id}-d`} preserveAspectRatio="xMidYMid meet">
            <title id={`${id}-t`}>{t("overview.activity.svgTitle")}</title>
            <desc id={`${id}-d`}>{summary}</desc>
            {model.ticks.map((tick) => (
              <g key={tick.value}>
                <line x1={model.plotLeft} x2={model.plotRight} y1={tick.y} y2={tick.y} className="grid" />
                <text x={model.plotLeft - 8} y={tick.y + 4} textAnchor="end" className="axis">{formatCount(tick.value)}</text>
              </g>
            ))}
            {active !== null && <g aria-hidden pointerEvents="none">
              <rect x={model.plotLeft + active * slot} y={model.plotTop} width={slot} height={model.plotBottom - model.plotTop} className="hover-band" />
              <line x1={model.plotLeft + (active + 0.5) * slot} x2={model.plotLeft + (active + 0.5) * slot} y1={model.plotTop} y2={model.plotBottom} className="crosshair" />
            </g>}
            {model.bars.map((bar, i) => (
              <rect key={bar.day.date} x={bar.x} y={bar.y} width={bar.width} height={Math.max(bar.height, 0)} rx={Math.min(3, bar.width / 2)} className={`bar${active === i ? " on" : ""}`} pointerEvents="none" />
            ))}
            <polyline points={model.line} className="series" pointerEvents="none" />
            {active !== null && <circle cx={model.plotLeft + (active + 0.5) * slot} cy={linePoints[active]} r={4} className="series-dot" aria-hidden pointerEvents="none" />}
            {model.labels.map((label) => <text key={label.text} x={label.x} y={model.height - 8} textAnchor={label.anchor} className="axis">{label.text}</text>)}
            {insights.activity.map((day, i) => (
              <rect key={day.date} data-col={i} data-date={day.date} x={model.plotLeft + i * slot} y={0} width={slot} height={model.plotBottom} className="hit" aria-hidden
                onPointerEnter={(event) => { if (event.pointerType === "mouse") { setVia("pointer"); setActive(i); } }}
                onPointerMove={(event) => { if (event.pointerType === "mouse" && active !== i) { setVia("pointer"); setActive(i); } }}
                onPointerDown={(event) => { if (event.pointerType !== "mouse") { setVia("keyboard"); setActive(i); } }} />
            ))}
          </svg>
          {activeDay && (
            <div ref={tip} className={`chart-tooltip${place.flipped ? " flipped" : ""}`} style={{ left: place.left, top: place.top }} aria-hidden data-testid="chart-tooltip">
              <p className="tip-date">{tooltipDay(activeDay.date)}</p>
              <p className="tip-row"><span className="swatch bar" />{t("overview.activity.rsvps")} <strong>{formatCount(activeDay.rsvps)}</strong></p>
              <p className="tip-row"><span className="swatch line" />{t("overview.activity.photos")} <strong>{formatCount(activeDay.photos)}</strong></p>
            </div>
          )}
          <p className="sr-only" aria-live="polite" role="status">{activeDay && via === "keyboard" ? t("overview.activity.live", { day: tooltipDay(activeDay.date), rsvps: formatCount(activeDay.rsvps), photos: formatCount(activeDay.photos) }) : ""}</p>
        </div>
      )}
      {!unavailable && <Disclosure className="data-table" summary={t("overview.activity.viewTable")}>
        <div className="table-scroll">
          <table className="table compact">
            <caption className="sr-only">{t("overview.activity.caption")}</caption>
            <thead><tr><th scope="col">{t("overview.activity.col.day")}</th><th scope="col" className="right">{t("overview.activity.rsvps")}</th><th scope="col" className="right">{t("overview.activity.photos")}</th></tr></thead>
            <tbody>
              {[...insights.activity].reverse().map((d) => (
                <tr key={d.date}><th scope="row">{shortDay(d.date)}</th><td className="right">{formatCount(d.rsvps)}</td><td className="right">{formatCount(d.photos)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Disclosure>}
    </section>
  );
}

const Chevron = () => <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>;

export function PendingActions({ insights, role, now }: { insights: CompanyInsights; role: Role; now?: Date }) {
  const items = pendingActions(insights, role, now);
  const shortcuts = shortcutsFor(role);
  // Both sources down: nothing to show. One down: show what is known, never "all caught up".
  const partial = off(insights, "challenges") || off(insights, "members");
  return (
    <Panel id="pending-h" title={t("overview.pending.title")}>
      {partial && items.length === 0 ? <SectionUnavailable /> : items.length === 0 ? (
        <p className="muted fill">{t("overview.pending.empty")}</p>
      ) : (
        <ul className="action-list">
          {items.map((item) => {
            const body = (<>
              <span className="action-count">{formatCount(item.count)}</span>
              <span className="action-text"><strong>{item.label}</strong>{item.lines.map((line) => <span key={line} className="muted">{line}</span>)}</span>
              {item.href && <Chevron />}
            </>);
            return <li key={item.id}>{item.href ? <Link href={item.href} className="action-row">{body}</Link> : <div className="action-row static">{body}</div>}</li>;
          })}
        </ul>
      )}
      {partial && items.length > 0 && <p className="muted">{t("overview.pending.partial")}</p>}
      {shortcuts.length > 0 && (
        <div className="shortcuts">
          <h3 id="shortcuts-h">{t("overview.shortcuts.title")}</h3>
          <ul className="shortcut-list" aria-labelledby="shortcuts-h">
            {shortcuts.map((s) => <li key={s.id}><Link href={s.href} className="shortcut"><span>{s.label}</span><Chevron /></Link></li>)}
          </ul>
        </div>
      )}
    </Panel>
  );
}

export function TopEvents({ insights }: { insights: CompanyInsights }) {
  const events = insights.participation.topEvents;
  return (
    <Panel id="top-events-h" title={t("overview.topEvents.title")}>
      {off(insights, "participation") ? <SectionUnavailable /> : events.length === 0 ? (
        <p className="muted fill">{t("overview.topEvents.empty")}</p>
      ) : (
        <ol className="rank-list">
          {events.map((event, index) => {
            const fill = event.capacity > 0 ? Math.min(1, event.attendeeCount / event.capacity) : 0;
            return (
              <li key={event.eventId}>
                <span className="rank" aria-hidden>{index + 1}</span>
                <div className="rank-main">
                  <Link href={`/events/attendees/?id=${encodeURIComponent(event.eventId)}`} className="rank-title">{event.title}</Link>
                  <p className="muted">{formatDate(event.startTime)} · {event.status === "completed" ? t("overview.topEvents.completed") : t("overview.topEvents.upcoming")}</p>
                  <div className="meter" role="img" aria-label={t("overview.topEvents.spots", { count: event.attendeeCount, capacity: event.capacity })}><span style={{ width: `${Math.round(fill * 100)}%` }} /></div>
                </div>
                <span className="rank-value"><strong>{formatCount(event.attendeeCount)}</strong><span className="muted"> / {formatCount(event.capacity)}</span>{event.capacity > 0 && event.attendeeCount >= event.capacity && <Chip full>{t("overview.topEvents.full")}</Chip>}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

export function ThemeCard({ insights, role, now = new Date() }: { insights: CompanyInsights; role: Role; now?: Date }) {
  const theme = insights.challenges.current;
  const done = theme ? completionRate(theme.participantCount, theme.completedCount) : 0;
  const week = theme ? weekProgress(theme.startDate, theme.endDate, now) : null;
  return (
    <section className="panel theme-panel" aria-labelledby="theme-h">
      <h2 id="theme-h">{t("overview.theme.title")}</h2>
      {off(insights, "challenges") ? <SectionUnavailable /> : !theme || !week ? (
        <p className="muted fill">{t("overview.theme.none")}{can(role, "themes.manage") && <> <Link href="/themes/" className="inline-link">{t("overview.theme.plan")}</Link>.</>}</p>
      ) : (
        <>
          <div className="theme-hero">
            {theme.coverImageURL && <ThemeArt url={theme.coverImageURL} title={theme.title} className="theme-hero-art" />}
            <div className="theme-hero-text">
              <p className="theme-title">{theme.title}</p>
              <p className="muted">{t("overview.theme.dates", { start: formatDate(theme.startDate), end: formatDate(theme.endDate) })}</p>
            </div>
          </div>
          <dl className="mini-stats">
            <div><dt>{t("overview.theme.participants")}</dt><dd>{formatCount(theme.participantCount)}</dd></div>
            <div><dt>{t("overview.theme.completed")}</dt><dd>{formatCount(theme.completedCount)}</dd></div>
            <div><dt>{t("overview.theme.toReview")}</dt><dd>{formatCount(theme.pendingReviews)}</dd></div>
          </dl>
          <div className="theme-meters">
            <div className="theme-meter"><p className="muted"><span>{t("overview.theme.completed")}</span><span>{Math.round(done * 100)}%</span></p>
              <div className="meter" role="img" aria-label={t("overview.theme.completedPercent", { percent: Math.round(done * 100) })}><span style={{ width: `${Math.round(done * 100)}%` }} /></div></div>
            <div className="theme-meter"><p className="muted"><span>{t("overview.theme.thisWeek")}</span><span>{t("overview.theme.day", { day: week.day, days: week.days })}</span></p>
              <div className="meter" role="img" aria-label={t("overview.theme.day", { day: week.day, days: week.days })}><span style={{ width: `${Math.round(week.fraction * 100)}%` }} /></div></div>
          </div>
          {can(role, "challenges.review") && theme.pendingReviews > 0 && <Button href={`/challenges/review/?id=${encodeURIComponent(theme.challengeId)}&status=submitted`} variant="primary" size="sm" className="self-start theme-cta">{t("overview.theme.review")}</Button>}
        </>
      )}
    </section>
  );
}

export function PeopleCard({ insights }: { insights: CompanyInsights }) {
  const { members } = insights;
  const rows: [string, number, string][] = [[t("overview.people.active"), members.active, "active"], [t("overview.people.invited"), members.invited, "invited"], [t("overview.people.deactivated"), members.deactivated, "off"]];
  const sum = rows.reduce((n, row) => n + row[1], 0);
  return (
    <Panel id="people-h" title={t("overview.people.title")}>
      {off(insights, "members") ? <SectionUnavailable /> : (
        <>
          <div className="stack-bar" role="img" aria-label={rows.map(([label, value]) => t("overview.people.summary", { label, value })).join(", ")}>
            {sum > 0 ? rows.map(([label, value, tone]) => value > 0 && <span key={label} className={`seg-${tone}`} style={{ flexGrow: value }} />) : <span className="seg-empty" style={{ flexGrow: 1 }} />}
          </div>
          <dl className="breakdown">
            {rows.map(([label, value, tone]) => <div key={label}><dt><span className={`dot seg-${tone}`} aria-hidden />{label}</dt><dd>{formatCount(value)}</dd></div>)}
            <div className="total"><dt>{t("overview.people.total")}</dt><dd>{formatCount(members.total)}</dd></div>
          </dl>
        </>
      )}
    </Panel>
  );
}

/** Admin only: the backend sends `points` to admins alone, and the page checks the role as well. */
export function TopMembers({ insights }: { insights: CompanyInsights }) {
  const members = insights.points?.topMembers ?? [];
  return (
    <Panel id="top-members-h" title={t("overview.topMembers.title")}>
      {off(insights, "points") ? <SectionUnavailable /> : members.length === 0 ? (
        <p className="muted fill">{t("overview.topMembers.empty")}</p>
      ) : (
        <ol className="rank-list">
          {members.map((member, index) => (
            <li key={member.userId}>
              <span className="rank" aria-hidden>{index + 1}</span>
              <div className="rank-main person"><Avatar name={member.displayName} userId={member.userId} photoURL={member.photoURL} avatarId={member.avatarId} /><Link href={`/members/detail/?id=${encodeURIComponent(member.userId)}`} className="rank-title">{member.displayName}</Link></div>
              <span className="rank-value"><strong>{formatCount(member.pointsBalance)}</strong><span className="muted"> {t("overview.topMembers.pts")}</span></span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/** Grid / List switch for the Interests card: a two-button segmented control with icon-only buttons (tooltip and accessible name). */
export function InterestsViewToggle({ view, onChange }: { view: InterestsView; onChange: (next: InterestsView) => void }) {
  const items: { id: InterestsView; label: string; d: string }[] = [
    { id: "grid", label: t("overview.interests.grid"), d: "M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z" },
    { id: "list", label: t("overview.interests.list"), d: "M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01" },
  ];
  return (
    <SegmentedControl variant="icon" label={t("overview.interests.layout")} value={view} onChange={onChange} options={items.map((item) => ({ value: item.id, label: item.label, iconPath: item.d }))} />
  );
}

/**
 * Members per interest tag (companies/{c}/tagStats). The page hides the card when the role can't read the stats.
 * `activeMembers` comes from the insights call and is null when that call failed: bars are then relative to the
 * top tag and the share column is left out. An empty list shows a muted line, like the other Overview cards do.
 */
export function InterestsCard({ stats, tags, activeMembers }: { stats: TagStat[]; tags: Tag[]; activeMembers: number | null }) {
  const rows = hasStats(stats) ? interestRows(stats, tags, activeMembers) : [];
  const showShare = rows.some((row) => row.share !== null);
  const [view, setView] = useInterestsView();
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  return (
    <section className="panel interests-panel" aria-labelledby="interests-h">
      <div className="panel-head">
        <h2 id="interests-h">{t("overview.interests.title")}</h2>
        {rows.length > 0 && <InterestsViewToggle view={view} onChange={setView} />}
      </div>
      {rows.length === 0 ? (
        <p className="muted">{t("overview.interests.empty")}</p>
      ) : view === "grid" ? (
        <>
          <p className="muted">{t("overview.interests.intro")}</p>
          <ul className="tag-grid" aria-label={t("overview.interests.perInterest")}>
            {rows.map((row) => {
              const tag = byId.get(row.tagId) ?? { id: row.tagId, name: row.name };
              const art = tagArt(tag);
              return (
                <li key={row.tagId} className="tag-card" title={interestLabel(row.count)}>
                  <span className="tag-card-art" data-kind={art.kind} style={{ background: art.bg }} aria-hidden>
                    {/* eslint-disable-next-line @next/next/no-img-element -- static export, unoptimized images */}
                    <img src={art.src} alt="" loading="lazy" draggable={false} />
                  </span>
                  <span className="tag-card-text">
                    <span className="tag-card-name">{row.name}</span>
                    <span className="tag-card-blurb">{tagBlurb(tag)}</span>
                    <span className="tag-card-meta"><strong>{row.count}</strong> {t("overview.interests.membersNoun", { count: row.count })}{row.share !== null && <> · {row.share}%</>}</span>
                  </span>
                  <span className="tag-card-bar meter" aria-hidden><span style={{ width: `${row.percent}%` }} /></span>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          <p className="muted">{t("overview.interests.intro")}</p>
          <TableRegion label={t("overview.interests.perInterest")}>
            <table className="table compact interest-table">
              <caption className="sr-only">{t("overview.interests.intro")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("overview.interests.col.interest")}</th>
                  <th scope="col"><span className="sr-only">{showShare ? t("overview.interests.barShare") : t("overview.interests.barRelative")}</span></th>
                  <th scope="col" className="num">{t("overview.interests.col.members")}</th>
                  {showShare && <th scope="col" className="num">{t("overview.interests.col.share")}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.tagId} title={interestLabel(row.count)}>
                    <th scope="row" className="interest-name">{row.name}</th>
                    <td className="interest-bar"><div className="meter" aria-hidden><span style={{ width: `${row.percent}%` }} /></div></td>
                    <td className="num">{row.count}</td>
                    {showShare && <td className="num muted">{row.share}%</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        </>
      )}
    </section>
  );
}

/** Shown above the page when any section failed, so placeholder sections are never read as real numbers. */
export function UnavailableNotice({ insights }: { insights: CompanyInsights }) {
  if (insights.unavailable.length === 0) return null;
  return <InlineNotice>{t("overview.unavailable.notice")}</InlineNotice>;
}

export function QuietNotice({ insights }: { insights: CompanyInsights }) {
  if (!isQuiet(insights)) return null;
  return (
    <p className="notice" role="status">
      {t("overview.quiet.text")}{" "}
      <Link href="/events/new/" className="inline-link">{t("overview.quiet.cta")}</Link>
    </p>
  );
}
