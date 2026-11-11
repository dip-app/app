"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Dialog } from "@/components/Dialog";
import { Shell } from "@/components/Shell";
import { Toggle } from "@/components/Toggle";
import { Avatar, Empty, Info, LoadError, Loading, Notice, SearchBox, formatDate } from "@/components/Ui";
import { describe, useLoad } from "@/components/useLoad";
import type { Attendance, Attendee, Member } from "@/lib/adminTypes";
import { downloadText } from "@/lib/csv";
import { ATTENDANCE_LABEL, attendeesCsv } from "@/lib/exports";
import { classify } from "@/lib/contract";

function Attendees() {
  const eventId = useSearchParams().get("id") ?? "";
  const { api } = useApp();
  const event = useLoad((a) => a.getEvent(eventId), `e-${eventId}`);
  const attendees = useLoad((a) => a.listAttendees(eventId), `a-${eventId}`);
  const members = useLoad((a) => a.listMembers(), "members");
  const [search, setSearch] = useState("");
  const [pickerSearch, setPickerSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [candidate, setCandidate] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Attendee | null>(null);
  const [notify, setNotify] = useState(true);
  const [override, setOverride] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  // One requestId per add attempt: a retry after a lost response never adds twice.
  const requestId = useRef(crypto.randomUUID());

  const full = !!event.data && !!attendees.data && attendees.data.length >= event.data.capacity;
  const kind = event.data ? classify(event.data) : "upcoming";
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (attendees.data ?? []).filter((a) => !q || `${a.name} ${a.email} ${a.department}`.toLowerCase().includes(q));
  }, [attendees.data, search]);
  const candidates = useMemo(() => {
    const going = new Set((attendees.data ?? []).map((a) => a.memberId));
    const q = pickerSearch.trim().toLowerCase();
    return (members.data ?? []).filter((m) => m.status === "active" && !going.has(m.id) && (!q || `${m.displayName} ${m.email}`.toLowerCase().includes(q))).slice(0, 8);
  }, [members.data, attendees.data, pickerSearch]);

  if (attendees.error || event.error) return <LoadError error={(attendees.error ?? event.error)!} onRetry={() => { attendees.reload(); event.reload(); }} />;
  if (!attendees.data || !event.data) return <Loading label="Loading attendees" />;
  const checkedIn = attendees.data.filter((a) => a.attendance === "checkedIn").length;

  async function mark(attendee: Attendee, attendance: Attendance) {
    setBusyId(attendee.memberId);
    setError("");
    try {
      const { pointsAwarded } = await api.setAttendance(eventId, attendee.memberId, attendance);
      setMessage(`${attendee.name}: ${ATTENDANCE_LABEL[attendance].toLowerCase()}.${pointsAwarded ? ` ${pointsAwarded} points awarded.` : ""}`);
      attendees.reload();
    } catch (failure) {
      setError(describe(failure));
    } finally {
      setBusyId("");
    }
  }

  return (
    <>
      <div className="toolbar">
        <Link className="pill-btn gray" href="/events/">All events</Link>
        <Info>{attendees.data.length} of {event.data.capacity} going</Info>
        <Info>{checkedIn} checked in</Info>
        <span className="spacer" />
        <button className="pill-btn gray" onClick={() => downloadText(`attendees-${eventId}.csv`, attendeesCsv(event.data!.title, attendees.data!))} disabled={attendees.data.length === 0}>Export CSV</button>
        {kind !== "cancelled" && <button className="pill-btn purple" onClick={() => { setAdding((v) => !v); setCandidate(null); }} aria-expanded={adding}>Add attendee</button>}
      </div>
      {message && <Notice>{message}</Notice>}
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
                    <button className="pill-btn dark small" onClick={() => { setCandidate(m); setNotify(true); setOverride(false); }}>Add</button>
                  </li>
                ))}
                {candidates.length === 0 && <li className="muted">{members.data ? "No active members match." : "Loading members…"}</li>}
              </ul>
            </>
          )}
        </section>
      )}

      <SearchBox value={search} onChange={setSearch} label="Search attendees" />
      {attendees.data.length === 0 ? (
        <Empty title="Nobody is going yet" body="Add members yourself, or they can join from the app." />
      ) : shown.length === 0 ? (
        <Empty title="No matches" body="Try a different name, email or department." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Attendees for {event.data.title}</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Department</th><th scope="col">RSVP</th><th scope="col">Attendance</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.memberId}>
                  <td><span className="person"><Avatar name={a.name} /><span><strong>{a.name}</strong><br /><span className="muted">{a.email}</span></span></span></td>
                  <td>{a.department}<br /><span className="muted">{a.jobTitle}</span></td>
                  <td>{formatDate(a.rsvpAt)}{a.addedByAdmin && <><br /><Info>Added by staff</Info></>}</td>
                  <td>
                    <div className="segmented" role="group" aria-label={`Attendance for ${a.name}`}>
                      {(["checkedIn", "noShow"] as const).map((state) => (
                        <button key={state} className="seg" aria-pressed={a.attendance === state} disabled={busyId === a.memberId}
                          onClick={() => void mark(a, a.attendance === state ? "unmarked" : state)}>{state === "checkedIn" ? "Checked in" : "No-show"}</button>
                      ))}
                    </div>
                  </td>
                  <td className="right"><button className="pill-btn gray small" onClick={() => { setRemoving(a); setNotify(true); }} aria-label={`Remove ${a.name}`}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {candidate && (
        <Dialog
          title={`Add ${candidate.displayName}?`}
          confirmLabel="Add as going"
          reasonLabel={override || full ? "Why is the event going over capacity?" : undefined}
          onClose={() => setCandidate(null)}
          onConfirm={async (reason) => {
            await api.addAttendee({ eventId, memberId: candidate.id, requestId: requestId.current, overrideCapacity: full || override, reason: reason || undefined, notify });
            requestId.current = crypto.randomUUID();
            setCandidate(null);
            setMessage(`${candidate.displayName} is now going.`);
            attendees.reload();
            event.reload();
          }}
        >
          <p>They are marked as going and get the event’s default notifications.</p>
          {full && <p className="notice">The event is full ({event.data.capacity} places). Adding them goes over capacity and needs a reason.</p>}
          <Toggle checked={notify} onChange={setNotify} label="Tell them" hint="Sends a notification that they were added." />
        </Dialog>
      )}
      {removing && (
        <Dialog
          danger
          title={`Remove ${removing.name}?`}
          confirmLabel="Remove from event"
          reasonLabel="Why is this person being removed?"
          onClose={() => setRemoving(null)}
          onConfirm={async (reason) => {
            await api.removeAttendee(eventId, removing.memberId, notify, reason);
            setRemoving(null);
            setMessage(`${removing.name} was removed.`);
            attendees.reload();
            event.reload();
          }}
        >
          <p>Their RSVP is cancelled and the going count drops by one.</p>
          <Toggle checked={notify} onChange={setNotify} label="Tell them" hint="Sends a notification that they were removed." />
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
