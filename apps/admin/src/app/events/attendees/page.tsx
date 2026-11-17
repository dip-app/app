"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Dialog } from "@/components/Dialog";
import { Shell } from "@/components/Shell";
import { TableRegion } from "@/components/TableRegion";
import { toast } from "@/components/Toast";
import { Toggle } from "@/components/Toggle";
import { Avatar, Empty, Info, LoadError, Loading, ResultCount, SearchBox, formatDate } from "@/components/Ui";
import { describe, useLoad } from "@/components/useLoad";
import type { Attendee, Member } from "@/lib/adminTypes";
import { downloadText } from "@/lib/csv";
import { attendanceLabel, attendeesCsv } from "@/lib/exports";
import { classify } from "@/lib/contract";
import { useQueryState } from "@/lib/useQueryState";
import { useSlashFocus } from "@/lib/useSlashFocus";

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

  if (attendees.error || event.error) return <LoadError error={(attendees.error ?? event.error)!} onRetry={() => { attendees.reload(); event.reload(); }} backHref="/events/" backLabel="Back to events" />;
  if (!attendees.data || !event.data) return <Loading label="Loading attendees" />;
  const checkedIn = attendees.data.filter((a) => a.checkedIn).length;

  async function mark(attendee: Attendee, next: boolean) {
    setBusyId(attendee.memberId);
    setError("");
    try {
      const { pointsAwarded } = await api.recordAttendance(eventId, attendee.memberId, next);
      const text = `${attendee.name}: ${next ? "checked in" : "marked as not checked in"}.${pointsAwarded ? ` ${pointsAwarded} points awarded.` : ""}`;
      // Undo is offered only while it can work: once points were awarded the check-in is final.
      toast(text, next && pointsAwarded === 0 ? { action: { label: "Undo", onClick: () => undoCheckIn(attendee) } } : {});
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
      toast(`Check-in undone for ${attendee.name}.`);
      attendees.reload();
    } catch (failure) {
      toast(describe(failure), { tone: "error" });
    }
  }

  function exportCsv() {
    try {
      downloadText(`attendees-${eventId}.csv`, attendeesCsv(event.data!.title, attendees.data!, ended));
      toast(`Exported ${attendees.data!.length} ${attendees.data!.length === 1 ? "attendee" : "attendees"}.`);
    } catch {
      toast("The export didn’t finish. Try again.", { tone: "error" });
    }
  }

  return (
    <>
      <div className="toolbar">
        <Link className="pill-btn gray" href="/events/">All events</Link>
        <Info>{attendees.data.length} of {event.data.capacity} going</Info>
        <Info>{checkedIn} checked in</Info>
        <span className="spacer" />
        <button className="pill-btn gray" onClick={exportCsv} disabled={attendees.data.length === 0}>Export CSV</button>
        {kind === "upcoming" && <button className="pill-btn purple" onClick={() => { setAdding((v) => !v); setCandidate(null); }} aria-expanded={adding}>Add attendee</button>}
      </div>
      {error && <div className="banner error" role="alert"><span>{error}</span></div>}

      {adding && (
        <section className="panel" aria-label="Add attendee">
          <h2>Add a member as going</h2>
          {members.error ? <LoadError error={members.error} onRetry={members.reload} /> : (
            <>
              <SearchBox value={pickerSearch} onChange={setPickerSearch} label="Search members by name or email" />
              <ul className="pick-list">
                {candidates.map((m) => (
                  <li key={m.id}>
                    <Avatar name={m.displayName} />
                    <span className="grow"><strong>{m.displayName}</strong><span className="muted"> {m.email}</span></span>
                    <button className="pill-btn dark small" onClick={() => { setCandidate(m); setNotify(true); }}>Add</button>
                  </li>
                ))}
                {candidates.length === 0 && <li className="muted">{members.data ? "No active members match." : "Loading members…"}</li>}
              </ul>
            </>
          )}
        </section>
      )}

      <SearchBox id="attendee-search" value={search} onChange={(v) => setQs({ q: v })} label="Search attendees" placeholder="Search attendees (press / to focus)" />
      {attendees.data.length === 0 ? (
        <Empty title="Nobody is going yet" body="Add members yourself, or they can join from the app." />
      ) : shown.length === 0 ? (
        <Empty title="No matches" body="Try a different name, email or department." />
      ) : (
        <>
        <ResultCount>{search.trim() ? `${shown.length} of ${attendees.data.length} attendees match` : `${attendees.data.length} ${attendees.data.length === 1 ? "attendee" : "attendees"}`}</ResultCount>
        <TableRegion label={`Attendees for ${event.data.title}`}>
          <table className="table responsive">
            <caption className="sr-only">Attendees for {event.data.title}</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Department</th><th scope="col">RSVP</th><th scope="col">Attendance</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.memberId}>
                  <th scope="row"><span className="person"><Avatar name={a.name} /><span><strong>{a.name}</strong><br /><span className="muted">{a.email}</span></span></span></th>
                  <td data-label="Department">{a.department}<br /><span className="muted">{a.jobTitle}</span></td>
                  <td data-label="RSVP">{formatDate(a.rsvpAt)}{a.addedByAdmin && <><br /><Info>Added by staff</Info></>}</td>
                  <td data-label="Attendance">
                    <span className="attendance">
                      <Info tone={a.checkedIn ? "ok" : ended ? "warn" : undefined}>{attendanceLabel(a.checkedIn, ended)}</Info>
                      <button className={`pill-btn small ${a.checkedIn ? "gray" : "dark"}`} disabled={busyId === a.memberId || (!started && !a.checkedIn)}
                        title={!started ? "Attendance opens when the event starts" : undefined} onClick={() => void mark(a, !a.checkedIn)}
                        aria-label={`${a.checkedIn ? "Undo check-in for" : "Check in"} ${a.name}`}>{a.checkedIn ? "Undo" : "Check in"}</button>
                    </span>
                  </td>
                  <td className="right"><button className="pill-btn gray small quiet-danger" onClick={() => { setRemoving(a); setNotify(true); }} aria-label={`Remove ${a.name}`}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
        </>
      )}

      {candidate && (
        <Dialog
          title={`Add ${candidate.displayName}?`}
          confirmLabel="Add as going" busyLabel="Adding…"
          reasonLabel={full ? "Why is the event going over capacity?" : undefined}
          onClose={() => setCandidate(null)}
          onConfirm={async (reason) => {
            await api.addAttendee({ eventId, memberId: candidate.id, requestId: requestId.current, ...(full ? { capacityOverrideReason: reason } : {}), notify });
            requestId.current = crypto.randomUUID();
            setCandidate(null);
            toast(`${candidate.displayName} is now going.`);
            attendees.reload();
            event.reload();
          }}
        >
          <p>They are marked as going and get the event’s default notifications.</p>
          {full && <p className="notice">The event is full ({event.data.capacity} places). Adding them raises the capacity by one and needs a reason.</p>}
          <Toggle checked={notify} onChange={setNotify} label="Notify them" hint="Sends a notification that they were added." />
        </Dialog>
      )}
      {removing && (
        <Dialog
          danger
          title={`Remove ${removing.name}?`}
          confirmLabel="Remove from event" busyLabel="Removing…"
          reasonLabel="Why is this person being removed?"
          onClose={() => setRemoving(null)}
          onConfirm={async (reason) => {
            await api.removeAttendee(eventId, removing.memberId, notify, reason);
            setRemoving(null);
            toast(`${removing.name} was removed from the event.`);
            attendees.reload();
            event.reload();
          }}
        >
          <p>Their RSVP is canceled and the going count drops by one. Attendance already recorded is kept.</p>
          <Toggle checked={notify} onChange={setNotify} label="Notify them" hint="Sends a notification that they were removed." />
        </Dialog>
      )}
    </>
  );
}

export default function AttendeesPage() {
  return (
    <Shell title="Attendees" subtitle="Who is going, who showed up. Changes are recorded in the audit log." requires="attendees.manage">
      <Suspense fallback={<Loading label="Loading attendees" />}><Attendees /></Suspense>
    </Shell>
  );
}
