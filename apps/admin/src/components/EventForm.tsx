"use client";
// @i18n-migrated

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react"; // tags load from the shared catalog
import { type TagStat, countsByTag, hasStats, interestLabel } from "@/lib/tagStats";
import {
  ApiError, type AdminEvent, type EventDraft, type EventStatus, type FieldErrors, LIMITS,
  emptyDraft, normalizeDraft, reviveStashedDraft, validateDraft,
} from "@/lib/contract";
import { centsToDollars, dollarsToCents } from "@/lib/datetime";
import { defaultWhen } from "@/lib/when";
import { draftToPrefill, takeAiDraft } from "@/lib/ideas";
import { type TimeHint, readTimeHint, registerEditorStash, stashEditor, takeEditorStash, timePresets } from "@/lib/dipbotTouches";
import { type ResolvedFor, applyOutcome, planLocation, resolveTyped } from "@/lib/location/saveLocation";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { useApp } from "./AppProvider";
import { CoverPicker } from "./CoverPicker";
import { Dialog } from "./Dialog";
import { EventPreview } from "./EventPreview";
import { toast } from "./Toast";
import { useTags } from "./TagCatalog";
import { WhereSection } from "./WhereSection";
import { WhenPicker } from "./WhenPicker";
import { t as tAi } from "@/lib/aiStrings";
import { t } from "@/lib/i18n";
import { Button, ChipToggle, ErrorSummary, type ErrorSummaryItem, InlineNotice } from "@/components/kit";
import { saveFailureMessage } from "@/lib/userError";

interface Props {
  /** Present when editing. */
  event?: AdminEvent;
  /** Called when the user asks to discard local edits and reload the latest saved event. */
  onReload?: () => void;
}

/** The New event form as kept while the admin visits Dipbot. */
interface Stash { draft: EventDraft; price: string; coverBy: string | null }

/** Field key to the control a fix starts at, in page order (the error summary lists them in this order). */
const FIELD_IDS: Record<string, string> = {
  title: "title", description: "description", tagIds: "tags-first", coverImageURL: "cover-first", startTime: "start", endTime: "end",
  "venue.address": "vaddr", "venue.coordinates": "vaddr", "venue.latitude": "vaddr", "venue.longitude": "vaddr", "venue.name": "vname", "venue.locality": "vloc", costCents: "price", capacity: "capacity",
};

/** The field's name as the form shows it, for the error summary. */
function fieldLabel(key: string): string {
  switch (key) {
    case "title": return t("events.form.title");
    case "description": return t("events.form.description");
    case "tagIds": return t("events.form.tags");
    case "coverImageURL": return t("events.form.coverImage");
    case "startTime": return t("editor.when.startTime");
    case "endTime": return t("editor.when.endTime");
    case "venue.name": return tAi("where.venueName");
    case "venue.locality": return tAi("where.locality");
    case "costCents": return t("events.form.price");
    case "capacity": return t("events.form.capacity");
    default: return tAi("where.address");
  }
}

/** Every error in page order; a field the form doesn't know (a new server field) is listed last, linked to the title. */
function summaryItems(found: FieldErrors): ErrorSummaryItem[] {
  const known = Object.keys(FIELD_IDS).filter((key) => found[key]);
  const other = Object.keys(found).filter((key) => !(key in FIELD_IDS));
  return [
    ...known.map((key) => ({ target: FIELD_IDS[key], label: fieldLabel(key), message: found[key] ?? "" })).map((item) =>
      // "Title: Title must be 1 to 120 characters." reads the name twice: the message alone already names the field.
      (item.message.toLocaleLowerCase().startsWith(item.label.toLocaleLowerCase()) ? { ...item, label: "" } : item)),
    ...other.map((key) => ({ target: "title", label: key, message: found[key] ?? "" })),
  ];
}

