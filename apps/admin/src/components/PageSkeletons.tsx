"use client";

import type { ReactNode } from "react";
import { Sk, SkeletonAvatar, SkeletonBlock, SkeletonCardGrid, SkeletonColumn, SkeletonRegion, SkeletonTable } from "./Skeleton";
import { OverviewLoading } from "./OverviewSkeleton";

// Loading layouts for every admin page. Each one reuses the page's own classes and column headings, so row heights,
// gaps and widths match the loaded page. `Loading` (Ui.tsx) picks one by name.

export type SkeletonLayout =
  | "overview" | "events" | "themes" | "challenges" | "review" | "members" | "memberDetail" | "roster" | "importPreview"
  | "bugs" | "bugDetail" | "audit" | "ideas" | "suggestions" | "form" | "attendees" | "album" | "list";

/** Row counts per table, in one place (the first screen of each real list is this long or longer). */
export const SKELETON_ROWS = { events: 8, themes: 6, challenges: 6, members: 10, roster: 10, audit: 10, attendees: 8, importPreview: 6, queue: 6 } as const;

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
/** A plausible text width in px for row `i` (about `base` percent of a 160 px cell, varied a little per row). */
const w = (i: number, base = 50, spread = 36) => Math.round((base + ((i * 17) % spread)) * 1.6);
/** Fixed widths for placeholders inside shrink-to-fit boxes (a percentage of an auto-width box collapses). */
const px = (i: number, base = 120, spread = 70) => base + ((i * 37) % spread);
const Pill = ({ width = 72 }: { width?: number }) => <SkeletonBlock w={width} h={24} r={999} />;
const Button = ({ width = 68 }: { width?: number }) => <SkeletonBlock w={width} h={28} r={6} />;

/** The underlined tab strip of Tabs with the page's real labels. */
function TabsGhost({ labels }: { labels: string[] }) {
  return <div className="tabs" aria-hidden>{labels.map((label, i) => <span key={label} className={`tab${i === 0 ? " sk-current" : ""}`}>{label}<span className="sk-tab-count"> (0)</span></span>)}</div>;
}
const InputGhost = () => <span className="sk sk-input" />;
const SearchGhost = () => <div className="field search" aria-hidden><InputGhost /></div>;
const CountLine = () => <p className="result-count" aria-hidden><Sk w={150} /></p>;

const person = (i: number) => (
  <span className="person"><SkeletonAvatar /><span><Sk w={px(i, 110, 60)} /><Sk w={px(i, 150, 70)} /></span></span>
);
// Wraps a stacked pair of placeholder lines in a block cell.
const lines = (i: number, a = 60, b = 44) => (<><span className="line"><Sk w={w(i, a)} /></span><span className="line muted"><Sk w={w(i + 3, b)} /></span></>);

const EVENT_COLUMNS: SkeletonColumn[] = [
  { head: "Event", cellClass: "cell-main", cell: (i) => (
    <div className="media-cell"><span className="thumb sk" /><div className="media-text"><span className="row-title"><Sk w={px(i, 150, 80)} /></span><span className="muted clamp-1"><Sk w={px(i + 2, 190, 90)} /></span></div></div>) },
  { head: "When", cell: (i) => <><span className="line"><Sk w={124} /><Sk w={84} /></span><span className="line muted"><Sk w={w(i + 3, 44)} /></span></> },
  { head: "Where", cell: (i) => lines(i + 1) },
  { head: "Price", className: "num", cell: () => <Sk w={36} /> },
  { head: "Going", className: "num", cell: (i) => <div className="going"><Sk w={52} /><span className="meter-mini"><span style={{ width: `${30 + ((i * 19) % 60)}%` }} /></span></div> },
  { head: "Status", cell: () => <Pill /> },
  { head: "Actions", hidden: true, className: "right", cell: () => <span className="row-actions"><Button /><Button width={44} /></span> },
];

