"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { type CompanyInsights, type Role, can } from "@/lib/adminTypes";
import {
  chartModel, completionRate, formatCount, formatPercent, isQuiet, pendingActions, shortDay,
} from "@/lib/insights";
import { Avatar, formatDate } from "./Ui";

// The Overview page's building blocks. Everything is presentational: numbers come from getCompanyInsightsV1
// (cached on the server), so nothing here fetches or computes company data.

interface TileProps { label: string; value: string; note?: string; accent?: boolean }

export function StatTile({ label, value, note, accent }: TileProps) {
  return (
    <div className={`stat-tile${accent ? " accent" : ""}`} role="group" aria-label={label}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {note && <p className="stat-note">{note}</p>}
    </div>
  );
}

export function StatTiles({ insights, role }: { insights: CompanyInsights; role: Role }) {
  const { members, events, participation, content, points } = insights;
  return (
    <section className="stat-grid" aria-label="Key numbers">
      <StatTile accent label="Members" value={formatCount(members.total)} note={`${formatCount(members.active)} active accounts`} />
      <StatTile label="Active, last 30 days" value={formatCount(members.activeLast30Days)} note={members.activeCapped ? "At least this many" : "Members who joined an event"} />
      <StatTile label="Invited, not joined" value={formatCount(members.invited)} note={members.invited === 1 ? "Person yet to sign in" : "People yet to sign in"} />
      <StatTile accent label="Upcoming events" value={formatCount(events.upcoming)} note={`${formatCount(events.thisMonth)} this month`} />
      <StatTile label="RSVPs, last 30 days" value={formatCount(participation.rsvpsLast30Days)} note="Going, across all events" />
      <StatTile label="Average attendance" value={formatPercent(participation.attendanceRate)}
        note={participation.attendanceSample > 0 ? `Latest ${participation.attendanceSample} completed ${participation.attendanceSample === 1 ? "event" : "events"}` : "After the first completed event"} />
      <StatTile label="Photos, last 30 days" value={formatCount(content.photosLast30Days)} note={`${formatCount(content.commentsLast30Days)} ${content.commentsLast30Days === 1 ? "comment" : "comments"}`} />
      {can(role, "insights.points") && points
        ? <StatTile label="Points issued, 30 days" value={formatCount(points.issuedLast30Days)} note="New points awarded" />
        : <StatTile label="Events completed" value={formatCount(events.completed)} note={`${formatCount(events.cancelled)} cancelled`} />}
    </section>
  );
}