export function EventForm({ event, onReload }: Props) {
  const { api } = useApp();
  const router = useRouter();
  const editing = Boolean(event);
  // Mirrors the server rule: once anyone has responded, start and end are locked.
  const timesLocked = editing && (event?.attendeeCount ?? 0) > 0;
  const [draft, setDraft] = useState<EventDraft>(() => (event ? structuredClone(event) : { ...emptyDraft(), ...defaultWhen() }));
  const [status, setStatus] = useState<EventStatus>(event?.status ?? "scheduled");
  const [price, setPrice] = useState(() => (event ? centsToDollars(event.costCents) : ""));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  // A save that failed without a field to fix: focus the alert so it is read and seen (fields get focus themselves).
  useEffect(() => {
    if (failure && Object.keys(failure.fields).length === 0) failureRef.current?.focus();
  }, [failure]);
  // Each submit that finds something to fix focuses the error summary, which lists every field at once.
  const summaryRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { if (attempt) summaryRef.current?.focus(); }, [attempt]);
  const showSummary = (found: FieldErrors) => { setErrors(found); setAttempt((n) => n + 1); };
  const [saving, setSaving] = useState(false);
  // IDs are opaque in production: the selector writes IDs and shows the catalog's names.
  const catalog = useTags();
  const tags = catalog.tags;
  // Interest counts (organizers and admins). Shown only once the company has stat docs; any failure hides them.
  const [stats, setStats] = useState<TagStat[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.tagStats().then((list) => !cancelled && setStats(list), () => !cancelled && setStats(null));
    return () => { cancelled = true; };
  }, [api]);
  // Create only, and only when arriving from Dipbot (?from=ai): fill the AI draft once, after the tag catalog has loaded
  // so its tag IDs are matched against the real catalog. Venue and times stay empty.
  const [fromAi, setFromAi] = useState(false);
  // The cover URL Dipbot picked (Let Dipbot choose, or a Dipbot draft). Any other cover choice clears it.
  const [coverBy, setCoverBy] = useState<string | null>(null);
  // The address text the venue's hidden coordinates were resolved for: a pick, or the saved event's own address (a legacy 0/0 one is looked up once on save and never blocks it).
  const resolvedFor = useRef<ResolvedFor | null>(event ? { address: event.venue.address, locality: event.venue.locality } : null);
  const aiChecked = useRef(false);
  const aiTaken = useRef<ReturnType<typeof takeAiDraft>>(null);
  useEffect(() => {
    if (editing || aiChecked.current) return;
    aiChecked.current = true;
    const fromAiLink = new URLSearchParams(window.location.search).get("from") === "ai";
    // A form kept while the admin visited Dipbot comes back once (a Dipbot draft opened in the editor wins over it).
    let kept: Stash | null = null;
    try { kept = takeEditorStash<Stash>(window.sessionStorage); } catch { /* storage blocked */ }
    if (kept && !fromAiLink) {
      setDraft(reviveStashedDraft(kept.draft)); // JSON turned an unset (NaN) coordinate into null
      setPrice(kept.price);
      setCoverBy(kept.coverBy);
    }
    if (!fromAiLink) return;
    try { aiTaken.current = takeAiDraft(window.sessionStorage); } catch { /* storage blocked: start empty */ }
  }, [editing]);
  useEffect(() => {
    const taken = aiTaken.current;
    if (!taken || catalog.status === "loading") return;
    aiTaken.current = null;
    // If the catalog couldn't load, keep the draft's tag IDs and let the server validate them.
    const fill = draftToPrefill(taken, catalog.status === "ready" ? catalog.tags.map((tag) => tag.id) : taken.tagIds);
    setDraft((current) => ({ ...current, ...fill }));
    setPrice(centsToDollars(fill.costCents));
    setCoverBy(fill.coverImageURL && taken.coverBy !== "admin" ? fill.coverImageURL : null);
    setFromAi(true);
  }, [catalog.status, catalog.tags]);
  // Dipbot's suggested times: the best slot Dipbot saw in this tab (no request here), else the two defaults.
  const [hint, setHint] = useState<TimeHint | null>(null);
  useEffect(() => { try { setHint(readTimeHint(window.sessionStorage)); } catch { /* defaults */ } }, []);
  const presets = timePresets(hint);
  const tagCounts = hasStats(stats) ? countsByTag(stats) : null;
  // One key per create attempt, kept across retries so a lost response can never create two events.
  const requestId = useRef(crypto.randomUUID());
  const [confirmCancel, setConfirmCancel] = useState<EventDraft | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [saved, setSaved] = useState(false);
  const initial = useRef(JSON.stringify([draft, status, price]));
  const dirty = !saved && JSON.stringify([draft, status, price]) !== initial.current;
  useUnsavedGuard(dirty);

  // "Generate suggestions" (New event header) keeps this form so Back from Dipbot returns to it.
  const latest = useRef({ draft, price, coverBy, dirty });
  latest.current = { draft, price, coverBy, dirty };
  useEffect(() => {
    if (editing) return;
    registerEditorStash(() => {
      const { draft: d, price: p, coverBy: c, dirty: changed } = latest.current;
      if (changed) { try { stashEditor(window.sessionStorage, { draft: d, price: p, coverBy: c } satisfies Stash); } catch { /* keep going */ } }
    });
    return () => registerEditorStash(null);
  }, [editing]);

  /** Editing a field clears its error (and its summary line): a red message under a fixed field read as still wrong. */
  const clearErrors = (...keys: string[]) => setErrors((current) => {
    if (!keys.some((key) => current[key])) return current;
    const next = { ...current };
    for (const key of keys) delete next[key];
    return next;
  });
  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => { setDraft((current) => ({ ...current, [key]: value })); clearErrors(key); };
  const VENUE_KEYS: Record<string, string[]> = { address: ["venue.address", "venue.coordinates", "venue.latitude", "venue.longitude"], name: ["venue.name"], locality: ["venue.locality"] };

  async function submit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault();
    if (saving) return;
    const cents = dollarsToCents(price);
    const candidate: EventDraft = normalizeDraft({ ...draft, costCents: cents });
    const found = validateDraft(candidate, {
      requireFuture: !editing, minCapacity: event?.attendeeCount,
      // The server owns tag existence; the client checks it only against a catalog it managed to load.
      knownTagIds: tags.length ? tags.map((tag) => tag.id) : candidate.tagIds,
    });
    if (Number.isNaN(cents)) found.costCents = t("events.form.priceInvalid");
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length) {
      showSummary(found);
      return;
    }
    // Map position: kept, or resolved from the typed address now (never typed by the admin).
    const plan = planLocation(candidate.venue, resolvedFor.current, editing);
    if (plan.action === "resolve") {
      setSaving(true);
      const applied = applyOutcome(plan, await resolveTyped((request) => api.resolvePlace(request), candidate.venue), candidate.venue);
      setSaving(false);
      if (applied.error) {
        showSummary({ "venue.address": applied.error });
        return;
      }
      candidate.venue = applied.venue;
    } else candidate.venue = applyOutcome(plan, null, candidate.venue).venue;
    // Canceling an existing event tells every attendee, so it is confirmed first.
    if (event && status === "cancelled" && event.status !== "cancelled") {
      setConfirmCancel(candidate);
      return;
    }
    await persist(candidate);
  }

  async function persist(candidate: EventDraft) {
    setSaving(true);
    try {
      if (event) await api.updateEvent(event.id, event.revision, candidate, status);
      else await api.createEvent(requestId.current, candidate);
      setSaved(true);
      toast(editing ? t("events.form.saved", { title: candidate.title }) : t("events.form.created", { title: candidate.title }));
      router.push("/events/");
    } catch (error) {
      // A lost response is ambiguous: the server may have applied the edit. Creates are safe to retry (same
      // requestId); edits must reload the saved revision before saving again, per the callable contract.
      const apiError = error instanceof ApiError ? error : new ApiError(
        editing ? "aborted" : "failed-precondition",
        editing
          ? t("events.form.saveUnconfirmed")
          : t("events.form.createFailed"),
      );
      setFailure(apiError);
      if (Object.keys(apiError.fields ?? {}).length) showSummary(apiError.fields);
    } finally {
      setSaving(false);
    }
  }

  const err = (key: string) => errors[key];
  const invalid = (key: string) => (errors[key] ? true : undefined);
  // Enter in a text field never submits (it nearly published half-filled events in the usability study); the form is
  // sent only from Create event or Save changes. Text areas, buttons and widgets that handle Enter themselves are left alone.
  function blockImplicitSubmit(keyEvent: React.KeyboardEvent<HTMLFormElement>) {
    const target = keyEvent.target as HTMLElement;
    if (keyEvent.key === "Enter" && target instanceof HTMLInputElement && !["button", "submit", "checkbox", "radio"].includes(target.type)) keyEvent.preventDefault();
  }

  return (
    <div className="form-layout">
    <form className="form" onSubmit={submit} noValidate onKeyDown={blockImplicitSubmit}>
      {fromAi && <p className="notice form-notice" role="status">{tAi("editor.fromAi")}</p>}
      <p className="hint form-required-note">{t("events.form.requiredNote")}</p>
      {Object.keys(errors).length > 0 && (
        <ErrorSummary ref={summaryRef} title={editing ? t("events.form.fixToSave") : t("events.form.fixToCreate")} items={summaryItems(errors)} />
      )}
      {failure && Object.keys(failure.fields).length === 0 && (
        <InlineNotice tone="error" ref={failureRef} announce={false} title={t("failure.title.save")}
          action={failure.code === "aborted" && onReload ? <Button variant="plain" onClick={onReload}>{t("events.form.reloadLatest")}</Button> : undefined}>
          {saveFailureMessage(failure, Boolean(onReload))}
        </InlineNotice>
      )}
      <div className="section wide">
        <div className="field">
          <label htmlFor="title">{t("events.form.title")}</label>
          <input id="title" aria-describedby={err("title") ? "title-error" : undefined} value={draft.title} maxLength={LIMITS.titleMax} aria-invalid={invalid("title")} onChange={(e) => set("title", e.target.value)} />
          {err("title") && <span className="error" id="title-error">{err("title")}</span>}
        </div>
        <div className="field">
          <label htmlFor="description">{t("events.form.description")}</label>
          <textarea id="description" aria-describedby={err("description") ? "description-error" : undefined} value={draft.description} maxLength={LIMITS.descriptionMax} aria-invalid={invalid("description")} onChange={(e) => set("description", e.target.value)} />
          {err("description") && <span className="error" id="description-error">{err("description")}</span>}
        </div>
        <fieldset className="field">
          <legend>{t("events.form.optional", { label: t("events.form.tags") })}</legend>
          <div className="chips">
            {catalog.status === "loading" && <span className="hint">{t("events.form.tagsLoading")}</span>}
            {catalog.status === "error" && <span className="hint">{t("events.form.tagsFailed")} <button type="button" className="link-btn" onClick={catalog.reload}>{t("common.tryAgain")}</button></span>}
            {tags.map((tag, index) => (
              <ChipToggle key={tag.id} id={index === 0 ? "tags-first" : undefined} pressed={draft.tagIds.includes(tag.id)}
                aria-label={tagCounts ? `${tag.name}, ${interestLabel(tagCounts.get(tag.id) ?? 0)}` : undefined}
                count={tagCounts ? (tagCounts.get(tag.id) ?? 0) : undefined} countTitle={tagCounts ? interestLabel(tagCounts.get(tag.id) ?? 0) : undefined}
                onClick={() => set("tagIds", draft.tagIds.includes(tag.id) ? draft.tagIds.filter((id) => id !== tag.id) : [...draft.tagIds, tag.id])}>
                {tag.name}
              </ChipToggle>
            ))}
          </div>
          {err("tagIds") && <span className="error" id="tags-error">{err("tagIds")}</span>}
        </fieldset>
        <fieldset className="field">
          <legend>{t("events.form.coverImage")}</legend>
          <span className="hint">{t("events.form.coverHint")}</span>
          <CoverPicker value={draft.coverImageURL} onChange={(url, by) => { set("coverImageURL", url); setCoverBy(by === "dipbot" ? url : null); }} dipbotURL={coverBy} firstId="cover-first"
            event={{ title: draft.title, description: draft.description, tagIds: draft.tagIds }}
            describedBy={err("coverImageURL") ? "cover-error" : undefined} invalid={!!err("coverImageURL")} />
          {err("coverImageURL") && <span className="error" id="cover-error">{err("coverImageURL")}</span>}
        </fieldset>
      </div>

      <div className="section wide">
        <h2>{t("events.form.when")}</h2>
        <WhenPicker startTime={draft.startTime} endTime={draft.endTime} disabled={timesLocked} allowPast={editing} presets={presets}
          startError={err("startTime")} endError={err("endTime")}
          onChange={(startTime, endTime) => { setDraft((current) => ({ ...current, startTime, endTime })); clearErrors("startTime", "endTime"); }} />
        <span className="hint">
          {timesLocked
            ? t("events.form.timesLocked")
            : t("events.form.timesLocal")}
        </span>
      </div>

      <WhereSection venue={draft.venue} isOutdoor={draft.isOutdoor} errors={errors} onResolvedFor={(r) => { resolvedFor.current = r; }} onVenue={(patch) => { setDraft((current) => ({ ...current, venue: { ...current.venue, ...patch } })); clearErrors(...Object.keys(patch).flatMap((key) => VENUE_KEYS[key] ?? [])); }}
        onOutdoor={(next) => set("isOutdoor", next)}
        event={{ title: draft.title, description: draft.description, tagIds: draft.tagIds, capacity: draft.capacity, costCents: dollarsToCents(price) }} />

      <div className="section">
        <h2>{t("events.form.costAndSpots")}</h2>
        <div className="row">
          <div className="field"><label htmlFor="price">{t("events.form.optional", { label: t("events.form.price") })}</label>
            <input id="price" aria-describedby={err("costCents") ? "price-error" : undefined} inputMode="decimal" placeholder={t("events.form.pricePlaceholder")} value={price} aria-invalid={invalid("costCents")} onChange={(e) => { setPrice(e.target.value); clearErrors("costCents"); }} />
            {err("costCents") && <span className="error" id="price-error">{err("costCents")}</span>}</div>
          <div className="field"><label htmlFor="capacity">{t("events.form.capacity")}</label>
            <input id="capacity" aria-describedby={err("capacity") ? "capacity-error" : undefined} type="number" min={LIMITS.capacityMin} max={LIMITS.capacityMax} value={Number.isNaN(draft.capacity) ? "" : draft.capacity} aria-invalid={invalid("capacity")} onChange={(e) => set("capacity", e.target.valueAsNumber)} />
            {err("capacity") && <span className="error" id="capacity-error">{err("capacity")}</span>}</div>
        </div>
        <div className="field"><label htmlFor="note">{t("events.form.priceNote")}</label>
          <input id="note" value={draft.costNote} onChange={(e) => set("costNote", e.target.value)} /></div>
      </div>

      {editing && (
        <div className="section">
          <h2>{t("events.form.status")}</h2>
          <div className="field">
            <label htmlFor="status">{t("events.form.eventStatus")}</label>
            <select id="status" value={status} onChange={(e) => setStatus(e.target.value as EventStatus)}>
              <option value="scheduled">{t("events.form.statusScheduled")}</option>
              <option value="cancelled">{t("events.form.statusCanceled")}</option>
            </select>
            <span className="hint">{t("events.form.statusHint")}</span>
          </div>
        </div>
      )}

      <div className="actions">
        <button className="big-pill dark" type="submit" disabled={saving}>{saving ? t("common.saving") : editing ? t("events.form.save") : t("events.form.create")}</button>
        <button className="big-pill gray" type="button" disabled={saving} onClick={() => (dirty ? setDiscarding(true) : router.push("/events/"))}>{t("common.cancel")}</button>
        {!editing && <p className="hint actions-note">{t("events.form.createNote")}</p>}
      </div>
    </form>
    <EventPreview draft={draft} price={price} dipbotCover={!!draft.coverImageURL && coverBy === draft.coverImageURL} />
    {confirmCancel && (
      <Dialog danger title={t("events.form.cancelDialog.title")} confirmLabel={t("events.form.cancelDialog.confirm")} busyLabel={t("events.form.cancelDialog.busy")} onClose={() => setConfirmCancel(null)}
        onConfirm={async () => { await persist(confirmCancel); setConfirmCancel(null); }}>
        <p>{t("events.form.cancelDialog.body", { title: event?.title ?? "" })}</p>
      </Dialog>
    )}
    {discarding && (
      <Dialog danger title={t("events.form.discardDialog.title")} confirmLabel={t("events.form.discardDialog.confirm")} onClose={() => setDiscarding(false)}
        onConfirm={async () => { setSaved(true); router.push("/events/"); }}>
        <p>{editing ? t("events.form.discardDialog.bodyEdit") : t("events.form.discardDialog.bodyNew")}</p>
      </Dialog>
    )}
    </div>
  );
}