const THEME_COLUMNS: SkeletonColumn[] = [
  { head: "Theme", cellClass: "cell-main", cell: (i) => (
    <div className="media-cell"><span className="thumb art tile sk" /><div className="media-text"><span className="row-title"><Sk w={px(i, 120, 70)} /></span><span className="muted"><Sk w={px(i, 150, 60)} /></span></div></div>) },
  { head: "Week", cell: (i) => <Sk w={w(i, 70, 20)} /> },
  { head: "Goal", cell: () => <Sk w={60} /> },
  { head: "Reward", cell: () => <Sk w={48} /> },
  { head: "Participation", className: "num", cell: () => <Sk w={90} /> },
  { head: "Status", cell: () => <Pill width={64} /> },
  { head: "Actions", hidden: true, className: "right", cell: () => <span className="row-actions"><Button width={44} /></span> },
];

const CHALLENGE_COLUMNS: SkeletonColumn[] = [
  { head: "Challenge", cellClass: "cell-main", cell: (i) => (
    <div className="media-cell"><span className="thumb art tile sk" /><div className="media-text"><span className="challenge-title"><strong><Sk w={px(i, 110, 60)} /></strong></span><span className="line muted"><Sk w={px(i, 190, 60)} /></span></div></div>) },
  { head: "Dates", cell: () => <Sk w={104} /> },
  { head: "Goal", cell: () => <Sk w={56} /> },
  { head: "Joined", className: "num", cell: () => <Sk w={32} /> },
  { head: "Pending", className: "num", cell: () => <Pill width={80} /> },
  { head: "Action", hidden: true, className: "right", cell: () => <SkeletonBlock w={132} h={36} r={6} /> },
];

const MEMBER_COLUMNS = (points: boolean): SkeletonColumn[] => [
  { head: "Name", cell: person },
  { head: "Role", cell: () => <Sk w={64} /> },
  { head: "Teams", cell: (i) => <Sk w={w(i, 40)} /> },
  { head: "Work location", cell: (i) => <Sk w={w(i, 40, 30)} /> },
  { head: "Status", cell: () => <Pill width={64} /> },
  ...(points ? [{ head: "Points", className: "right", cell: () => <Sk w={36} /> } as SkeletonColumn] : []),
];

const ROSTER_COLUMNS: SkeletonColumn[] = [
  { head: "Name", cell: person },
  { head: "Role", cell: () => <Sk w={64} /> },
  { head: "Teams", cell: (i) => <Sk w={w(i, 40)} /> },
  { head: "Status", cell: () => <Pill width={64} /> },
  { head: "Added", cell: () => <Sk w={90} /> },
  { head: "Actions", hidden: true, className: "right", cell: () => <span className="row-actions"><Button width={92} /></span> },
];

const AUDIT_COLUMNS: SkeletonColumn[] = [
  { head: "When", cellClass: "nowrap", cell: () => <Sk w={92} /> },
  { head: "Action", cell: () => <Pill width={96} /> },
  { head: "Who", cell: (i) => <span className="person"><SkeletonAvatar /><span><Sk w={px(i, 100, 50)} /></span></span> },
  { head: "What", cell: (i) => <><p><Sk w={w(i, 70, 26)} /></p><p className="muted"><Sk w={w(i + 4, 40)} /></p></> },
  { head: "Details", hidden: true, className: "right", cell: () => <Button width={36} /> },
];

const ATTENDEE_COLUMNS: SkeletonColumn[] = [
  { head: "Name", cell: person },
  { head: "Status", cell: () => <Pill width={72} /> },
  { head: "Actions", hidden: true, className: "right", cell: () => <span className="row-actions"><Button width={80} /><Button width={64} /></span> },
];

const IMPORT_COLUMNS: SkeletonColumn[] = [
  { head: "Row", cell: () => <Sk w={24} /> },
  { head: "Person", cell: person },
  { head: "Action", cell: () => <Pill width={72} /> },
  { head: "Changes", cell: (i) => <Sk w={w(i, 40, 40)} /> },
];

