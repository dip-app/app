"use client";
// @i18n-migrated

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  HOUR_OPTIONS, type ManageSuggestionsResponse, PREVIEW_WIDTHS, type SuggestionsPreview, WEEKDAY_OPTIONS, engineLabel,
  manageFailureMessage, nextSendLabel, sameSchedule, statusNotices, testMessage,
} from "@/lib/suggestions";
import { suggestionsApiFor } from "@/lib/suggestionsApi";
import { t as tAi } from "@/lib/aiStrings";
import { t } from "@/lib/i18n";
import { creditsText } from "@/lib/credits";
import { useApp } from "./AppProvider";
import { CreditsMeter } from "./CreditsMeter";
import { DipbotAction } from "./DipbotAction";
import { toast } from "./Toast";
import { Loading } from "./Ui";
import { SkeletonBlock } from "./Skeleton";
import { Toggle } from "./Toggle";
import { useLoad } from "./useLoad";
import { useSkeletonGate } from "./useDelayedShow";
import { Button, InlineNotice, Panel, SegmentedControl } from "@/components/kit";

type Busy = null | "switch" | "schedule" | "preview" | "test";
type Message = { tone: "ok" | "info"; text: string } | null;

export function SuggestionsEmail() {
  const { api, session } = useApp();
  const sug = useMemo(() => (session ? suggestionsApiFor(api, session) : null), [api, session]);
  const state = useLoad((a) => (session ? suggestionsApiFor(a, session).manage("status") : Promise.reject(new Error("signed out"))), `suggestions-status:${session?.uid ?? ""}`);
  const status = state.data;
  // Dipbot credits are shared with the idea flow; a failed read just hides the meter.
  const creditsState = useLoad((a) => a.eventIdeaContext(), "event-idea-context");
  const credits = creditsState.data?.credits ?? null;

  const [weekday, setWeekday] = useState(1);
  const [hour, setHour] = useState(9);
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<string>("");
  const [message, setMessage] = useState<Message>(null);
  const [preview, setPreview] = useState<SuggestionsPreview | null>(null);
  const [view, setView] = useState<"html" | "text">("html");
  const [width, setWidth] = useState<keyof typeof PREVIEW_WIDTHS>("desktop");
  const synced = useRef(false);
  const dayId = useId();
  const hourId = useId();

  // The saved schedule fills the pickers once; later saves update them from the response.
  useEffect(() => {
    if (!status || synced.current) return;
    synced.current = true;
    setWeekday(status.schedule.weekday);
    setHour(status.schedule.hour);
  }, [status]);

  const hold = useSkeletonGate((!status || !sug) && !state.error);
  if (state.error) {
    return (
      <InlineNotice tone="error" action={<Button variant="plain" onClick={state.reload}>{t("common.tryAgain")}</Button>}>{manageFailureMessage(state.error)}</InlineNotice>
    );
  }
  if (!status || !sug || hold) return <Loading label={t("dipbot.email.loading")} layout="suggestions" />;

  const current: ManageSuggestionsResponse = status;
  const api2 = sug;
  const disabled = busy !== null;
  const notices = statusNotices(current);
  const next = nextSendLabel(current.nextSendAt, current.timeZone);
  const dirty = !sameSchedule({ weekday, hour }, current.schedule);
  const showHtml = view === "html";

  async function run(kind: Exclude<Busy, null>, work: () => Promise<void>) {
    if (busy) return;
    setBusy(kind);
    setFailure("");
    try { await work(); } catch (error) { setFailure(manageFailureMessage(error)); } finally { setBusy(null); }
  }

  const toggle = (on: boolean) => run("switch", async () => {
    const next = await api2.manage(on ? "subscribe" : "unsubscribe");
    state.setData(next);
    setMessage(null);
  });
  const saveSchedule = () => run("schedule", async () => {
    const next = await api2.manage("setSchedule", { weekday, hour });
    state.setData(next);
    setWeekday(next.schedule.weekday);
    setHour(next.schedule.hour);
    setMessage({ tone: "ok", text: t("dipbot.email.schedule.saved") });
  });
  const showPreview = () => run("preview", async () => {
    const next = await api2.manage("preview");
    state.setData({ ...next, preview: undefined });
    setPreview(next.preview ?? null);
    setView("html");
  });
  // The result is a toast: the line under the button was below the fold for most people in the usability study.
  const sendTest = () => run("test", async () => {
    const next = await api2.manage("sendTest");
    state.setData({ ...next, testQueued: undefined, testReason: undefined });
    const result = testMessage(next);
    toast(result.text, { tone: next.testQueued ? "success" : "error" });
  });
  // Only the action that is running is busy; it keeps focus (kit `loading`). The others wait, disabled.
  const othersBusy = (kind: Exclude<Busy, null>) => busy !== null && busy !== kind;

  return (
    <div className="suggestions">
      {/* The meter's row is held while the credits load, so the panels below don't move down when it arrives. */}
      {(credits || (creditsState.data === null && !creditsState.error)) && (
        <div className="ideas credits-row">
          <div className="ideas-head">{credits ? <CreditsMeter credits={credits} /> : <SkeletonBlock w={190} h={25} r={999} />}</div>
        </div>
      )}
      {failure && <InlineNotice tone="error">{failure}</InlineNotice>}

      <Panel id="sug-status" title={t("dipbot.email.status.title")}>
        <Toggle checked={current.subscribed} onChange={(on) => { if (!disabled) void toggle(on); }} label={t("dipbot.email.status.label")}
          hint={current.subscribed ? (next ? t("dipbot.email.status.next", { next }) : t("dipbot.email.status.onList")) : t("dipbot.email.status.off")} />
        {notices.map((text) => <InlineNotice key={text}>{text}</InlineNotice>)}
        <p className="muted">{t("dipbot.email.status.personal")}</p>
        {credits && <p className="muted">{tAi("credits.email", { cost: creditsText(credits.creditCost.weeklyEmail) })}</p>}
      </Panel>

      <Panel id="sug-schedule" title={t("dipbot.email.schedule.title")}>
        <div className="row">
          <div className="field">
            <label htmlFor={dayId}>{t("dipbot.email.schedule.day")}</label>
            <select id={dayId} value={weekday} disabled={disabled} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={hourId}>{t("dipbot.email.schedule.time")}</label>
            <select id={hourId} value={hour} disabled={disabled} onChange={(e) => setHour(Number(e.target.value))}>
              {HOUR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <p className="muted">{t("dipbot.email.schedule.zone", { timeZone: current.timeZone })}</p>
        <div className="actions inline">
          {/* Nothing to save reads as unavailable (aria-disabled) but keeps focus after a save. */}
          <Button variant="primary" disabled={othersBusy("schedule")} loading={busy === "schedule"} aria-disabled={!dirty || undefined}
            onClick={() => { if (dirty) void saveSchedule(); }}>
            {t(busy === "schedule" ? "dipbot.email.schedule.saving" : "dipbot.email.schedule.save")}
          </Button>
        </div>
        {message && <InlineNotice>{message.text}</InlineNotice>}
      </Panel>

      <Panel id="sug-preview" title={t("dipbot.email.preview.title")}>
        <p className="muted">{t("dipbot.email.preview.intro")}</p>
        <div className="actions inline">
          <DipbotAction label={t("dipbot.email.preview.button")} loadingLabel={t("dipbot.email.preview.building")} loading={busy === "preview"} disabled={othersBusy("preview")} onClick={() => void showPreview()} />
        </div>
        {preview && (
          <div className="sug-preview">
            <p className="sug-subject"><span className="muted">{t("dipbot.email.preview.subject")}</span> <strong>{preview.subject}</strong></p>
            <div className="sug-controls">
              <SegmentedControl label={t("dipbot.email.preview.format")} value={view} onChange={setView} options={[{ value: "html", label: t("dipbot.email.preview.formatEmail") }, { value: "text", label: t("dipbot.email.preview.formatText") }]} />
              {showHtml && (
                <SegmentedControl label={t("dipbot.email.preview.width")} value={width} onChange={setWidth}
                  options={[{ value: "desktop", label: t("dipbot.email.preview.desktop", { width: PREVIEW_WIDTHS.desktop }) }, { value: "mobile", label: t("dipbot.email.preview.mobile", { width: PREVIEW_WIDTHS.mobile }) }]} />
              )}
            </div>
            {showHtml ? (
              <div className="sug-frame-wrap">
                <iframe title={t("dipbot.email.preview.frame")} className="sug-frame" sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={preview.html} style={{ width: PREVIEW_WIDTHS[width] }} />
              </div>
            ) : (
              <pre className="sug-text" tabIndex={0} aria-label={t("dipbot.email.preview.textLabel")}>{preview.text}</pre>
            )}
            <p className="muted">{engineLabel(preview.engine)}</p>
          </div>
        )}
      </Panel>

      <Panel id="sug-test" title={t("dipbot.email.test.title")}>
        <p className="muted">{t("dipbot.email.test.intro")}</p>
        <div className="actions inline">
          <DipbotAction label={t("dipbot.email.test.button")} loadingLabel={t("dipbot.email.test.sending")} loading={busy === "test"} disabled={othersBusy("test")} onClick={() => void sendTest()} />
        </div>
      </Panel>
    </div>
  );
}
