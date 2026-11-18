"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  HOUR_OPTIONS, type ManageSuggestionsResponse, PREVIEW_WIDTHS, type SuggestionsPreview, WEEKDAY_OPTIONS, engineLabel,
  manageFailureMessage, nextSendLabel, sameSchedule, statusNotices, testMessage,
} from "@/lib/suggestions";
import { suggestionsApiFor } from "@/lib/suggestionsApi";
import { t } from "@/lib/aiStrings";
import { creditsText } from "@/lib/credits";
import { useApp } from "./AppProvider";
import { CreditsMeter } from "./CreditsMeter";
import { Loading, Notice } from "./Ui";
import { Toggle } from "./Toggle";
import { useLoad } from "./useLoad";
import { useSkeletonGate } from "./useDelayedShow";

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
  const [testResult, setTestResult] = useState<Message>(null);
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
      <div className="banner error" role="alert">
        <span>{manageFailureMessage(state.error)}</span>
        <button className="pill-btn" onClick={state.reload}>Try again</button>
      </div>
    );
  }
  if (!status || !sug || hold) return <Loading label="Loading weekly ideas email" layout="suggestions" />;

  const current: ManageSuggestionsResponse = status;
  const api2 = sug;
  const disabled = busy !== null;
  const notices = statusNotices(current);
  const next = nextSendLabel(current.nextSendAt, current.timeZone);
  const dirty = !sameSchedule({ weekday, hour }, current.schedule);

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
    setMessage({ tone: "ok", text: "Schedule saved." });
  });
  const showPreview = () => run("preview", async () => {
    const next = await api2.manage("preview");
    state.setData({ ...next, preview: undefined });
    setPreview(next.preview ?? null);
    setView("html");
  });
  const sendTest = () => run("test", async () => {
    const next = await api2.manage("sendTest");
    state.setData({ ...next, testQueued: undefined, testReason: undefined });
    setTestResult(testMessage(next));
  });

  return (
    <div className="suggestions">
      {credits && (
        <div className="ideas credits-row">
          <div className="ideas-head"><CreditsMeter credits={credits} /></div>
        </div>
      )}
      {failure && <div className="banner error" role="alert"><span>{failure}</span></div>}

      <section className="panel" aria-labelledby="sug-status">
        <h2 id="sug-status">Weekly email</h2>
        <Toggle checked={current.subscribed} onChange={(on) => { if (!disabled) void toggle(on); }} label="Send me weekly event ideas"
          hint={current.subscribed ? (next ? `Next email: ${next}` : "You are on the list.") : "Turn on to get a short email with event ideas each week."} />
        {notices.map((text) => <Notice key={text}>{text}</Notice>)}
        <p className="muted">This setting is only for you. Other admins choose for themselves.</p>
        {credits && <p className="muted">{t("credits.email", { cost: creditsText(credits.creditCost.weeklyEmail) })}</p>}
      </section>

      <section className="panel" aria-labelledby="sug-schedule">
        <h2 id="sug-schedule">Schedule</h2>
        <div className="row">
          <div className="field">
            <label htmlFor={dayId}>Day</label>
            <select id={dayId} value={weekday} disabled={disabled} onChange={(e) => setWeekday(Number(e.target.value))}>
              {WEEKDAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={hourId}>Time</label>
            <select id={hourId} value={hour} disabled={disabled} onChange={(e) => setHour(Number(e.target.value))}>
              {HOUR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <p className="muted">Times are in {current.timeZone}. This schedule applies to every admin in your company.</p>
        <div className="actions inline">
          <button type="button" className="pill-btn purple" disabled={disabled || !dirty} onClick={() => void saveSchedule()}>
            {busy === "schedule" ? "Saving..." : "Save schedule"}
          </button>
        </div>
        {message && <Notice>{message.text}</Notice>}
      </section>

      <section className="panel" aria-labelledby="sug-preview">
        <h2 id="sug-preview">Preview</h2>
        <p className="muted">See this week’s email before it goes out. Dry run: nothing is sent.</p>
        <div className="actions inline">
          <button type="button" className="pill-btn gray" disabled={disabled} onClick={() => void showPreview()}>
            {busy === "preview" ? "Building the preview..." : "Preview this week’s email"}
          </button>
        </div>
        {preview && (
          <div className="sug-preview">
            <p className="sug-subject"><span className="muted">Subject</span> <strong>{preview.subject}</strong></p>
            <div className="sug-controls">
              <div className="tabs" role="group" aria-label="Preview format">
                <button type="button" className="tab" aria-pressed={view === "html"} onClick={() => setView("html")}>Email</button>
                <button type="button" className="tab" aria-pressed={view === "text"} onClick={() => setView("text")}>Plain text</button>
              </div>
              {view === "html" && (
                <div className="tabs" role="group" aria-label="Preview width">
                  <button type="button" className="tab" aria-pressed={width === "desktop"} onClick={() => setWidth("desktop")}>Desktop {PREVIEW_WIDTHS.desktop}</button>
                  <button type="button" className="tab" aria-pressed={width === "mobile"} onClick={() => setWidth("mobile")}>Mobile {PREVIEW_WIDTHS.mobile}</button>
                </div>
              )}
            </div>
            {view === "html" ? (
              <div className="sug-frame-wrap">
                <iframe title="Preview of the weekly ideas email" className="sug-frame" sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={preview.html} style={{ width: PREVIEW_WIDTHS[width] }} />
              </div>
            ) : (
              <pre className="sug-text" tabIndex={0} aria-label="Plain text version">{preview.text}</pre>
            )}
            <p className="muted">{engineLabel(preview.engine)}</p>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="sug-test">
        <h2 id="sug-test">Test</h2>
        <p className="muted">Get this week’s email in your own inbox. You can send one test per hour.</p>
        <div className="actions inline">
          <button type="button" className="pill-btn gray" disabled={disabled} onClick={() => void sendTest()}>
            {busy === "test" ? "Sending..." : "Send me a test"}
          </button>
        </div>
        {testResult && <Notice>{testResult.text}</Notice>}
      </section>
    </div>
  );
}