function QueueItems({ rows, bug = false }: { rows: number; bug?: boolean }) {
  return (
    <ul className="queue" aria-hidden>
      {range(rows).map((i) => (
        <li key={i}>
          <span className={`queue-item${bug ? " bug-item" : ""}`}>
            <SkeletonAvatar />
            <span className="queue-text">
              {bug && <span className="bug-meta"><Pill width={56} /><Pill width={64} /></span>}
              {bug ? <span className="bug-snippet"><Sk w={px(i, 170, 50)} /></span> : <strong><Sk w={px(i, 110, 50)} /></strong>}
              <span className="muted"><Sk w={px(i + 1, 150, 50)} /></span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ReviewDetailGhost({ bug = false }: { bug?: boolean }) {
  return (
    <article className="review-detail panel" aria-hidden>
      <div className="review-head">
        <div className="person big"><SkeletonAvatar size={40} /><div><h2><Sk w={160} /></h2><p className="muted"><Sk w={200} /></p></div></div>
        <div className="review-pills"><Pill width={76} /></div>
      </div>
      <span className="sk sk-block evidence" style={{ height: bug ? 240 : 320 }} />
      <div className="actions"><SkeletonBlock w={150} h={36} r={6} /><SkeletonBlock w={110} h={36} r={6} /></div>
    </article>
  );
}

function FormGhost({ sections = 3 }: { sections?: number }) {
  return (
    <div className="form-layout" aria-hidden>
      <div className="form">
        {range(sections).map((s) => (
          <section key={s} className="panel">
            <h2><Sk w={140} /></h2>
            <div className="field"><label><Sk w={90} /></label><InputGhost /></div>
            {s === 0 && <div className="field"><label><Sk w={110} /></label><SkeletonBlock w="100%" h={96} r={6} /></div>}
            <div className="field-row"><div className="field"><label><Sk w={80} /></label><InputGhost /></div><div className="field"><label><Sk w={80} /></label><InputGhost /></div></div>
          </section>
        ))}
        <div className="actions"><SkeletonBlock w={120} h={36} r={6} /><SkeletonBlock w={80} h={36} r={6} /></div>
      </div>
    </div>
  );
}

function IdeasGhost() {
  return (
    <div className="ideas" aria-hidden>
      <div className="ideas-head"><span /><SkeletonBlock w={190} h={25} r={999} /></div>
      <div className="ideas-layout">
        <div className="ideas-main">
          <ol className="stepper">{range(5).map((i) => <li key={i}><span className="stepper-item" data-state={i === 0 ? "current" : "todo"}><span className="stepper-n sk" /><span className="stepper-label"><Sk w={56} /></span></span></li>)}</ol>
          <SkeletonBlock w="100%" h={44} r={8} />
          <p className="muted"><Sk w={260} /></p>
          <section className="step-panel">
            <div className="step-head"><h2><Sk w={260} /></h2><span className="muted"><Sk w={120} /></span></div>
            <div className="opt-grid cols-4">
              {range(8).map((i) => (
                <div key={i} className="opt" data-art="true">
                  <span className="opt-body"><span className="opt-art sk" /><span className="opt-text"><span className="opt-name"><Sk w={w(i, 50, 30)} /></span><span className="opt-meta"><Sk w={w(i, 60, 30)} /></span></span></span>
                </div>
              ))}
            </div>
            <p className="muted"><Sk w={220} /></p>
            <div className="step-actions"><SkeletonBlock w={90} h={36} r={6} /></div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Layout({ name }: { name: SkeletonLayout }): ReactNode {
  switch (name) {
    case "events": return <><TabsGhost labels={["Upcoming", "Past", "Cancelled"]} /><SkeletonTable columns={EVENT_COLUMNS} rows={SKELETON_ROWS.events} tableClass="table responsive events-table" rowClass="event-row" /></>;
    case "themes": return <><TabsGhost labels={["Current", "Upcoming", "Past"]} /><SkeletonTable columns={THEME_COLUMNS} rows={SKELETON_ROWS.themes} tableClass="table responsive themes-table" /></>;
    case "challenges": return <SkeletonTable columns={CHALLENGE_COLUMNS} rows={SKELETON_ROWS.challenges} tableClass="table responsive challenges-table" rowClass="challenge-tr" />;
    case "review": return <div className="review-layout" aria-hidden><section className="queue-wrap"><QueueItems rows={SKELETON_ROWS.queue} /></section><ReviewDetailGhost /></div>;
    case "members": return <><CountLine /><SkeletonTable columns={MEMBER_COLUMNS(true)} rows={SKELETON_ROWS.members} /></>;
    case "memberDetail": return (
      <div className="detail-layout" aria-hidden>
        <section className="panel"><div className="person big"><SkeletonAvatar size={40} /><div><h2><Sk w={180} /></h2><p className="muted"><Sk w={220} /></p></div></div>
          <dl className="facts">{range(4).map((i) => <div key={i}><dt><Sk w={80} /></dt><dd><Sk w={w(i, 40)} /></dd></div>)}</dl></section>
        <section className="panel"><h2><Sk w={120} /></h2><div className="field"><label><Sk w={70} /></label><InputGhost /></div><div className="field"><label><Sk w={90} /></label><InputGhost /></div></section>
      </div>);
    case "roster": return <><CountLine /><SkeletonTable columns={ROSTER_COLUMNS} rows={SKELETON_ROWS.roster} /></>;
    case "importPreview": return <SkeletonTable columns={IMPORT_COLUMNS} rows={SKELETON_ROWS.importPreview} tableClass="table compact" />;
    case "bugs": return <div className="review-layout" aria-hidden><section className="queue-wrap bug-list"><QueueItems rows={SKELETON_ROWS.queue} bug /></section><div className="bug-detail-wrap"><ReviewDetailGhost bug /></div></div>;
    case "bugDetail": return <ReviewDetailGhost bug />;
    case "audit": return (
      <>
        <div className="filters" aria-hidden><SearchGhost /><div className="field"><label>Action</label><InputGhost /></div></div>
        <CountLine />
        <SkeletonTable columns={AUDIT_COLUMNS} rows={SKELETON_ROWS.audit} tableClass="table responsive audit-table" />
      </>);
    case "ideas": return <IdeasGhost />;
    case "suggestions": return (
      <div className="detail-layout" aria-hidden>
        <section className="panel"><h2><Sk w={200} /></h2><p><Sk w="70%" /></p><div className="actions"><SkeletonBlock w={140} h={36} r={6} /></div></section>
        <section className="panel"><h2><Sk w={160} /></h2>{range(3).map((i) => <SkeletonBlock key={i} w="100%" h={64} r={8} />)}</section>
      </div>);
    case "form": return <FormGhost />;
    case "attendees": return <><div className="filters" aria-hidden><SearchGhost /></div><CountLine /><SkeletonTable columns={ATTENDEE_COLUMNS} rows={SKELETON_ROWS.attendees} tableClass="table responsive" /></>;
    case "album": return <SkeletonCardGrid count={8} min={200} height={150} gap={12} />;
    case "overview": return null;
    default: return <div className="skeleton-list" aria-hidden>{range(3).map((i) => <SkeletonBlock key={i} w="100%" h={44} r={6} />)}</div>;
  }
}

/** The loading state of a page: the right layout inside the shared region (aria-busy, hidden status, delayed paint). */
export function PageSkeleton({ layout = "list", label }: { layout?: SkeletonLayout; label: string }) {
  if (layout === "overview") return <OverviewLoading />;
  return <SkeletonRegion label={label}><Layout name={layout} /></SkeletonRegion>;
}
