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

interface Props {
  /** Present when editing. */
  event?: AdminEvent;
  /** Called when the user asks to discard local edits and reload the latest saved event. */
  onReload?: () => void;
}

export function EventForm({ event, onReload }: Props) {
  const { api } = useApp();
  const router = useRouter();
  const editing = Boolean(event);
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
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      if (event) await api.updateEvent(event.id, event.revision, candidate, status);
      else await api.createEvent(requestId.current, candidate);
      router.push("/events/");
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError("failed-precondition", "Couldn’t save. Your changes are still here, so you can try again.");
      setFailure(apiError);
      if (apiError.fields) setErrors(apiError.fields);
    } finally {
      setSaving(false);
    }
  }

  const err = (key: string) => errors[key];
  const invalid = (key: string) => (errors[key] ? true : undefined);

  return (
    <form className="form" onSubmit={submit} noValidate>
      {failure && (
        <div className="banner error" role="alert">
          <span>{failure.message}</span>
          {failure.code === "aborted" && onReload && (
            <button type="button" className="btn ghost" onClick={onReload}>Reload latest</button>
          )}
        </div>
      )}
      <div className="panel">
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" value={draft.title} maxLength={LIMITS.titleMax} aria-invalid={invalid("title")} onChange={(e) => set("title", e.target.value)} />
          {err("title") && <span className="error">{err("title")}</span>}
        </div>
        <div className="field">
          <label htmlFor="description">Description</label>
          <textarea id="description" value={draft.description} maxLength={LIMITS.descriptionMax} aria-invalid={invalid("description")} onChange={(e) => set("description", e.target.value)} />
          {err("description") && <span className="error">{err("description")}</span>}
        </div>
        <fieldset className="field">
          <legend>Tags</legend>
          <div className="chips">
            {TAGS.map((tag) => (
              <button key={tag} type="button" className="chip" aria-pressed={draft.tagIds.includes(tag)}
                onClick={() => set("tagIds", draft.tagIds.includes(tag) ? draft.tagIds.filter((t) => t !== tag) : [...draft.tagIds, tag])}>
                {tag}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <legend>Cover image</legend>
          <span className="hint">Pick from the default catalog. Photo uploads aren’t part of V1.</span>
          <div className="covers">
            {COVERS.map((cover) => (
              <button key={cover.id} type="button" className="cover-option" aria-pressed={draft.coverImageURL === cover.url} onClick={() => set("coverImageURL", cover.url)}>
                <div className="swatch" style={{ background: `linear-gradient(135deg, ${cover.from}, ${cover.to})` }} />
                <span>{cover.label}</span>
              </button>
            ))}
          </div>
          {err("coverImageURL") && <span className="error">{err("coverImageURL")}</span>}
        </fieldset>
      </div>

      <div className="panel">
        <h2>When</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="start">Starts</label>
            <input id="start" type="datetime-local" value={isoToLocalInput(draft.startTime)} aria-invalid={invalid("startTime")} onChange={(e) => set("startTime", localInputToIso(e.target.value))} />
            {err("startTime") && <span className="error">{err("startTime")}</span>}
          </div>
          <div className="field">
            <label htmlFor="end">Ends</label>
            <input id="end" type="datetime-local" value={isoToLocalInput(draft.endTime)} aria-invalid={invalid("endTime")} onChange={(e) => set("endTime", localInputToIso(e.target.value))} />
            {err("endTime") && <span className="error">{err("endTime")}</span>}
          </div>
        </div>
        <span className="hint">Times are entered in your local time zone and stored in UTC.</span>
      </div>

      <div className="panel">
        <h2>Where</h2>
        <div className="row">
          <div className="field"><label htmlFor="vname">Venue name</label>
            <input id="vname" value={draft.venue.name} aria-invalid={invalid("venue.name")} onChange={(e) => setVenue("name", e.target.value)} />
            {err("venue.name") && <span className="error">{err("venue.name")}</span>}</div>
          <div className="field"><label htmlFor="vloc">City / area</label>
            <input id="vloc" value={draft.venue.locality} aria-invalid={invalid("venue.locality")} onChange={(e) => setVenue("locality", e.target.value)} />
            {err("venue.locality") && <span className="error">{err("venue.locality")}</span>}</div>
        </div>
        <div className="field"><label htmlFor="vaddr">Street address</label>
          <input id="vaddr" value={draft.venue.address} aria-invalid={invalid("venue.address")} onChange={(e) => setVenue("address", e.target.value)} />
          {err("venue.address") && <span className="error">{err("venue.address")}</span>}</div>
        <div className="row">
          <div className="field"><label htmlFor="lat">Latitude</label>
            <input id="lat" type="number" step="any" value={draft.venue.latitude} aria-invalid={invalid("venue.latitude")} onChange={(e) => setVenue("latitude", e.target.valueAsNumber)} />
            {err("venue.latitude") && <span className="error">{err("venue.latitude")}</span>}</div>
          <div className="field"><label htmlFor="lng">Longitude</label>
            <input id="lng" type="number" step="any" value={draft.venue.longitude} aria-invalid={invalid("venue.longitude")} onChange={(e) => setVenue("longitude", e.target.valueAsNumber)} />
            {err("venue.longitude") && <span className="error">{err("venue.longitude")}</span>}</div>
        </div>
        <label className="chip" style={{ width: "fit-content" }}>
          <input type="checkbox" checked={draft.isOutdoor} onChange={(e) => set("isOutdoor", e.target.checked)} style={{ width: "auto", minHeight: 0, marginRight: 8 }} />
          Outdoor event
        </label>
      </div>

      <div className="panel">
        <h2>Cost & spots</h2>
        <div className="row">
          <div className="field"><label htmlFor="price">Price (USD)</label>
            <input id="price" inputMode="decimal" placeholder="Free" value={price} aria-invalid={invalid("costCents")} onChange={(e) => setPrice(e.target.value)} />
            {err("costCents") && <span className="error">{err("costCents")}</span>}</div>
          <div className="field"><label htmlFor="capacity">Capacity</label>
            <input id="capacity" type="number" min={LIMITS.capacityMin} max={LIMITS.capacityMax} value={Number.isNaN(draft.capacity) ? "" : draft.capacity} aria-invalid={invalid("capacity")} onChange={(e) => set("capacity", e.target.valueAsNumber)} />
            {err("capacity") && <span className="error">{err("capacity")}</span>}</div>
        </div>
        <div className="field"><label htmlFor="note">Price note (optional)</label>
          <input id="note" value={draft.costNote} onChange={(e) => set("costNote", e.target.value)} /></div>
      </div>

      {editing && (
        <div className="panel">
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
        <button className="btn dark" type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Create event"}</button>
        <button className="btn ghost" type="button" disabled={saving} onClick={() => router.push("/events/")}>Cancel</button>
      </div>
    </form>
  );
}