export function StatTilesSkeleton() {
  return (
    <div className="stat-grid" role="status" aria-label="Loading overview">
      {Array.from({ length: 8 }, (_, i) => <div key={i} className="stat-tile skeleton-tile" aria-hidden />)}
    </div>
  );
}

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
  const quiet = model.total.rsvps === 0 && model.total.photos === 0;
  const first = insights.activity[0]?.date, last = insights.activity[insights.activity.length - 1]?.date;
  const summary = `RSVPs and photos per day, ${first ? shortDay(first) : ""} to ${last ? shortDay(last) : ""}. ${formatCount(model.total.rsvps)} RSVPs and ${formatCount(model.total.photos)} photos in total.`;
  return (
    <section className="panel chart-panel" aria-labelledby={`${id}-h`}>
      <div className="panel-head">
        <h2 id={`${id}-h`}>Activity, last 30 days</h2>
        <ul className="legend" aria-label="Legend">
          <li><span className="swatch bar" aria-hidden />RSVPs <strong>{formatCount(model.total.rsvps)}</strong></li>
          <li><span className="swatch line" aria-hidden />Photos <strong>{formatCount(model.total.photos)}</strong></li>
        </ul>
      </div>
      {quiet ? (
        <p className="chart-empty">No RSVPs or photos in the last 30 days. Activity shows up here as soon as people join events.</p>
      ) : (
        <div ref={frame} className="chart-frame"><svg className="chart" viewBox={`0 0 ${model.width} ${model.height}`} role="img" aria-labelledby={`${id}-t ${id}-d`} preserveAspectRatio="xMidYMid meet">
          <title id={`${id}-t`}>Activity in the last 30 days</title>
          <desc id={`${id}-d`}>{summary}</desc>
          {model.ticks.map((tick) => (
            <g key={tick.value}>
              <line x1={model.plotLeft} x2={model.plotRight} y1={tick.y} y2={tick.y} className="grid" />
              <text x={model.plotLeft - 8} y={tick.y + 4} textAnchor="end" className="axis">{formatCount(tick.value)}</text>
            </g>
          ))}
          {model.bars.map((bar) => (
            <rect key={bar.day.date} x={bar.x} y={bar.y} width={bar.width} height={Math.max(bar.height, 0)} rx={Math.min(3, bar.width / 2)} className="bar" />
          ))}
          <polyline points={model.line} className="series" />
          {model.labels.map((label) => <text key={label.text} x={label.x} y={model.height - 8} textAnchor={label.anchor} className="axis">{label.text}</text>)}
        </svg></div>
      )}
      <details className="data-table">
        <summary>View as table</summary>
        <div className="table-scroll">
          <table className="table compact">
            <caption className="sr-only">RSVPs and photos per day, last 30 days</caption>
            <thead><tr><th scope="col">Day (UTC)</th><th scope="col" className="right">RSVPs</th><th scope="col" className="right">Photos</th></tr></thead>
            <tbody>
              {[...insights.activity].reverse().map((d) => (
                <tr key={d.date}><th scope="row">{shortDay(d.date)}</th><td className="right">{formatCount(d.rsvps)}</td><td className="right">{formatCount(d.photos)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export function PendingActions({ insights, role }: { insights: CompanyInsights; role: Role }) {
  const items = pendingActions(insights, role);
  return (
    <section className="panel" aria-labelledby="pending-h">
      <h2 id="pending-h">Needs attention</h2>
      {items.length === 0 ? (
        <p className="muted">You’re all caught up. Reviews and unanswered invites appear here.</p>
      ) : (
        <ul className="action-list">
          {items.map((item) => {
            const body = (<>
              <span className="action-count">{formatCount(item.count)}</span>
              <span className="action-text"><strong>{item.label}</strong><span className="muted">{item.detail}</span></span>
              {item.href && <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>}
            </>);
            return <li key={item.id}>{item.href ? <Link href={item.href} className="action-row">{body}</Link> : <div className="action-row static">{body}</div>}</li>;
          })}
        </ul>
      )}
    </section>
  );
}

export function TopEvents({ insights }: { insights: CompanyInsights }) {
  const events = insights.participation.topEvents;
  return (
    <section className="panel" aria-labelledby="top-events-h">
      <h2 id="top-events-h">Top events by attendees</h2>
      {events.length === 0 ? (
        <p className="muted">No events with attendees yet.</p>
      ) : (
        <ol className="rank-list">
          {events.map((event, index) => {
            const fill = event.capacity > 0 ? Math.min(1, event.attendeeCount / event.capacity) : 0;
            return (
              <li key={event.eventId}>
                <span className="rank" aria-hidden>{index + 1}</span>
                <div className="rank-main">
                  <Link href={`/events/attendees/?id=${encodeURIComponent(event.eventId)}`} className="rank-title">{event.title}</Link>
                  <p className="muted">{formatDate(event.startTime)} · {event.status === "completed" ? "Completed" : "Upcoming"}</p>
                  <div className="meter" role="img" aria-label={`${event.attendeeCount} of ${event.capacity} spots`}><span style={{ width: `${Math.round(fill * 100)}%` }} /></div>
                </div>
                <span className="rank-value"><strong>{formatCount(event.attendeeCount)}</strong><span className="muted"> / {formatCount(event.capacity)}</span></span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function ThemeCard({ insights, role }: { insights: CompanyInsights; role: Role }) {
  const theme = insights.challenges.current;
  const done = theme ? completionRate(theme.participantCount, theme.completedCount) : 0;
  return (
    <section className="panel" aria-labelledby="theme-h">
      <h2 id="theme-h">This week’s theme</h2>
      {!theme ? (
        <p className="muted">No weekly theme is running right now.{can(role, "themes.manage") && <> <Link href="/themes/" className="inline-link">Plan the next one</Link>.</>}</p>
      ) : (
        <>
          <p className="theme-title">{theme.title}</p>
          <p className="muted">{formatDate(theme.startDate)} to {formatDate(theme.endDate)}</p>
          <dl className="mini-stats">
            <div><dt>Participants</dt><dd>{formatCount(theme.participantCount)}</dd></div>
            <div><dt>Completed</dt><dd>{formatCount(theme.completedCount)}</dd></div>
            <div><dt>To review</dt><dd>{formatCount(theme.pendingReviews)}</dd></div>
          </dl>
          <div className="meter" role="img" aria-label={`${Math.round(done * 100)} percent of participants completed`}><span style={{ width: `${Math.round(done * 100)}%` }} /></div>
          {can(role, "challenges.review") && theme.pendingReviews > 0 && <Link href="/challenges/" className="pill-btn purple small self-start">Review submissions</Link>}
        </>
      )}
    </section>
  );
}

export function PeopleCard({ insights }: { insights: CompanyInsights }) {
  const { members } = insights;
  const rows: [string, number][] = [["Active accounts", members.active], ["Invited, not joined", members.invited], ["Deactivated", members.deactivated]];
  return (
    <section className="panel" aria-labelledby="people-h">
      <h2 id="people-h">People</h2>
      <dl className="breakdown">
        {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatCount(value)}</dd></div>)}
        <div className="total"><dt>Total members</dt><dd>{formatCount(members.total)}</dd></div>
      </dl>
    </section>
  );
}

/** Admin only: the backend sends `points` to admins alone, and the page checks the role as well. */
export function TopMembers({ insights }: { insights: CompanyInsights }) {
  const members = insights.points?.topMembers ?? [];
  return (
    <section className="panel" aria-labelledby="top-members-h">
      <h2 id="top-members-h">Top members by points</h2>
      {members.length === 0 ? (
        <p className="muted">No points earned yet.</p>
      ) : (
        <ol className="rank-list">
          {members.map((member, index) => (
            <li key={member.userId}>
              <span className="rank" aria-hidden>{index + 1}</span>
              <div className="rank-main person"><Avatar name={member.displayName} /><Link href={`/members/detail/?id=${encodeURIComponent(member.userId)}`} className="rank-title">{member.displayName}</Link></div>
              <span className="rank-value"><strong>{formatCount(member.pointsBalance)}</strong><span className="muted"> pts</span></span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function QuietNotice({ insights }: { insights: CompanyInsights }) {
  if (!isQuiet(insights)) return null;
  return (
    <p className="notice" role="status">
      Nothing has happened yet. Create the first event and invite your team; these numbers fill in as people join.{" "}
      <Link href="/events/new/" className="inline-link">Create an event</Link>
    </p>
  );
}
