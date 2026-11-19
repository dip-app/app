"use client";
// @i18n-migrated

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useRef, useState } from "react";
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
import { classify } from "@/lib/contract";
import { useQueryState } from "@/lib/useQueryState";
import { useSlashFocus } from "@/lib/useSlashFocus";
import { useSkeletonGate } from "@/components/useDelayedShow";
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
  const [busyId, setBusyId] = useState("");
  // One requestId per add attempt: a retry after a lost response never adds twice.
  const requestId = useRef(crypto.randomUUID());

  const full = !!event.data && !!attendees.data && attendees.data.length >= event.data.capacity;
  const kind = event.data ? classify(event.data) : "upcoming";
  const ended = kind === "past";
  const started = !!event.data && Date.parse(event.data.startTime) <= Date.now();
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (attendees.data ?? []).filter((a) => !q || `${a.name} ${a.email} ${a.department}`.toLowerCase().includes(q));
  }, [attendees.data, search]);
  const candidates = useMemo(() => {
    const going = new Set((attendees.data ?? []).map((a) => a.memberId));
    const q = pickerSearch.trim().toLowerCase();
    return (members.data ?? []).filter((m) => m.status === "active" && !going.has(m.id) && (!q || `${m.displayName} ${m.email}`.toLowerCase().includes(q))).slice(0, 8);
  }, [members.data, attendees.data, pickerSearch]);

  const hold = useSkeletonGate((!attendees.data || !event.data) && !attendees.error && !event.error);
  if (attendees.error || event.error) return <LoadError error={(attendees.error ?? event.error)!} onRetry={() => { attendees.reload(); event.reload(); }} backHref="/events/" backLabel={t("attendees.backToEvents")} />;
  if (!attendees.data || !event.data || hold) return <Loading label={t("attendees.loading")} layout="attendees" />;
  const checkedIn = attendees.data.filter((a) => a.checkedIn).length;

  async function mark(attendee: Attendee, next: boolean) {
    setBusyId(attendee.memberId);
    setError("");
    try {
      const { pointsAwarded } = await api.recordAttendance(eventId, attendee.memberId, next);
      const text = `${t(next ? "attendees.toast.checkedIn" : "attendees.toast.notCheckedIn", { name: attendee.name })}${pointsAwarded ? ` ${t("attendees.toast.pointsAwarded", { count: pointsAwarded })}` : ""}`;
      // Undo is offered only while it can work: once points were awarded the check-in is final.
      toast(text, next && pointsAwarded === 0 ? { action: { label: t("attendees.action.undo"), onClick: () => undoCheckIn(attendee) } } : {});
      attendees.reload();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusyId("");
    }
  }

  async function undoCheckIn(attendee: Attendee) {
    try {
      await api.recordAttendance(eventId, attendee.memberId, false);
      toast(t("attendees.toast.undone", { name: attendee.name }));
      attendees.reload();
    } catch (failure) {
      toastError(failure, t("common.actionFailed"));
    }
  }

  function exportCsv() {
    try {
      downloadText(`attendees-${eventId}.csv`, attendeesCsv(event.data!.title, attendees.data!, ended));
      toast(t("attendees.toast.exported", { count: attendees.data!.length }));
    } catch {
      toast(t("attendees.toast.exportFailed"), { tone: "error" });
    }
  }

  return (
    <>
      <div className="toolbar">
        <Button href="/events/">{t("attendees.allEvents")}</Button>
        <Info>{t("attendees.going", { count: attendees.data.length, capacity: event.data.capacity })}</Info>
        <Info>{t("attendees.checkedInCount", { count: checkedIn })}</Info>
        <span className="spacer" />
        <Button onClick={exportCsv} disabled={attendees.data.length === 0}>{t("attendees.exportCsv")}</Button>
        {kind === "upcoming" && <Button variant="primary" onClick={() => { setAdding((v) => !v); setCandidate(null); }} aria-expanded={adding}>{t("attendees.addAttendee")}</Button>}
      </div>
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

      <SearchBox id="attendee-search" value={search} onChange={(v) => setQs({ q: v })} label={t("attendees.search.label")} placeholder={t("attendees.search.placeholder")} />
      {attendees.data.length === 0 ? (
        <Empty title={t("attendees.empty.title")} body={t("attendees.empty.body")} />
      ) : shown.length === 0 ? (
        <Empty title={t("attendees.noMatches.title")} body={t("attendees.noMatches.body")} />
      ) : (
        <>
        <ResultCount>{search.trim() ? t("attendees.count.matches", { shown: shown.length, total: attendees.data.length }) : t("attendees.count.total", { count: attendees.data.length })}</ResultCount>
        <TableRegion label={t("attendees.table.label", { title: event.data.title })}>
          <table className="table responsive">
            <caption className="sr-only">{t("attendees.table.label", { title: event.data.title })}</caption>
            <thead><tr><th scope="col">{t("attendees.table.name")}</th><th scope="col">{t("attendees.table.department")}</th><th scope="col">{t("attendees.table.rsvp")}</th><th scope="col">{t("attendees.table.attendance")}</th><th scope="col"><span className="sr-only">{t("attendees.table.actions")}</span></th></tr></thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.memberId}>
                  <th scope="row"><span className="person"><Avatar name={a.name} userId={a.memberId} photoURL={a.photoURL} avatarId={a.avatarId} /><span><strong>{a.name}</strong><br /><span className="muted">{a.email}</span></span></span></th>
                  <td data-label={t("attendees.table.department")}>{a.department}<br /><span className="muted">{a.jobTitle}</span></td>
                  <td data-label={t("attendees.table.rsvp")}>{formatDate(a.rsvpAt)}{a.addedByAdmin && <><br /><Info>{t("attendees.table.addedByStaff")}</Info></>}</td>
                  <td data-label={t("attendees.table.attendance")}>
                    <span className="attendance">
                      <Info tone={a.checkedIn ? "ok" : ended ? "warn" : undefined}>{t(a.checkedIn ? "attendees.status.checkedIn" : ended ? "attendees.status.noShow" : "attendees.status.notCheckedIn")}</Info>
                      <Button size="sm" variant={a.checkedIn ? "outline" : "primary"} disabled={busyId === a.memberId || (!started && !a.checkedIn)}
                        title={!started ? t("attendees.action.opensAtStart") : undefined} onClick={() => void mark(a, !a.checkedIn)}
                        aria-label={t(a.checkedIn ? "attendees.action.undoCheckInFor" : "attendees.action.checkInFor", { name: a.name })}>{a.checkedIn ? t("attendees.action.undo") : t("attendees.action.checkIn")}</Button>
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
            setRemoving(null);
            toast(t("attendees.toast.removed", { name: removing.name }));
            attendees.reload();
            event.reload();
          }}
        >
          <p>{t("attendees.removeDialog.body")}</p>
          <Toggle checked={notify} onChange={setNotify} label={t("attendees.notify.label")} hint={t("attendees.notify.removedHint")} />
        </Dialog>
      )}
    </>
  );
}

export default function AttendeesPage() {
  return (
    <Shell title={t("attendees.title")} subtitle={t("attendees.subtitle")} requires="attendees.manage">
      <Suspense fallback={<Loading label={t("attendees.loading")} layout="attendees" />}><Attendees /></Suspense>
    </Shell>
  );
}
