"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Dialog } from "@/components/Dialog";
import { Shell } from "@/components/Shell";
import { Avatar, Info, LoadError, Loading, Notice, formatDate } from "@/components/Ui";
import { describe, useLoad } from "@/components/useLoad";
import type { Session } from "@/lib/api";
import { type Member, type MemberPatch, ROLE_LABEL, type Role, can } from "@/lib/adminTypes";
import { ApiError } from "@/lib/contract";

type Action = "deactivate" | "reactivate" | "reset" | "points" | null;

function MemberDetail() {
  const id = useSearchParams().get("id") ?? "";
  const { api, session } = useApp();
  const member = useLoad((a) => a.getMember(id), id);
  const company = useLoad((a) => a.companyInfo(), "company");
  if (member.error) return <LoadError error={member.error} onRetry={member.reload} />;
  if (!member.data || !company.data) return <Loading label="Loading member" />;
  return <Editor key={`${member.data.id}-${member.data.revision}`} member={member.data} teams={company.data.teams} self={session?.uid === member.data.id} session={session}
    api={api} onSaved={(next) => member.setData(next)} onReload={member.reload} />;
}

function Editor({ member, teams, self, session, api, onSaved, onReload }: {
  member: Member; teams: { id: string; name: string }[]; self: boolean; session: Session | null; api: ReturnType<typeof useApp>["api"];
  onSaved: (next: Member) => void; onReload: () => void;
}) {
  const [draft, setDraft] = useState<Required<MemberPatch>>({
    role: member.role, teamIds: member.teamIds, workLocation: member.workLocation, department: member.department, jobTitle: member.jobTitle,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState("");
  const [action, setAction] = useState<Action>(null);
  const [delta, setDelta] = useState("");
  const [resetPoints, setResetPoints] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const editable = can(session?.role, "members.edit");

  const dirty = draft.role !== member.role || draft.workLocation !== member.workLocation || draft.department !== member.department ||
    draft.jobTitle !== member.jobTitle || draft.teamIds.join() !== member.teamIds.join();
  const deltaValue = Number(delta);
  const deltaValid = Number.isInteger(deltaValue) && deltaValue !== 0;
  const set = <K extends keyof MemberPatch>(key: K, value: Required<MemberPatch>[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const toggleTeam = (teamId: string) => set("teamIds", draft.teamIds.includes(teamId) ? draft.teamIds.filter((t) => t !== teamId) : [...draft.teamIds, teamId]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.updateMember(member.id, member.revision, draft));
      setMessage("Saved.");
    } catch (failure) {
      setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", describe(failure)));
    } finally {
      setSaving(false);
    }
  }
  const done = (next: Member, text: string) => { setAction(null); setMessage(text); onSaved(next); };
  const fieldError = (name: string) => error?.fields[name];

  return (
    <>
      <div className="toolbar">
        <Link className="pill-btn gray" href="/members/">All members</Link>
        <Info tone={member.status === "active" ? "ok" : "warn"}>{member.status === "active" ? "Active" : member.status === "invited" ? "Invited" : "Deactivated"}</Info>
        <span className="muted">Joined {formatDate(member.createdAt)}</span>
      </div>
      {message && <Notice>{message}</Notice>}
      {error && (
        <div className="banner error" role="alert">
          <span>{error.message}</span>
          {error.code === "aborted" && <button className="pill-btn" onClick={onReload}>Reload latest</button>}
        </div>
      )}

      <div className="detail-layout">
        <section className="panel" aria-labelledby="who">
          <div className="person big"><Avatar name={member.displayName} /><div><h2 id="who">{member.displayName}</h2><p className="muted">{member.email}</p></div></div>
          <fieldset className="bare" disabled={!editable}>
          <div className="form single">
            <div className="field"><label htmlFor="m-role">Role</label>
              <select id="m-role" value={draft.role} onChange={(e) => set("role", e.target.value as Role)} aria-invalid={!!fieldError("role")} disabled={self || !editable}>
                {(["member", "organizer", "admin"] as const).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <span className="hint">{self ? "You can’t change your own role." : "Organizers manage events, themes, albums and attendees. Admins also manage people and imports."}</span>
              {fieldError("role") && <span className="error">{fieldError("role")}</span>}
            </div>
            <fieldset className="field"><legend>Teams</legend>
              <div className="chips">{teams.map((t) => <button type="button" key={t.id} className="chip" aria-pressed={draft.teamIds.includes(t.id)} onClick={() => toggleTeam(t.id)}>{t.name}</button>)}</div>
            </fieldset>
            <div className="row">
              <div className="field"><label htmlFor="m-loc">Work location</label><input id="m-loc" value={draft.workLocation} maxLength={80} onChange={(e) => set("workLocation", e.target.value)} /></div>
              <div className="field"><label htmlFor="m-dep">Department</label><input id="m-dep" value={draft.department} maxLength={80} onChange={(e) => set("department", e.target.value)} /></div>
            </div>
            <div className="field"><label htmlFor="m-job">Job title</label><input id="m-job" value={draft.jobTitle} maxLength={80} onChange={(e) => set("jobTitle", e.target.value)} /></div>
          </div>
          </fieldset>
          {!editable && <p className="notice">Read-only. Only admins can change people.</p>}
          {editable && <div className="actions">
            <button className="pill-btn purple" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save changes"}</button>
            <button className="pill-btn gray" disabled={!dirty || saving} onClick={() => setDraft({ role: member.role, teamIds: member.teamIds, workLocation: member.workLocation, department: member.department, jobTitle: member.jobTitle })}>Discard</button>
          </div>}
        </section>

        {editable && <aside className="stack">
          <section className="panel" aria-labelledby="access">
            <h2 id="access">Access</h2>
            {member.status === "deactivated"
              ? <><p className="muted">Deactivated. They can’t sign in and are hidden from events and feeds.</p><button className="pill-btn dark" onClick={() => setAction("reactivate")}>Reactivate</button></>
              : <><p className="muted">Deactivating blocks sign-in and removes them from upcoming events. Their history and points stay.</p><button className="pill-btn danger" disabled={self} onClick={() => setAction("deactivate")}>Deactivate</button>{self && <p className="hint">You can’t deactivate yourself.</p>}</>}
          </section>
          <section className="panel" aria-labelledby="pts">
            <h2 id="pts">Points</h2>
            <p className="big-number">{member.pointsBalance ?? 0}</p>
            <button className="pill-btn dark" onClick={() => { setDelta(""); setResetPoints(false); setAction("points"); }}>Adjust or reset</button>
          </section>
          <section className="panel" aria-labelledby="prof">
            <h2 id="prof">Participant profile</h2>
            <dl className="facts">
              <div><dt>Avatar</dt><dd>{member.avatarId ? "Chosen" : "Default"}</dd></div>
              <div><dt>City</dt><dd>{member.city || "Not set"}</dd></div>
            </dl>
            <p className="muted">Clears what they set themselves: photo, avatar, city, interests, travel radius, availability and favorites. Identity, role, teams and points stay.</p>
            <button className="pill-btn danger" onClick={() => setAction("reset")}>Reset profile</button>
          </section>
        </aside>}
      </div>

      {action === "deactivate" && (
        <Dialog danger title={`Deactivate ${member.displayName}?`} confirmLabel="Deactivate" reasonLabel="Why are you deactivating them?" onClose={() => setAction(null)}
          onConfirm={async (reason) => done(await api.setMemberStatus(member.id, "deactivated", reason), "Deactivated. They can no longer sign in.")}>
          <p>They are signed out of DIP and removed from upcoming events. You can reactivate them later.</p>
        </Dialog>
      )}
      {action === "reactivate" && (
        <Dialog title={`Reactivate ${member.displayName}?`} confirmLabel="Reactivate" reasonLabel="Why are you reactivating them?" onClose={() => setAction(null)}
          onConfirm={async (reason) => done(await api.setMemberStatus(member.id, "active", reason), "Reactivated.")}>
          <p>They can sign in again. Events they were removed from are not restored.</p>
        </Dialog>
      )}
      {action === "reset" && (
        <Dialog danger title={`Reset ${member.displayName}’s profile?`} confirmLabel="Reset profile" reasonLabel="Why is the profile being reset?" onClose={() => setAction(null)}
          onConfirm={async (reason) => done(await api.resetMemberProfile(member.id, reason), "Profile reset to defaults.")}>
          <p>Photo, avatar, city, interests, travel radius, availability and favorites go back to defaults. This can’t be undone. Name, role, teams, location and points are kept.</p>
        </Dialog>
      )}
      {action === "points" && (
        <Dialog danger={resetPoints} title="Change points" confirmLabel={resetPoints ? "Reset to 0" : "Apply change"} reasonLabel="Reason for the change" confirmDisabled={resetPoints ? !member.pointsBalance : !deltaValid}
          onClose={() => { setRequestId(crypto.randomUUID()); setAction(null); }}
          onConfirm={async (reason) => {
            const next = await api.adjustPoints(member.id, requestId, resetPoints ? -(member.pointsBalance ?? 0) : deltaValue, reason);
            setRequestId(crypto.randomUUID()); // a later adjustment is a new request, never a replay
            done(next, resetPoints ? "Points reset to 0." : `Points changed by ${deltaValue > 0 ? "+" : ""}${deltaValue}.`);
          }}>
          <div className="tabs" role="group" aria-label="Kind of change">
            <button className="tab" aria-pressed={!resetPoints} onClick={() => setResetPoints(false)}>Adjust</button>
            <button className="tab" aria-pressed={resetPoints} onClick={() => setResetPoints(true)}>Reset to 0</button>
          </div>
          {resetPoints ? <p>The balance of {member.pointsBalance} is reduced to 0 by one adjustment.</p> : (
            <div className="field"><label htmlFor="delta">Points to add or take away</label>
              <input id="delta" inputMode="numeric" value={delta} placeholder="e.g. 50 or -25" onChange={(e) => setDelta(e.target.value)} aria-invalid={delta !== "" && !deltaValid} />
              <span className="hint">Balance {member.pointsBalance ?? 0}{deltaValid ? ` becomes ${Math.max(0, (member.pointsBalance ?? 0) + deltaValue)}` : ""}. It can’t go below 0.</span>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

export default function MemberDetailPage() {
  return (
    <Shell title="Member" subtitle="Edit details, access, points and profile. Every change is recorded in the audit log." requires="members.view">
      <Suspense fallback={<Loading label="Loading member" />}><MemberDetail /></Suspense>
    </Shell>
  );
}
