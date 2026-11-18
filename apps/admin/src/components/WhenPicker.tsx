"use client";
// @i18n-migrated

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  DAY_MIN, HALF_DAY, type DayKey, type WhenIssue, type WhenModel,
  addMonths, calendarKey, clickDay, dayDiff, dayOfWeek, describeDuration, dayKey, durationParts, dragMinutes, dstNote, durationMinutes,
  formatTime, isPm, minutesToAngle, modelFromIso, modelToIso, monthGrid, parseDay, parseTime, pointToAngle, previewRange,
  resolveLocal, settle, sliderKey, withPeriod, zoneAbbreviation, angleToFaceMinutes,
} from "@/lib/when";
import { t as tAi } from "@/lib/aiStrings";
import { intlLocale, t } from "@/lib/i18n";
import { DEFAULT_PRESETS, type TimePreset, nextWeekday } from "@/lib/dipbotTouches";
import { Chevron } from "./Chevron";
import { DipbotMark } from "./DipbotMark";
import { ChipToggle, SegmentedControl } from "@/components/kit";

interface Props {
  /** RFC 3339 UTC, the same values the editor stores. */
  startTime: string;
  endTime: string;
  /** Fires on commit only: a calendar pick, the end of a drag, a key press, a typed time or a preset. */
  onChange: (startTime: string, endTime: string) => void;
  /** Live values while a handle is being dragged. */
  onPreview?: (startTime: string, endTime: string) => void;
  disabled?: boolean;
  /** Editing an existing event may sit in the past; new events may not. */
  allowPast?: boolean;
  startError?: string;
  endError?: string;
  /** Dipbot's suggested times (the best slot from the company's data first); the two defaults when omitted. */
  presets?: readonly TimePreset[];
  /** For tests and screenshots. */
  now?: Date;
}

/** Weekday names, Sunday first, in the current language (a function: the language can change while the app runs). */
function weekdayNames(): string[] {
  const format = new Intl.DateTimeFormat(intlLocale(), { weekday: "long" });
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(2023, 0, 1 + i))); // 2023-01-01 is a Sunday
}

