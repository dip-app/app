"use client";
// @i18n-migrated

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Dialog } from "@/components/Dialog";
import { Shell } from "@/components/Shell";
import { TableRegion } from "@/components/TableRegion";
import { toast, toastError } from "@/components/Toast";
import { Toggle } from "@/components/Toggle";
import { Avatar, Empty, Info, LoadError, Loading, ResultCount, SearchBox, formatDate } from "@/components/Ui";
import { describe, useLoad } from "@/components/useLoad";
import type { Attendee, Member } from "@/lib/adminTypes";
import { downloadText } from "@/lib/csv";
import { attendeesCsv } from "@/lib/exports";
import { classify, formatWhen } from "@/lib/contract";
import { useQueryState } from "@/lib/useQueryState";
import { useSlashFocus } from "@/lib/useSlashFocus";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { focusAfterClose } from "@/lib/focus";
import { Button, InlineNotice } from "@/components/kit";
import { t } from "@/lib/i18n";

const DEFAULTS = { q: "" };

function Attendees() {
  const eventId = useSearchParams().get("id") ?? "";
  const { api } = useApp();
  const event = useLoad((a) => a.getEvent(eventId), `e-${eventId}`);
  const attendees = useLoad((a) => a.listAttendees(eventId), `a-${eventId}`);
  const members = useLoad((a) => a.listMembers(), "members");
  const [qs, setQs] = useQueryState(DEFAULTS);
  const search = qs.q;
  useSlashFocus("attendee-search");
  const [pickerSearch, setPickerSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [candidate, setCandidate] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Attendee | null>(null);
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState("");
  // Optimistic attendance: the value each row should show while its request runs and until the server's list agrees.
  // Kept beside the data (not written into it), so a refresh that answers with an older list can't flip a row back.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const inFlight = useRef(0);
  const awaitingFinal = useRef(false);
  const wasRefreshing = useRef(false);
  // One requestId per add attempt: a retry after a lost response never adds twice.
  const requestId = useRef(crypto.randomUUID());

  const rows = useMemo(() => attendees.data?.map((row) => (row.memberId in pending ? { ...row, checkedIn: pending[row.memberId] } : row)) ?? null, [attendees.data, pending]);
  // Pending values are dropped when the server's list agrees, or once the refresh that follows the last request answers.
  useEffect(() => {
    // Only a refresh that succeeded replaces the pending values (after a failed one they stay, matching the toast).
    const finalAnswer = wasRefreshing.current && !attendees.refreshing && !attendees.refreshError && awaitingFinal.current && inFlight.current === 0;
    wasRefreshing.current = attendees.refreshing;
    if (finalAnswer) { awaitingFinal.current = false; setPending({}); return; }
    if (!attendees.data || Object.keys(pending).length === 0) return;
    const agreed = attendees.data.filter((row) => row.memberId in pending && row.checkedIn === pending[row.memberId] && !busyIds.has(row.memberId));
    if (agreed.length > 0) setPending((current) => { const next = { ...current }; for (const row of agreed) delete next[row.memberId]; return next; });
  }, [attendees.data, attendees.refreshing, attendees.refreshError, pending, busyIds]);
  const full = !!event.data && !!rows && rows.length >= event.data.capacity;
  const kind = event.data ? classify(event.data) : "upcoming";
  const ended = kind === "past";
  const started = !!event.data && Date.parse(event.data.startTime) <= Date.now();
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((a) => !q || `${a.name} ${a.email} ${a.department}`.toLowerCase().includes(q));
  }, [rows, search]);
  const candidates = useMemo(() => {
    const going = new Set((attendees.data ?? []).map((a) => a.memberId));
    const q = pickerSearch.trim().toLowerCase();
    return (members.data ?? []).filter((m) => m.status === "active" && !going.has(m.id) && (!q || `${m.displayName} ${m.email}`.toLowerCase().includes(q))).slice(0, 8);
  }, [members.data, attendees.data, pickerSearch]);

  const hold = useSkeletonGate((!attendees.data || !event.data) && !attendees.error && !event.error);
  if (attendees.error || event.error) return <AttendeesFrame><LoadError error={(attendees.error ?? event.error)!} onRetry={() => { attendees.reload(); event.reload(); }} backHref="/events/" backLabel={t("attendees.backToEvents")} /></AttendeesFrame>;
  if (!attendees.data || !rows || !event.data || hold) return <AttendeesFrame><Loading label={t("attendees.loading")} layout="attendees" /></AttendeesFrame>;
  const checkedIn = rows.filter((a) => a.checkedIn).length;

  /** Shows `checkedIn` on one row at once; `null` returns the row to what the server said (rollback). */
  function showCheckedIn(memberId: string, checkedIn: boolean | null) {
    setPending((current) => {
      const next = { ...current };
      if (checkedIn === null) delete next[memberId]; else next[memberId] = checkedIn;
      return next;
    });
  }
  function setBusy(memberId: string, on: boolean) {
    setBusyIds((current) => { const next = new Set(current); if (on) next.add(memberId); else next.delete(memberId); return next; });
  }
  /** One refresh after the last request in flight, so overlapping check-ins never refresh over each other. */
  function settle() {
    inFlight.current -= 1;
    if (inFlight.current === 0) { awaitingFinal.current = true; attendees.reload(); }
  }

  async function mark(attendee: Attendee, next: boolean) {
    setBusy(attendee.memberId, true);
    setError("");
    // The row changes at once; the toast waits for the server, which decides whether points were awarded.
    showCheckedIn(attendee.memberId, next);
    inFlight.current += 1;
    try {
      const { pointsAwarded } = await api.recordAttendance(eventId, attendee.memberId, next);
      const text = `${t(next ? "attendees.toast.checkedIn" : "attendees.toast.notCheckedIn", { name: attendee.name })}${pointsAwarded ? ` ${t("attendees.toast.pointsAwarded", { count: pointsAwarded })}` : ""}`;
      // Undo is offered only while it can work: once points were awarded the check-in is final.
      toast(text, next && pointsAwarded === 0 ? { action: { label: t("attendees.action.undo"), onClick: () => undoCheckIn(attendee) } } : {});
    } catch (failure) {
      showCheckedIn(attendee.memberId, null);
      setError(describe(failure));
    } finally {
      setBusy(attendee.memberId, false);
      settle();
    }
  }

  async function undoCheckIn(attendee: Attendee) {
    setBusy(attendee.memberId, true);
    showCheckedIn(attendee.memberId, false);
    inFlight.current += 1;
    try {
      await api.recordAttendance(eventId, attendee.memberId, false);
      toast(t("attendees.toast.undone", { name: attendee.name }));
    } catch (failure) {
      showCheckedIn(attendee.memberId, null);
      toastError(failure, t("common.actionFailed"));
    } finally {
      setBusy(attendee.memberId, false);
      settle();
    }
  }

  function exportCsv() {
    try {
      downloadText(`attendees-${eventId}.csv`, attendeesCsv(event.data!.title, rows!, ended));
      toast(t("attendees.toast.exported", { count: attendees.data!.length }));
    } catch {
      toast(t("attendees.toast.exportFailed"), { tone: "error" });
    }
  }

  const meta = (
    <>
      <span>{formatWhen(event.data.startTime, event.data.endTime)}</span>
      {event.data.venue.name && <span>{event.data.venue.name}</span>}
      <span><strong>{t("attendees.going", { count: attendees.data.length, capacity: event.data.capacity })}</strong>{full && kind === "upcoming" && <Info>{t("attendees.full")}</Info>}</span>
      {started ? <span>{t("attendees.checkedInCount", { count: checkedIn })}</span> : <span>{t("attendees.action.opensAtStart")}</span>}
    </>
  );
  const actions = (
    <>
      <Button onClick={exportCsv} disabled={attendees.data.length === 0}>{t("attendees.exportCsv")}</Button>
      {kind === "upcoming" && <Button variant="primary" onClick={() => { setAdding((v) => !v); setCandidate(null); }} aria-expanded={adding}>{t("attendees.addAttendee")}</Button>}
    </>
  );

  return (
    <AttendeesFrame title={event.data.title} meta={meta} actions={actions}>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}

      {adding && (
        <section className="panel" aria-label={t("attendees.add.panel")}>
          <h2>{t("attendees.add.heading")}</h2>
          {members.error ? <LoadError error={members.error} onRetry={members.reload} /> : (
            <>
              <SearchBox value={pickerSearch} onChange={setPickerSearch} label={t("attendees.add.searchLabel")} />
              <ul className="pick-list">
                {candidates.map((m) => (
                  <li key={m.id}>
                    <Avatar name={m.displayName} userId={m.id} photoURL={m.photoURL} avatarId={m.avatarId} />
                    <span className="grow"><strong>{m.displayName}</strong><span className="muted"> {m.email}</span></span>
                    <Button variant="primary" size="sm" onClick={() => { setCandidate(m); setNotify(true); }}>{t("attendees.add.button")}</Button>
                  </li>
                ))}
                {candidates.length === 0 && <li className="muted">{members.data ? t("attendees.add.noMatch") : t("attendees.add.loadingMembers")}</li>}
              </ul>
            </>
          )}
        </section>
      )}

      <SearchBox shortcut id="attendee-search" value={search} onChange={(v) => setQs({ q: v })} label={t("attendees.search.label")} placeholder={t("attendees.search.placeholder")} />
      {attendees.data.length === 0 ? (
        <Empty title={t("attendees.empty.title")} body={t("attendees.empty.body")} />
      ) : shown.length === 0 ? (
        <Empty title={t("attendees.noMatches.title")} body={t("attendees.noMatches.body")} />
      ) : (
        <>
        <ResultCount>{search.trim() ? t("attendees.count.matches", { shown: shown.length, total: attendees.data.length }) : t("attendees.count.total", { count: attendees.data.length })}</ResultCount>
        <TableRegion label={t("attendees.table.label", { title: event.data.title })}>
          <table className="table responsive person-table">
            <caption className="sr-only">{t("attendees.table.label", { title: event.data.title })}</caption>
            <thead><tr><th scope="col">{t("attendees.table.name")}</th><th scope="col">{t("attendees.table.department")}</th><th scope="col">{t("attendees.table.rsvp")}</th><th scope="col">{t("attendees.table.attendance")}</th><th scope="col"><span className="sr-only">{t("attendees.table.actions")}</span></th></tr></thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.memberId} data-member={a.memberId}>
                  <th scope="row"><span className="person"><Avatar name={a.name} userId={a.memberId} photoURL={a.photoURL} avatarId={a.avatarId} /><span><strong>{a.name}</strong><br /><span className="muted">{a.email}</span>
                    <span className="person-sub">{[a.department, a.jobTitle, t("attendees.sub.rsvp", { date: formatDate(a.rsvpAt) })].filter(Boolean).join(" · ")}</span></span></span></th>
                  <td className="phone-hide" data-label={t("attendees.table.department")}>{a.department}<br /><span className="muted">{a.jobTitle}</span></td>
                  <td className="phone-hide nowrap" data-label={t("attendees.table.rsvp")}>{formatDate(a.rsvpAt)}{a.addedByAdmin && <><br /><Info>{t("attendees.table.addedByStaff")}</Info></>}</td>
                  <td data-label={t("attendees.table.attendance")}>
                    <span className="attendance">
                      {a.checkedIn || ended
                        ? <Info tone={a.checkedIn ? "ok" : "warn"}>{t(a.checkedIn ? "attendees.status.checkedIn" : "attendees.status.noShow")}</Info>
                        : <span className="status-plain">{t("attendees.status.notCheckedIn")}</span>}
                      {(started || a.checkedIn) && (
                        <Button size="sm" loading={busyIds.has(a.memberId)} onClick={() => void mark(a, !a.checkedIn)}
                          aria-label={t(a.checkedIn ? "attendees.action.undoCheckInFor" : "attendees.action.checkInFor", { name: a.name })}>{a.checkedIn ? t("attendees.action.undo") : t("attendees.action.checkIn")}</Button>
                      )}
                    </span>
                  </td>
                  <td className="right"><Button size="sm" className="quiet-danger" onClick={() => { setRemoving(a); setNotify(true); }} aria-label={t("attendees.action.removeNamed", { name: a.name })}>{t("attendees.action.remove")}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
        </>
      )}

      {candidate && (
        <Dialog
          title={t("attendees.addDialog.title", { name: candidate.displayName })}
          confirmLabel={t("attendees.addDialog.confirm")} busyLabel={t("attendees.addDialog.busy")}
          reasonLabel={full ? t("attendees.addDialog.reason") : undefined}
          onClose={() => setCandidate(null)}
          onConfirm={async (reason) => {
            await api.addAttendee({ eventId, memberId: candidate.id, requestId: requestId.current, ...(full ? { capacityOverrideReason: reason } : {}), notify });
            requestId.current = crypto.randomUUID();
            setCandidate(null);
            toast(t("attendees.toast.nowGoing", { name: candidate.displayName }));
            attendees.reload();
            event.reload();
          }}
        >
          <p>{t("attendees.addDialog.body")}</p>
          {full && <InlineNotice>{t("attendees.addDialog.full", { capacity: event.data.capacity })}</InlineNotice>}
          <Toggle checked={notify} onChange={setNotify} label={t("attendees.notify.label")} hint={t("attendees.notify.addedHint")} />
        </Dialog>
      )}
      {removing && (
        <Dialog
          danger
          title={t("attendees.removeDialog.title", { name: removing.name })}
          confirmLabel={t("attendees.removeDialog.confirm")} busyLabel={t("attendees.removeDialog.busy")}
          reasonLabel={t("attendees.removeDialog.reason")}
          onClose={() => setRemoving(null)}
          onConfirm={async (reason) => {
            await api.removeAttendee(eventId, removing.memberId, notify, reason);
            // The row leaves at once and focus moves to the next row's Remove (or the search box), not to the page.
            const at = shown.findIndex((row) => row.memberId === removing.memberId);
            const nextRow = shown[at + 1] ?? shown[at - 1];
            attendees.setData((attendees.data ?? []).filter((row) => row.memberId !== removing.memberId));
            setRemoving(null);
            focusAfterClose(nextRow ? `tr[data-member="${CSS.escape(nextRow.memberId)}"] .quiet-danger` : "#attendee-search");
            toast(t("attendees.toast.removed", { name: removing.name }));
            attendees.reload();
            event.reload();
          }}
        >
          <p>{t("attendees.removeDialog.body")}</p>
          <Toggle checked={notify} onChange={setNotify} label={t("attendees.notify.label")} hint={t("attendees.notify.removedHint")} />
        </Dialog>
      )}
    </AttendeesFrame>
  );
}

/** The page frame: "Attendees" over the event's name once it is known, a back link to Events, the event's facts. */
function AttendeesFrame({ title, meta, actions, children }: { title?: string; meta?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Shell title={title ?? t("attendees.title")} eyebrow={title ? t("attendees.title") : undefined} subtitle={title ? undefined : t("attendees.subtitle")}
      back={{ href: "/events/", label: t("shell.nav.events") }} meta={meta} action={actions} requires="attendees.manage">
      {children}
    </Shell>
  );
}

export default function AttendeesPage() {
  return <Suspense fallback={<AttendeesFrame><Loading label={t("attendees.loading")} layout="attendees" /></AttendeesFrame>}><Attendees /></Suspense>;
}
