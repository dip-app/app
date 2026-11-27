"use client";

// @i18n-migrated

import Link from "next/link";
import type { AuditEntry, CompanyInsights, Role } from "@/lib/adminTypes";
import { can } from "@/lib/adminTypes";
import { auditAction, auditSummary } from "@/lib/auditLabels";
import { type AdminEvent, formatPrice } from "@/lib/contract";
import { changeText, comingUp, completionRate, formatCount, heldLastWeek, lastSevenDays, weekProgress } from "@/lib/insights";
import { formatDate, formatTime, t } from "@/lib/i18n";
import { Cover } from "./Cover";
import { Avatar } from "./Avatar";
import { Chip, Panel, RelativeTime } from "@/components/kit";

// The Overview's "what changed and what is next" pieces: the Last 7 days band, Coming up and Recent activity.
// Numbers come from data the page already reads (insights activity, the event list, the audit log); nothing new on the server.

/** A tiny bar spark: the 7 earlier days light, the last 7 days in the accent. Decorative; the numbers carry the meaning. */
function Spark({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  const w = 6, gap = 2, h = 28;
  return (
    <svg className="week-spark" viewBox={`0 0 ${values.length * (w + gap) - gap} ${h}`} width={values.length * (w + gap) - gap} height={h} aria-hidden focusable="false">
      {values.map((v, i) => {
        const bh = Math.max(2, Math.round((v / max) * h));
        return <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={1.5} className={i >= values.length - 7 ? "now" : "before"} />;
      })}
    </svg>
  );
}

function WeekTile({ label, value, note, href, spark, unavailable }: { label: string; value: string; note?: string | null; href?: string; spark?: number[]; unavailable?: boolean }) {
  const body = (
    <>
      <span className="week-label">{label}</span>
      {unavailable
        ? <><span className="week-value" aria-hidden>–</span><span className="week-note">{t("overview.unavailable.tile")}</span></>
        : <>
          <span className="week-row"><span className="week-value">{value}</span>{spark && <Spark values={spark} />}</span>
          {note && <span className="week-note">{note}</span>}
        </>}
    </>
  );
  return <li className="week-tile">{href && !unavailable ? <Link href={href} className="week-link">{body}</Link> : <div className="week-link static">{body}</div>}</li>;
}

/**
 * The first thing on the Overview: the last 7 complete days against the 7 before (RSVPs, photos), the events held,
 * and how this week's challenge is going. A section the server marked unavailable shows a dash, never a zero delta.
 */
export function LastSevenDays({ insights, events, role, now }: { insights: CompanyInsights; events: AdminEvent[] | null; role: Role; now: Date }) {
  const activityOff = insights.unavailable.includes("activity");
  const rsvps = lastSevenDays(insights.activity, "rsvps", now);
  const photos = lastSevenDays(insights.activity, "photos", now);
  const held = events ? heldLastWeek(events, now) : null;
  const theme = insights.challenges.current;
  const challengeOff = insights.unavailable.includes("challenges");
  const week = theme ? weekProgress(theme.startDate, theme.endDate, now) : null;
  return (
    <section className="week-band" aria-labelledby="week-h">
      <h2 id="week-h" className="overview-section-title">{t("overview.week.title")}</h2>
      <ul className="week-grid">
        <WeekTile label={t("overview.week.rsvps")} value={formatCount(rsvps.current)} note={changeText(rsvps.current, rsvps.previous)} spark={rsvps.spark} unavailable={activityOff} />
        <WeekTile label={t("overview.week.photos")} value={formatCount(photos.current)} note={changeText(photos.current, photos.previous)} spark={photos.spark} unavailable={activityOff} />
        <WeekTile label={t("overview.week.held")} value={held ? formatCount(held.count) : "–"} note={held ? t("overview.week.heldNote", { count: held.going }) : null}
          href={can(role, "events.manage") ? "/events/?filter=past" : undefined} />
        {theme && week
          ? <WeekTile label={t("overview.week.challenge", { title: theme.title })} value={`${Math.round(completionRate(theme.participantCount, theme.completedCount) * 100)}%`}
            note={t("overview.week.challengeNote", { completed: formatCount(theme.completedCount), joined: formatCount(theme.participantCount), day: week.day, days: week.days })}
            href={can(role, "challenges.review") ? `/challenges/review/?id=${encodeURIComponent(theme.challengeId)}` : "/challenges/"} unavailable={challengeOff} />
          : <WeekTile label={t("overview.week.noChallenge")} value="–" note={t("overview.theme.none")} href={can(role, "themes.manage") ? "/challenges/new/" : undefined} unavailable={challengeOff} />}
      </ul>
    </section>
  );
}

/** The next two weeks of events: when, how full, a quick way into attendees. */
export function ComingUp({ events, now }: { events: AdminEvent[] | null; now: Date }) {
  const next = events ? comingUp(events, now, 14).slice(0, 5) : [];
  return (
    <Panel id="coming-h" title={t("overview.coming.title")} loading={events === null}
      actions={<Link href="/events/" className="panel-link">{t("overview.coming.all")}</Link>}
      empty={events !== null && next.length === 0 ? t("overview.coming.empty") : undefined}>
      <ul className="coming-list">
        {next.map((event) => {
          const start = new Date(event.startTime);
          const fill = event.capacity > 0 ? Math.min(1, event.attendeeCount / event.capacity) : 0;
          const full = event.capacity > 0 && event.attendeeCount >= event.capacity;
          return (
            <li key={event.id}>
              <Link href={`/events/attendees/?id=${encodeURIComponent(event.id)}`} className="coming-row">
                <span className="coming-date" aria-hidden><span>{formatDate(start, { month: "short" })}</span><strong>{formatDate(start, { day: "numeric" })}</strong></span>
                <Cover url={event.coverImageURL} className="thumb coming-thumb" />
                <span className="coming-main">
                  <span className="coming-title">{event.title}</span>
                  <span className="muted">{formatDate(start, { weekday: "short", month: "short", day: "numeric" })}, {formatTime(start, { hour: "numeric", minute: "2-digit" })} · <RelativeTime iso={event.startTime} /> · {formatPrice(event.costCents)}</span>
                </span>
                <span className="coming-going">
                  <span>{t("events.row.going", { count: event.attendeeCount, capacity: event.capacity })}</span>
                  <span className="going-bar">{full && <Chip>{t("events.status.full")}</Chip>}<span className="meter-mini" aria-hidden><span style={{ width: `${Math.round(fill * 100)}%` }} /></span></span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Admins: the latest changes from the audit log, newest first, with relative times. */
export function RecentActivity({ entries, error }: { entries: AuditEntry[] | null; error: boolean }) {
  const latest = (entries ?? []).slice(0, 6);
  return (
    <Panel id="activity-feed-h" title={t("overview.feed.title")} loading={entries === null && !error}
      actions={<Link href="/audit/" className="panel-link">{t("overview.feed.all")}</Link>}
      empty={error ? t("overview.feed.unavailable") : entries !== null && latest.length === 0 ? t("overview.feed.empty") : undefined}>
      <ol className="feed-list">
        {latest.map((entry) => {
          const summary = auditSummary(entry);
          const label = auditAction(entry.action).label;
          return (
            <li key={entry.id} className="feed-item">
              <Avatar name={entry.actorName} userId={entry.actorId} size={28} />
              <span className="feed-text">
                <span><strong>{entry.actorName}</strong> <span className="feed-what">{summary || label}</span></span>
                <span className="muted"><RelativeTime iso={entry.at} /></span>
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