function fmt(key: DayKey, options: Intl.DateTimeFormatOptions): string {
  const { y, m, d } = parseDay(key);
  return new Intl.DateTimeFormat(intlLocale(), options).format(new Date(y, m, d));
}
const short = (key: DayKey) => fmt(key, { weekday: "short", month: "short", day: "numeric" });
const long = (key: DayKey) => fmt(key, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

/** Dial geometry (viewBox units). */
const C = 140;
const R = 104;
const point = (minutes: number, radius = R) => {
  const a = (minutesToAngle(minutes) * Math.PI) / 180;
  return { x: C + radius * Math.sin(a), y: C - radius * Math.cos(a) };
};

function arcPath(from: number, to: number): string {
  const a = point(from), b = point(to);
  const span = (((minutesToAngle(to) - minutesToAngle(from)) % 360) + 360) % 360;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 ${span > 180 ? 1 : 0} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

/** Biggest two units, so the centre of the dial stays short ("2d 16h"). */
function centreDuration(minutes: number): string {
  const parts = durationParts(minutes);
  return parts.slice(0, 2).join(" ") || t("editor.when.minuteShort", { n: 0 });
}

type Handle = "start" | "end";

export function WhenPicker({ startTime, endTime, onChange, onPreview, disabled = false, allowPast = false, startError, endError, presets = DEFAULT_PRESETS, now }: Props) {
  const uid = useId();
  const clock = useRef(now ?? new Date());
  const today = dayKey(clock.current);
  const [model, setModel] = useState<WhenModel>(() => modelFromIso(startTime, endTime, clock.current));
  const modelRef = useRef(model);
  modelRef.current = model;
  const lastIso = useRef(`${startTime}|${endTime}`);
  const [issue, setIssue] = useState<WhenIssue>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [hover, setHover] = useState<DayKey | null>(null);
  const [view, setView] = useState<DayKey>(() => `${model.range.start.slice(0, 8)}01`);
  const [focusDay, setFocusDay] = useState<DayKey>(model.range.start);
  const [dragging, setDragging] = useState<Handle | null>(null);
  const [announce, setAnnounce] = useState("");
  const [zone, setZone] = useState("");
  const svgRef = useRef<SVGSVGElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  const drag = useRef<{ handle: Handle; previous: number } | null>(null);

  useEffect(() => setZone(zoneAbbreviation(new Date(startTime || clock.current))), [startTime]);

  // The editor can replace the values (loading an event, a draft); follow it unless it is only echoing our own change.
  useEffect(() => {
    const incoming = `${startTime}|${endTime}`;
    if (incoming === lastIso.current) return;
    lastIso.current = incoming;
    if (!startTime || !endTime) return;
    const next = modelFromIso(startTime, endTime, clock.current);
    setModel(next);
    setView(`${next.range.start.slice(0, 8)}01`);
    setFocusDay(next.range.start);
  }, [startTime, endTime]);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [focusDay, view]);

  /** Applies an edit: settles it, shows notes, and emits only when final. */
  const apply = useCallback((next: WhenModel, final: boolean) => {
    const settled = settle(next);
    let m = settled.model;
    // A time that does not exist (spring forward) is stored as the time the zone actually uses.
    const startR = resolveLocal(m.range.start, m.startMin), endR = resolveLocal(m.range.end, m.endMin);
    const found = [dstNote(m.range.start, m.startMin), m.range.end !== m.range.start || m.endMin !== m.startMin ? dstNote(m.range.end, m.endMin) : null].filter(Boolean) as string[];
    if (final) {
      m = { ...m, startMin: startR.date.getHours() * 60 + startR.date.getMinutes(), endMin: endR.date.getHours() * 60 + endR.date.getMinutes() };
    }
    modelRef.current = m;
    setModel(m);
    setIssue(settled.issue);
    setNotes(found);
    const iso = modelToIso(m);
    if (!final) {
      onPreview?.(iso.startTime, iso.endTime);
      return;
    }
    lastIso.current = `${iso.startTime}|${iso.endTime}`;
    onChange(iso.startTime, iso.endTime);
    setAnnounce(t("editor.when.announce", { start: short(m.range.start), startTime: formatTime(m.startMin), end: short(m.range.end), endTime: formatTime(m.endMin), duration: describeDuration(durationMinutes(m)) }));
  }, [onChange, onPreview]);

  // ---- calendar
  const preview = previewRange(model.range, hover);
  const grid = useMemo(() => monthGrid(view), [view]);
  const inGrid = grid.some((week) => week.includes(focusDay));
  const tabDay = inGrid ? focusDay : view;
  const isPast = (day: DayKey) => day < today;
  const blocked = (day: DayKey) => disabled || (!allowPast && isPast(day));

  function pick(day: DayKey) {
    if (blocked(day)) return;
    const before = modelRef.current;
    const range = clickDay(before.range, day);
    setFocusDay(day);
    if (range.phase === "picking") {
      modelRef.current = { ...before, range, rolled: false, pinnedSingle: false };
      setModel(modelRef.current);
      setNotes([]);
      setIssue(null);
      setAnnounce(t("editor.when.announcePicking", { date: short(range.start) }));
      return;
    }
    setHover(null);
    apply({ ...before, range, rolled: false, pinnedSingle: before.range.phase === "picking" && range.start === range.end }, true);
  }

  function moveView(months: number) {
    setView((current) => addMonths(current, months));
  }

  function onGridKey(event: React.KeyboardEvent) {
    const target = calendarKey(event.key, focusDay, event.shiftKey);
    if (!target) return;
    event.preventDefault();
    moveFocus.current = true;
    setFocusDay(target);
    setView(`${target.slice(0, 8)}01`);
  }

  const dayState = (day: DayKey) => {
    const parts: string[] = [];
    if (day === today) parts.push(t("editor.when.state.today"));
    if (day === preview.start && day === preview.end) parts.push(t("editor.when.state.startAndEnd"));
    else if (day === preview.start) parts.push(t("editor.when.state.start"));
    else if (day === preview.end) parts.push(t("editor.when.state.end"));
    else if (day > preview.start && day < preview.end) parts.push(t("editor.when.state.inRange"));
    if (!allowPast && isPast(day)) parts.push(t("editor.when.state.past"));
    return parts;
  };

  const nights = dayDiff(model.range.start, model.range.end) + 1;
  const summary = model.range.phase === "picking"
    ? t("editor.when.summary.picking", { date: short(model.range.start) })
    : model.range.start === model.range.end
      ? t("editor.when.summary.oneDay", { date: short(model.range.start) })
      : t("editor.when.summary.range", { start: short(model.range.start), end: short(model.range.end), count: nights });

  // ---- dial
  const duration = durationMinutes(model);
  const multiDay = model.range.start !== model.range.end;
  const setHandle = (handle: Handle, minutes: number, final: boolean) => {
    const m = modelRef.current;
    apply(handle === "start" ? { ...m, startMin: minutes } : { ...m, endMin: minutes }, final);
  };

  function angleAt(clientX: number, clientY: number): number | null {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return null;
    return pointToAngle(clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2));
  }

  function beginDrag(handle: Handle, event: React.PointerEvent, jumpTo?: number) {
    if (disabled) return;
    event.preventDefault();
    const m = modelRef.current;
    drag.current = { handle, previous: handle === "start" ? m.startMin : m.endMin };
    setDragging(handle);
    (event.currentTarget as Element).closest("svg")?.querySelector<SVGElement>(`[data-handle="${handle}"]`)?.focus({ preventScroll: true });
    if (jumpTo !== undefined) moveTo(handle, jumpTo, false);
    const move = (e: PointerEvent) => {
      const angle = angleAt(e.clientX, e.clientY);
      if (angle !== null) moveTo(handle, angle, false);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      drag.current = null;
      setDragging(null);
      apply(modelRef.current, true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function moveTo(handle: Handle, angle: number, final: boolean) {
    const state = drag.current;
    if (!state) return;
    const minutes = dragMinutes(angle, state.previous);
    state.previous = minutes;
    setHandle(handle, minutes, final);
  }

  function onTrackDown(event: React.PointerEvent) {
    if (disabled) return;
    const angle = angleAt(event.clientX, event.clientY);
    if (angle === null) return;
    const face = angleToFaceMinutes(angle);
    const m = modelRef.current;
    const distance = (a: number, b: number) => { const d = Math.abs(a - (b % HALF_DAY)); return Math.min(d, HALF_DAY - d); };
    const handle: Handle = distance(face, m.startMin) <= distance(face, m.endMin) ? "start" : "end";
    beginDrag(handle, event, angle);
  }

  function onHandleKey(handle: Handle, event: React.KeyboardEvent) {
    const m = modelRef.current;
    const next = sliderKey(event.key, handle === "start" ? m.startMin : m.endMin);
    if (next === null) return;
    event.preventDefault();
    setHandle(handle, next, true);
  }

  const startPoint = point(model.startMin), endPoint = point(model.endMin);
  const fullRing = duration >= HALF_DAY && !multiDay ? true : minutesToAngle(model.startMin) === minutesToAngle(model.endMin) && duration > 0;

  const ticks = useMemo(() => Array.from({ length: 60 }, (_, i) => {
    const major = i % 5 === 0;
    const a = (i * 6 * Math.PI) / 180;
    const r1 = major ? 76 : 79, r2 = 84;
    return { major, x1: C + r1 * Math.sin(a), y1: C - r1 * Math.cos(a), x2: C + r2 * Math.sin(a), y2: C - r2 * Math.cos(a) };
  }), []);

  const presetActive = (p: TimePreset) => model.startMin === p.start && model.endMin === p.end && (p.weekday === undefined || dayOfWeek(model.range.start) === p.weekday);
  const applyPreset = (p: TimePreset) => {
    if (disabled) return;
    const m = modelRef.current;
    // A preset with a weekday also moves the date, to the next such day (one-day event); the others keep the dates.
    const day = p.weekday === undefined || dayOfWeek(m.range.start) === p.weekday ? null : nextWeekday(today, p.weekday);
    const kept = m.rolled ? { ...m.range, end: m.range.start } : m.range;
    apply({ ...m, range: day ? { start: day, end: day, phase: "done" } : kept, startMin: p.start, endMin: p.end, rolled: false }, true);
  };

  const startId = "start", endId = "end";
  const describedStart = [startError ? "start-error" : "", issue ? `${uid}-issue` : ""].filter(Boolean).join(" ") || undefined;
  const describedEnd = [endError ? "end-error" : "", issue ? `${uid}-issue` : ""].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`when${disabled ? " is-disabled" : ""}`} role="group" aria-label={t("editor.when.group")}>
      {/* ------------------------------------------------ calendar */}
      <div className="when-cal">
        <div className="when-cal-head">
          <h3 id={`${uid}-month`} className="when-month" aria-live="polite">{fmt(view, { month: "long", year: "numeric" })}</h3>
          <div className="when-cal-nav">
            <button type="button" className="when-iconbtn flip" onClick={() => moveView(-1)} aria-label={t("editor.when.prevMonth")}><Chevron size={16} /></button>
            <button type="button" className="when-today" onClick={() => { moveFocus.current = false; setView(`${today.slice(0, 8)}01`); setFocusDay(today); }}>{t("editor.when.today")}</button>
            <button type="button" className="when-iconbtn" onClick={() => moveView(1)} aria-label={t("editor.when.nextMonth")}><Chevron size={16} /></button>
          </div>
        </div>
        <div className="when-grid" role="grid" aria-labelledby={`${uid}-month`} aria-describedby={`${uid}-summary`} ref={gridRef} onKeyDown={onGridKey} onMouseLeave={() => setHover(null)}>
          <div role="row" className="when-week head">
            {weekdayNames().map((name, i) => <div key={i} role="columnheader" aria-label={name} className="when-dow">{name.slice(0, 1).toUpperCase() + name.slice(1, 2)}</div>)}
          </div>
          {grid.map((week) => (
            <div role="row" className="when-week" key={week[0]}>
              {week.map((day) => {
                const inside = day >= preview.start && day <= preview.end;
                const isStart = day === preview.start, isEnd = day === preview.end;
                const outside = day.slice(0, 7) !== view.slice(0, 7);
                const stateText = dayState(day);
                const classes = ["when-day", inside && "in-range", isStart && "range-start", isEnd && "range-end", day === today && "is-today", !allowPast && isPast(day) && "is-past", isPast(day) && "dim", outside && "outside"].filter(Boolean).join(" ");
                return (
                  <div role="gridcell" key={day} aria-selected={inside} className={classes}>
                    <button type="button" data-day={day} tabIndex={day === tabDay ? 0 : -1} aria-disabled={blocked(day) || undefined}
                      aria-label={`${long(day)}${stateText.length ? `, ${stateText.join(", ")}` : ""}`}
                      onClick={() => pick(day)} onFocus={() => setFocusDay(day)} onMouseEnter={() => model.range.phase === "picking" && !blocked(day) && setHover(day)}>
                      {parseDay(day).d}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p id={`${uid}-summary`} className="when-summary">{summary}</p>
        <p className="hint when-help">{t("editor.when.help")}</p>
      </div>

      {/* ------------------------------------------------ dial */}
      <div className="when-dial">
        <div className="when-read">
          <div className={`when-time${dragging === "start" ? " live" : ""}`}>
            <span className="when-lbl">{t("editor.when.starts")}</span>
            <strong>{formatTime(model.startMin)}</strong>
            <span className="when-date">{short(model.range.start)}</span>
          </div>
          <div className={`when-time${dragging === "end" ? " live" : ""}`}>
            <span className="when-lbl">{t("editor.when.ends")}</span>
            <strong>{formatTime(model.endMin)}</strong>
            <span className="when-date">{short(model.range.end)}</span>
          </div>
          {zone && <span className="when-tz" title={t("editor.when.zone")}>{zone}</span>}
        </div>

        <svg ref={svgRef} className={`when-clock${dragging ? " dragging" : ""}`} viewBox="0 0 280 280" role="group" aria-label={t("editor.when.dial")} onPointerDown={onTrackDown}>
          <circle cx={C} cy={C} r={R + 12} className="clock-edge" />
          <circle cx={C} cy={C} r={R - 12} className="clock-edge" />
          <circle cx={C} cy={C} r={R} className="clock-track" />
          {duration > 0 && (fullRing
            ? <><circle cx={C} cy={C} r={R} className="clock-arc-rim" /><circle cx={C} cy={C} r={R} className="clock-arc" /></>
            : <><path d={arcPath(model.startMin, model.endMin)} className="clock-arc-rim" /><path d={arcPath(model.startMin, model.endMin)} className="clock-arc" /></>)}
          {ticks.map((tick, i) => <line key={i} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} className={tick.major ? "tick major" : "tick"} />)}
          {Array.from({ length: 12 }, (_, i) => {
            const n = i === 0 ? 12 : i;
            const p = point(n * 60, 60);
            return <text key={n} x={p.x} y={p.y} className="numeral" textAnchor="middle" dominantBaseline="central">{n}</text>;
          })}
          <text x={C} y={C - 2} className={`centre${centreDuration(duration).length > 5 ? " small" : ""}`} textAnchor="middle" dominantBaseline="central" aria-hidden>{centreDuration(duration)}</text>
          <text x={C} y={C + 20} className="centre-label" textAnchor="middle" aria-hidden>{multiDay ? t("editor.when.total") : t("editor.when.duration")}</text>

          {(["start", "end"] as const).map((handle) => {
            const p = handle === "start" ? startPoint : endPoint;
            const minutes = handle === "start" ? model.startMin : model.endMin;
            return (
              <g key={handle} data-handle={handle} role="slider" tabIndex={disabled ? -1 : 0} className={`handle ${handle}${dragging === handle ? " active" : ""}`}
                aria-label={handle === "start" ? t("editor.when.startTime") : t("editor.when.endTime")} aria-valuemin={0} aria-valuemax={DAY_MIN - 15} aria-valuenow={minutes}
                aria-valuetext={`${formatTime(minutes)}, ${short(handle === "start" ? model.range.start : model.range.end)}`} aria-disabled={disabled || undefined}
                aria-describedby={handle === "start" ? describedStart : describedEnd}
                onKeyDown={(e) => onHandleKey(handle, e)}
                onPointerDown={(e) => { e.stopPropagation(); beginDrag(handle, e); }}>
                <circle cx={p.x} cy={p.y} r={22} className="hit" />
                <circle cx={p.x} cy={p.y} r={23} className="focus-halo" />
                <circle cx={p.x} cy={p.y} r={23} className="focus-ring" />
                <circle cx={p.x} cy={p.y} r={15} className="knob" />
                {handle === "start"
                  ? <path d={`M ${p.x - 3.5} ${p.y - 5.5} L ${p.x + 5.5} ${p.y} L ${p.x - 3.5} ${p.y + 5.5} Z`} className="icon" />
                  : <path d={`M ${p.x - 4.5} ${p.y + 6} V ${p.y - 6} H ${p.x + 5} L ${p.x + 2.5} ${p.y - 2.5} L ${p.x + 5} ${p.y + 1} H ${p.x - 3} V ${p.y + 6} Z`} className="icon" />}
              </g>
            );
          })}
        </svg>

        <div className="when-fields">
          <TimeField id={startId} label={t("editor.when.startTime")} minutes={model.startMin} disabled={disabled} invalid={!!startError} describedBy={describedStart}
            onCommit={(minutes) => setHandle("start", minutes, true)} />
          <TimeField id={endId} label={t("editor.when.endTime")} minutes={model.endMin} disabled={disabled} invalid={!!endError || issue !== null} describedBy={describedEnd}
            onCommit={(minutes) => setHandle("end", minutes, true)} />
        </div>
        <div className="when-suggest">
          <span className="when-suggest-label" id={`${uid}-presets`}>{tAi("editor.timesLabel")}</span>
          <div className="chips when-presets" role="group" aria-labelledby={`${uid}-presets`}>
            {presets.map((p) => (
              <ChipToggle key={p.id} className="dipbot-chip" disabled={disabled} pressed={presetActive(p)} onClick={() => applyPreset(p)} icon={<DipbotMark size={14} />}>
                {p.label}
              </ChipToggle>
            ))}
          </div>
        </div>
      </div>

      <div className="when-messages">
        {issue && <p className="error" id={`${uid}-issue`} role="alert">{t("editor.when.issue")}</p>}
        {startError && <p className="error" id="start-error">{startError}</p>}
        {endError && <p className="error" id="end-error">{endError}</p>}
        {model.rolled && !issue && <p className="hint" role="status">{t("editor.when.rolled", { date: short(model.range.end) })}</p>}
        {notes.map((note) => <p className="hint" role="status" key={note}>{note}</p>)}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </div>
  );
}

/** Typed time (6:30 PM) with AM/PM buttons, for precision and for people who do not use the dial. */
function TimeField({ id, label, minutes, disabled, invalid, describedBy, onCommit }: {
  id: string; label: string; minutes: number; disabled: boolean; invalid: boolean; describedBy?: string; onCommit: (minutes: number) => void;
}) {
  const [text, setText] = useState(formatTime(minutes));
  const [bad, setBad] = useState(false);
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) { setText(formatTime(minutes)); setBad(false); } }, [minutes]);
  const commit = () => {
    editing.current = false;
    const parsed = parseTime(text, isPm(minutes));
    if (parsed === null) { setBad(true); setText(formatTime(minutes)); return; }
    setBad(false);
    setText(formatTime(parsed));
    if (parsed !== minutes) onCommit(parsed);
  };
  return (
    <div className="when-field field">
      <label htmlFor={id}>{label}</label>
      <div className="when-field-row">
        <input id={id} inputMode="text" autoComplete="off" spellCheck={false} value={text} disabled={disabled} aria-invalid={invalid || bad || undefined} aria-describedby={describedBy}
          onFocus={() => { editing.current = true; }} onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />
        <SegmentedControl variant="pill" label={t("editor.when.amPm", { label })} value={isPm(minutes) ? "pm" : "am"} disabled={disabled} onChange={(next) => onCommit(withPeriod(minutes, next === "pm"))}
          options={[{ value: "am", label: "AM" }, { value: "pm", label: "PM" }]} />
      </div>
      {bad && <span className="error" role="alert">{t("editor.when.typeTime")}</span>}
    </div>
  );
}
