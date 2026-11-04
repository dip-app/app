"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { COVERS, TAGS } from "@/lib/catalog";
import {
  ApiError, type AdminEvent, type EventDraft, type EventStatus, type FieldErrors, LIMITS,
  emptyDraft, normalizeDraft, validateDraft,
} from "@/lib/contract";
import { centsToDollars, dollarsToCents, isoToLocalInput, localInputToIso } from "@/lib/datetime";
import { useApp } from "./AppProvider";
import { Cover } from "./Cover";
import { Toggle } from "./Toggle";
import { EventPreview } from "./EventPreview";

interface Props {
  /** Present when editing. */
  event?: AdminEvent;
  /** Called when the user asks to discard local edits and reload the latest saved event. */
  onReload?: () => void;
}

const FIELD_IDS: Record<string, string> = {
  title: "title", description: "description", coverImageURL: "cover-first", startTime: "start", endTime: "end",
  "venue.name": "vname", "venue.locality": "vloc", "venue.address": "vaddr", "venue.latitude": "lat",
  "venue.longitude": "lng", costCents: "price", capacity: "capacity",
};

/** Moves focus to the first invalid control, in page order, so keyboard and screen reader users land on it. */
function focusFirstInvalid(found: FieldErrors) {
  const first = Object.keys(FIELD_IDS).find((key) => found[key]);
  if (first) document.getElementById(FIELD_IDS[first])?.focus();
}

