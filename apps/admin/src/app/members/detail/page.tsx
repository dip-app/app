"use client";
// @i18n-migrated

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Dialog } from "@/components/Dialog";
import { Shell, useShellHeader } from "@/components/Shell";
import { Tabs } from "@/components/Tabs";
import { toast } from "@/components/Toast";
import { Avatar, Info, LoadError, Loading, formatDate } from "@/components/Ui";
import { describe, useLoad } from "@/components/useLoad";
import type { Session } from "@/lib/api";
import { type Member, type MemberPatch, ROLE_LABEL, type Role, can } from "@/lib/adminTypes";
import { ApiError } from "@/lib/contract";
import { t } from "@/lib/i18n";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { saveFailureMessage } from "@/lib/userError";
import { useSkeletonGate } from "@/components/useDelayedShow";
import { Button, ChipToggle, ErrorNotice, InlineNotice, Panel } from "@/components/kit";

function roleDescription(role: Role): string {
  return t(`memberDetail.role.description.${role}`);
}

type Action = "deactivate" | "reactivate" | "reset" | "points" | "role" | null;

function MemberDetail() {
  const id = useSearchParams().get("id") ?? "";
  const { api, session } = useApp();
  const member = useLoad((a) => a.getMember(id), id);
  const company = useLoad((a) => a.companyInfo(), "company");
  const hold = useSkeletonGate((!member.data || !company.data) && !member.error);
  if (member.error) return <LoadError error={member.error} onRetry={member.reload} backHref="/members/" backLabel={t("memberDetail.backToMembers")} />;
  if (!member.data || !company.data || hold) return <Loading label={t("memberDetail.loading")} layout="memberDetail" />;
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
  const toggleTeam = (teamId: string) => set("teamIds", draft.teamIds.includes(teamId) ? draft.teamIds.filter((id) => id !== teamId) : [...draft.teamIds, teamId]);

  useUnsavedGuard(dirty);
  const statusText = member.status === "active" ? t("memberDetail.status.active") : member.status === "invited" ? t("memberDetail.status.invited") : t("memberDetail.status.deactivated");
  useShellHeader({
    title: member.displayName, metaKey: `${member.role}|${member.status}|${member.createdAt}`,
    meta: <>
      <span>{ROLE_LABEL[member.role]}</span>
      {member.status === "active" ? <span>{statusText}</span> : <Info tone="warn">{statusText}</Info>}
      <span>{t("memberDetail.joined", { date: formatDate(member.createdAt) })}</span>
    </>,
  });

  /** A role change is confirmed first (it changes what the person can do); other edits save straight away. */
  function requestSave() {
    if (draft.role !== member.role) setAction("role");
    else void save();
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.updateMember(member.id, member.revision, draft));
      toast(t("memberDetail.saved"));
    } catch (failure) {
      setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", describe(failure)));
    } finally {
      setSaving(false);
    }
  }
  const done = (next: Member, text: string) => { setAction(null); toast(text); onSaved(next); };
  const fieldError = (name: string) => error?.fields[name];

  return (
    <>
      {error && (
        error.code === "aborted"
          ? <InlineNotice tone="error" title={t("failure.title.save")} action={<Button variant="plain" onClick={onReload}>{t("memberDetail.reloadLatest")}</Button>}>{saveFailureMessage(error, true)}</InlineNotice>
          : <ErrorNotice error={error} title={t("failure.title.save")} />
      )}

      <div className="detail-layout">
        <section className="panel" aria-labelledby="who">
          <div className="person big"><Avatar name={member.displayName} userId={member.id} photoURL={member.photoURL} avatarId={member.avatarId} size={64} /><div><h2 id="who">{t("memberDetail.profileTitle")}</h2><p className="muted">{member.email}</p></div></div>
          <fieldset className="bare" disabled={!editable}>
          <div className="form single">
            <div className="field"><label htmlFor="m-role">{t("memberDetail.field.role")}</label>
              <select id="m-role" value={draft.role} onChange={(e) => set("role", e.target.value as Role)} aria-invalid={!!fieldError("role")} disabled={self || !editable}>
                {(["member", "organizer", "admin"] as const).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <span className="hint">{self ? t("memberDetail.hint.ownRole") : t("memberDetail.hint.roles")}</span>
              {fieldError("role") && <span className="error">{fieldError("role")}</span>}
            </div>
            <fieldset className="field"><legend>{t("memberDetail.field.teams")}</legend>
              <div className="chips">{teams.map((team) => <ChipToggle key={team.id} pressed={draft.teamIds.includes(team.id)} onClick={() => toggleTeam(team.id)}>{team.name}</ChipToggle>)}</div>
            </fieldset>
            <div className="row">
              <div className="field"><label htmlFor="m-loc">{t("memberDetail.field.workLocation")}</label><input id="m-loc" value={draft.workLocation} maxLength={80} onChange={(e) => set("workLocation", e.target.value)} /></div>
              <div className="field"><label htmlFor="m-dep">{t("memberDetail.field.department")}</label><input id="m-dep" value={draft.department} maxLength={80} onChange={(e) => set("department", e.target.value)} /></div>
            </div>
            <div className="field"><label htmlFor="m-job">{t("memberDetail.field.jobTitle")}</label><input id="m-job" value={draft.jobTitle} maxLength={80} onChange={(e) => set("jobTitle", e.target.value)} /></div>
          </div>
          </fieldset>
          {!editable && <InlineNotice>{t("memberDetail.readOnly")}</InlineNotice>}
          {editable && <div className="actions">
            <Button variant="primary" disabled={!dirty || saving} onClick={requestSave}>{saving ? t("memberDetail.saving") : t("memberDetail.save")}</Button>
            <Button disabled={!dirty || saving} onClick={() => setDraft({ role: member.role, teamIds: member.teamIds, workLocation: member.workLocation, department: member.department, jobTitle: member.jobTitle })}>{t("memberDetail.discard")}</Button>
          </div>}
        </section>

        {editable && <aside className="stack">
          <Panel id="access" title={t("memberDetail.access.title")}>
            {member.status === "deactivated"
              ? <><p className="muted">{t("memberDetail.access.deactivatedNote")}</p><Button onClick={() => setAction("reactivate")}>{t("memberDetail.access.reactivate")}</Button></>
              : <><p className="muted">{t("memberDetail.access.activeNote")}</p><Button variant="danger" disabled={self} onClick={() => setAction("deactivate")}>{t("memberDetail.access.deactivate")}</Button>{self && <p className="hint">{t("memberDetail.access.selfNote")}</p>}</>}
          </Panel>
          <Panel id="pts" title={t("memberDetail.points.title")}>
            <p className="big-number">{member.pointsBalance ?? 0}</p>
            <Button onClick={() => { setDelta(""); setResetPoints(false); setAction("points"); }}>{t("memberDetail.points.adjustOrReset")}</Button>
          </Panel>
          <Panel id="prof" title={t("memberDetail.profile.title")}>
            <dl className="facts">
              <div><dt>{t("memberDetail.profile.avatar")}</dt><dd>{member.avatarId ? t("memberDetail.profile.avatarChosen") : t("memberDetail.profile.avatarDefault")}</dd></div>
              <div><dt>{t("memberDetail.profile.city")}</dt><dd>{member.city || t("memberDetail.profile.cityNotSet")}</dd></div>
            </dl>
            <p className="muted">{t("memberDetail.profile.clears")}</p>
            <Button variant="danger" onClick={() => setAction("reset")}>{t("memberDetail.profile.reset")}</Button>
          </Panel>
        </aside>}
      </div>

      {action === "role" && (
        <Dialog danger={draft.role === "admin"} title={t("memberDetail.role.title", { name: member.displayName })} confirmLabel={t("memberDetail.role.confirm", { role: draft.role })} busyLabel={t("memberDetail.role.busy")} onClose={() => setAction(null)}
          onConfirm={async () => { await save(); setAction(null); }}>
          <p>{t("memberDetail.role.goesFrom", { name: member.displayName })}<strong>{ROLE_LABEL[member.role]}</strong>{t("memberDetail.role.goesTo")}<strong>{ROLE_LABEL[draft.role]}</strong>{t("memberDetail.role.goesEnd")}</p>
          {draft.role === "admin"
            ? <p>{roleDescription("admin")}</p>
            : <p>{roleDescription(draft.role)}</p>}
          {draft.teamIds.join() !== member.teamIds.join() || draft.workLocation !== member.workLocation || draft.department !== member.department || draft.jobTitle !== member.jobTitle
            ? <p className="muted">{t("memberDetail.role.otherEdits")}</p> : null}
        </Dialog>
      )}
      {action === "deactivate" && (
        <Dialog danger title={t("memberDetail.deactivate.title", { name: member.displayName })} confirmLabel={t("memberDetail.access.deactivate")} reasonLabel={t("memberDetail.deactivate.reason")} onClose={() => setAction(null)}
          onConfirm={async (reason) => done(await api.setMemberStatus(member.id, "deactivated", reason), t("memberDetail.deactivate.done"))}>
          <p>{t("memberDetail.deactivate.body")}</p>
        </Dialog>
      )}
      {action === "reactivate" && (
        <Dialog title={t("memberDetail.reactivate.title", { name: member.displayName })} confirmLabel={t("memberDetail.access.reactivate")} reasonLabel={t("memberDetail.reactivate.reason")} onClose={() => setAction(null)}
          onConfirm={async (reason) => done(await api.setMemberStatus(member.id, "active", reason), t("memberDetail.reactivate.done"))}>
          <p>{t("memberDetail.reactivate.body")}</p>
        </Dialog>
      )}
      {action === "reset" && (
        <Dialog danger title={t("memberDetail.reset.title", { name: member.displayName })} confirmLabel={t("memberDetail.profile.reset")} reasonLabel={t("memberDetail.reset.reason")} onClose={() => setAction(null)}
          onConfirm={async (reason) => done(await api.resetMemberProfile(member.id, reason), t("memberDetail.reset.done"))}>
          <p>{t("memberDetail.reset.body")}</p>
        </Dialog>
      )}
      {action === "points" && (
        <Dialog danger={resetPoints} title={t("memberDetail.pointsDialog.title")} confirmLabel={resetPoints ? t("memberDetail.pointsDialog.confirmReset") : t("memberDetail.pointsDialog.confirmApply")} reasonLabel={t("memberDetail.pointsDialog.reason")} confirmDisabled={resetPoints ? !member.pointsBalance : !deltaValid}
          onClose={() => { setRequestId(crypto.randomUUID()); setAction(null); }}
          onConfirm={async (reason) => {
            const next = await api.adjustPoints(member.id, requestId, resetPoints ? -(member.pointsBalance ?? 0) : deltaValue, reason);
            setRequestId(crypto.randomUUID()); // a later adjustment is a new request, never a replay
            done(next, resetPoints ? t("memberDetail.pointsDialog.resetDone") : t("memberDetail.pointsDialog.changedDone", { delta: `${deltaValue > 0 ? "+" : ""}${deltaValue}` }));
          }}>
          <Tabs label={t("memberDetail.pointsDialog.kind")} value={resetPoints ? "reset" : "adjust"} onChange={(id) => setResetPoints(id === "reset")}
            items={[{ id: "adjust", label: t("memberDetail.pointsDialog.tabAdjust") }, { id: "reset", label: t("memberDetail.pointsDialog.tabReset") }]} />
          {resetPoints ? <p>{t("memberDetail.pointsDialog.resetBody", { balance: member.pointsBalance ?? "" })}</p> : (
            <div className="field"><label htmlFor="delta">{t("memberDetail.pointsDialog.delta")}</label>
              <input id="delta" inputMode="numeric" value={delta} placeholder={t("memberDetail.pointsDialog.deltaPlaceholder")} onChange={(e) => setDelta(e.target.value)} aria-invalid={delta !== "" && !deltaValid} />
              <span className="hint">{deltaValid ? t("memberDetail.pointsDialog.balanceBecomes", { balance: member.pointsBalance ?? 0, next: Math.max(0, (member.pointsBalance ?? 0) + deltaValue) }) : t("memberDetail.pointsDialog.balance", { balance: member.pointsBalance ?? 0 })}</span>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

export default function MemberDetailPage() {
  return (
    <Shell title={t("memberDetail.title")} subtitle={t("memberDetail.subtitle")} requires="members.view" back={{ href: "/members/", label: t("shell.nav.members") }}>
      <Suspense fallback={<Loading label={t("memberDetail.loading")} layout="memberDetail" />}><MemberDetail /></Suspense>
    </Shell>
  );
}