export function EventForm({ event, onReload }: Props) {
  const { api } = useApp();
  const router = useRouter();
  const editing = Boolean(event);
  // Mirrors the server rule: once anyone has responded, start and end are locked.
  const timesLocked = editing && (event?.attendeeCount ?? 0) > 0;
  const [draft, setDraft] = useState<EventDraft>(() => (event ? structuredClone(event) : emptyDraft()));
  const [status, setStatus] = useState<EventStatus>(event?.status ?? "scheduled");
  const [price, setPrice] = useState(() => (event ? centsToDollars(event.costCents) : ""));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  // One key per create attempt, kept across retries so a lost response can never create two events.
  const requestId = useRef(crypto.randomUUID());

  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const setVenue = <K extends keyof EventDraft["venue"]>(key: K, value: EventDraft["venue"][K]) =>
    setDraft((current) => ({ ...current, venue: { ...current.venue, [key]: value } }));

  async function submit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault();
    if (saving) return;
    const cents = dollarsToCents(price);
    const candidate: EventDraft = normalizeDraft({ ...draft, costCents: cents });
    const found = validateDraft(candidate, { requireFuture: !editing, minCapacity: event?.attendeeCount });
    if (Number.isNaN(cents)) found.costCents = "Enter a price like 12.50, or leave blank for free.";
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length) {
      focusFirstInvalid(found);
      return;
    }
    setSaving(true);
    try {
      if (event) await api.updateEvent(event.id, event.revision, candidate, status);
      else await api.createEvent(requestId.current, candidate);
      router.push("/events/");
    } catch (error) {
      // A lost response is ambiguous: the server may have applied the edit. Creates are safe to retry (same
      // requestId); edits must reload the saved revision before saving again, per the callable contract.
      const apiError = error instanceof ApiError ? error : new ApiError(
        editing ? "aborted" : "failed-precondition",
        editing
          ? "We couldn’t confirm whether your changes were saved. Reload the latest version to check before saving again."
          : "Couldn’t create the event. Your draft is kept; trying again is safe and won’t create a duplicate.",
      );
      setFailure(apiError);
      if (apiError.fields) setErrors(apiError.fields);
    } finally {
      setSaving(false);
    }
  }

  const err = (key: string) => errors[key];
  const invalid = (key: string) => (errors[key] ? true : undefined);

  return (
    <div className="form-layout">
    <form className="form" onSubmit={submit} noValidate>
      {Object.keys(errors).length > 0 && !failure && (
        <div className="banner error" role="alert">
          <span>Fix {Object.keys(errors).length} {Object.keys(errors).length === 1 ? "field" : "fields"} to continue.</span>
        </div>
      )}
      {failure && (
        <div className="banner error" role="alert">
          <span>{failure.message}</span>
          {failure.code === "aborted" && onReload && (
            <button type="button" className="pill-btn gray" onClick={onReload}>Reload latest</button>
          )}
        </div>
      )}
      <div className="section wide">
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" aria-describedby={err("title") ? "title-error" : undefined} value={draft.title} maxLength={LIMITS.titleMax} aria-invalid={invalid("title")} onChange={(e) => set("title", e.target.value)} />
          {err("title") && <span className="error" id="title-error">{err("title")}</span>}
        </div>
        <div className="field">
          <label htmlFor="description">Description</label>
          <textarea id="description" aria-describedby={err("description") ? "description-error" : undefined} value={draft.description} maxLength={LIMITS.descriptionMax} aria-invalid={invalid("description")} onChange={(e) => set("description", e.target.value)} />
          {err("description") && <span className="error" id="description-error">{err("description")}</span>}
        </div>
        <fieldset className="field">
          <legend>Tags</legend>
          <div className="chips">
            {TAGS.map((tag) => (
              <button key={tag.id} type="button" className="chip" aria-pressed={draft.tagIds.includes(tag.id)}
                onClick={() => set("tagIds", draft.tagIds.includes(tag.id) ? draft.tagIds.filter((t) => t !== tag.id) : [...draft.tagIds, tag.id])}>
                {tag.name}
              </button>
            ))}
          </div>
          {err("tagIds") && <span className="error" id="tags-error">{err("tagIds")}</span>}
        </fieldset>
        <fieldset className="field">
          <legend>Cover image</legend>
          <span className="hint">Pick from the default catalog. Photo uploads aren’t part of V1.</span>
          <div className="covers">
            {COVERS.map((cover) => (
              <button key={cover.id} id={cover.id === COVERS[0].id ? "cover-first" : undefined} type="button" className="cover-option" aria-pressed={draft.coverImageURL === cover.url} onClick={() => set("coverImageURL", cover.url)}>
                <Cover url={cover.url} className="swatch" eager />
                <span>{cover.label}</span>
              </button>
            ))}
          </div>
          {err("coverImageURL") && <span className="error" id="cover-error">{err("coverImageURL")}</span>}
        </fieldset>
      </div>

      <div className="section">
        <h2>When</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="start">Starts</label>
            <input id="start" aria-describedby={err("startTime") ? "start-error" : undefined} type="datetime-local" disabled={timesLocked} value={isoToLocalInput(draft.startTime)} aria-invalid={invalid("startTime")} onChange={(e) => set("startTime", localInputToIso(e.target.value))} />
            {err("startTime") && <span className="error" id="start-error">{err("startTime")}</span>}
          </div>
          <div className="field">
            <label htmlFor="end">Ends</label>
            <input id="end" aria-describedby={err("endTime") ? "end-error" : undefined} type="datetime-local" disabled={timesLocked} value={isoToLocalInput(draft.endTime)} aria-invalid={invalid("endTime")} onChange={(e) => set("endTime", localInputToIso(e.target.value))} />
            {err("endTime") && <span className="error" id="end-error">{err("endTime")}</span>}
          </div>
        </div>
        <span className="hint">
          {timesLocked
            ? "Times are locked because people have responded. Cancel and recreate the event to change them."
            : "Times are entered in your local time zone and stored in UTC."}
        </span>
      </div>

      <div className="section">
        <h2>Where</h2>
        <div className="row">
          <div className="field"><label htmlFor="vname">Venue name</label>
            <input id="vname" aria-describedby={err("venue.name") ? "vname-error" : undefined} value={draft.venue.name} aria-invalid={invalid("venue.name")} onChange={(e) => setVenue("name", e.target.value)} />
            {err("venue.name") && <span className="error" id="vname-error">{err("venue.name")}</span>}</div>
          <div className="field"><label htmlFor="vloc">City / area</label>
            <input id="vloc" aria-describedby={err("venue.locality") ? "vloc-error" : undefined} value={draft.venue.locality} aria-invalid={invalid("venue.locality")} onChange={(e) => setVenue("locality", e.target.value)} />
            {err("venue.locality") && <span className="error" id="vloc-error">{err("venue.locality")}</span>}</div>
        </div>
        <div className="field"><label htmlFor="vaddr">Street address</label>
          <input id="vaddr" aria-describedby={err("venue.address") ? "vaddr-error" : undefined} value={draft.venue.address} aria-invalid={invalid("venue.address")} onChange={(e) => setVenue("address", e.target.value)} />
          {err("venue.address") && <span className="error" id="vaddr-error">{err("venue.address")}</span>}</div>
        <div className="row">
          <div className="field"><label htmlFor="lat">Latitude</label>
            <input id="lat" aria-describedby={err("venue.latitude") ? "lat-error" : undefined} type="number" step="any" value={draft.venue.latitude} aria-invalid={invalid("venue.latitude")} onChange={(e) => setVenue("latitude", e.target.valueAsNumber)} />
            {err("venue.latitude") && <span className="error" id="lat-error">{err("venue.latitude")}</span>}</div>
          <div className="field"><label htmlFor="lng">Longitude</label>
            <input id="lng" aria-describedby={err("venue.longitude") ? "lng-error" : undefined} type="number" step="any" value={draft.venue.longitude} aria-invalid={invalid("venue.longitude")} onChange={(e) => setVenue("longitude", e.target.valueAsNumber)} />
            {err("venue.longitude") && <span className="error" id="lng-error">{err("venue.longitude")}</span>}</div>
        </div>
        <Toggle checked={draft.isOutdoor} onChange={(next) => set("isOutdoor", next)} label="Outdoor event" hint="Shown to members so they can plan for the weather." />
      </div>

      <div className="section">
        <h2>Cost &amp; spots</h2>
        <div className="row">
          <div className="field"><label htmlFor="price">Price (USD)</label>
            <input id="price" aria-describedby={err("costCents") ? "price-error" : undefined} inputMode="decimal" placeholder="Free" value={price} aria-invalid={invalid("costCents")} onChange={(e) => setPrice(e.target.value)} />
            {err("costCents") && <span className="error" id="price-error">{err("costCents")}</span>}</div>
          <div className="field"><label htmlFor="capacity">Capacity</label>
            <input id="capacity" aria-describedby={err("capacity") ? "capacity-error" : undefined} type="number" min={LIMITS.capacityMin} max={LIMITS.capacityMax} value={Number.isNaN(draft.capacity) ? "" : draft.capacity} aria-invalid={invalid("capacity")} onChange={(e) => set("capacity", e.target.valueAsNumber)} />
            {err("capacity") && <span className="error" id="capacity-error">{err("capacity")}</span>}</div>
        </div>
        <div className="field"><label htmlFor="note">Price note (optional)</label>
          <input id="note" value={draft.costNote} onChange={(e) => set("costNote", e.target.value)} /></div>
      </div>

      {editing && (
        <div className="section">
          <h2>Status</h2>
          <div className="field">
            <label htmlFor="status">Event status</label>
            <select id="status" value={status} onChange={(e) => setStatus(e.target.value as EventStatus)}>
              <option value="scheduled">Scheduled</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <span className="hint">Events can’t be deleted in V1. Cancelling keeps the record and tells attendees.</span>
          </div>
        </div>
      )}

      <div className="actions">
        <button className="big-pill dark" type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Create event"}</button>
        <button className="big-pill gray" type="button" disabled={saving} onClick={() => router.push("/events/")}>Cancel</button>
      </div>
    </form>
    <EventPreview draft={draft} price={price} />
    </div>
  );
}
