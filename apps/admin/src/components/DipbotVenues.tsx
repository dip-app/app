"use client";
// @i18n-migrated

import { useEffect, useId, useRef, useState } from "react";
import { type CompanyOffice, DEFAULT_RADIUS, type FindVenuesResult, RADIUS_CHOICES, type VenueOption, buildVenueRequest, readRadius, saveRadius } from "@/lib/venues";
import { can } from "@/lib/adminTypes";
import { t, tMaybe, tn } from "@/lib/aiStrings";
import { ApiError } from "@/lib/contract";
import { resetDate } from "@/lib/credits";
import { type LocationProvider, type PlaceSuggestion } from "@/lib/location/types";
import { useApp } from "./AppProvider";
import { AddressCombobox } from "./AddressCombobox";
import { DipbotAction } from "./DipbotAction";
import { DipbotMark } from "./DipbotMark";
import { Button, InlineNotice } from "./kit";
import { useLoad } from "./useLoad";

export interface VenueEvent { title: string; description: string; tagIds: readonly string[]; isOutdoor: boolean; capacity: number; costCents: number }

interface Props {
  event: VenueEvent;
  /** undefined while the office loads, null when it is not set. */
  office: CompanyOffice | null | undefined;
  onOffice: (office: CompanyOffice | null) => void;
  provider: LocationProvider | null;
  /** The office search found Places is off. */
  onUnavailable?: () => void;
  /** The venue the admin clicked; the parent fills the form. */
  onUse: (venue: VenueOption) => void;
  selectedId: string | null;
}

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; result: FindVenuesResult }
  | { kind: "empty"; radius: number }
  | { kind: "message"; text: string }
  /** A failed search: the block stays; `retry` offers the button again. */
  | { kind: "error"; text: string; tone: "warn" | "error"; retry: boolean };

/** Plain words for a failed search; never unmounts the block. `reason` is the server's stable code, `code` the transport code. */
export function venueFailure(error: unknown, resetsAt: string): Extract<Phase, { kind: "error" }> {
  const reason = error instanceof ApiError ? error.reason : undefined;
  const code = error instanceof ApiError ? error.code : undefined;
  if (reason === "AI_VENUES_DISABLED" || reason === "PLACES_DISABLED") return { kind: "error", text: t("venues.disabled"), tone: "warn", retry: true };
  if (reason === "AI_CREDITS_EXHAUSTED" || reason === "VENUE_SEARCH_LIMIT" || reason === "PLACES_LIMIT") {
    const known = tMaybe(`limit.${reason}`, { n: "", date: resetDate(resetsAt) }) ?? t("venues.busy");
    return { kind: "error", text: known, tone: "warn", retry: false };
  }
  if (code === "unauthenticated") return { kind: "error", text: t("venues.signedOut"), tone: "error", retry: false };
  if (code === "permission-denied") return { kind: "error", text: t("venues.denied"), tone: "error", retry: false };
  if (code === "resource-exhausted") return { kind: "error", text: t("venues.busy"), tone: "warn", retry: true };
  return { kind: "error", text: t("venues.error"), tone: "error", retry: true };
}

const metaOf = (v: VenueOption) => [
  tMaybe(`venue.kind.${v.kind}`) ?? t("venue.kind.other"),
  t("venues.radius", { n: v.distanceMiles.toFixed(1) }),
  v.setting === "outdoor" ? t("venue.setting.outdoor") : v.setting === "indoor" ? t("venue.setting.indoor") : "",
].filter(Boolean).join(" · ");

/** The short "why" line, composed from the reason codes the server grounded: never ratings, hours or prices. */
export function whyLine(reasons: readonly string[]): string {
  return reasons.map((r) => tMaybe(`venue.reason.${r}`)).filter((x): x is string => !!x).slice(0, 2).join(" · ");
}

/**
 * "Dipbot venues" under the street field (admins only): Dipbot finds a few places near the company office. It runs only
 * when the admin presses the button, because it uses a credit. Picking one fills the venue fields like an address search.
 */
export function DipbotVenues({ event, office, onOffice, provider, onUnavailable, onUse, selectedId }: Props) {
  const { api, session } = useApp();
  const uid = useId();
  const ctx = useLoad((a) => a.eventIdeaContext(), "event-idea-context").data;
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  useEffect(() => { setRadius(readRadius()); }, []);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [officeDraft, setOfficeDraft] = useState("");
  const [officeState, setOfficeState] = useState<"idle" | "saving" | "error">("idle");
  const [editingOffice, setEditingOffice] = useState(false);
  const run = useRef(0);

  if (!can(session?.role, "ai.generate") || !ctx?.enabled) return null;
  const credits = ctx.credits;
  const cost = credits.creditCost.venueSearch ?? 1;
  const out = credits.creditsRemaining < cost;
  const hasTitle = event.title.trim().length > 0;
  const busy = phase.kind === "loading";

  async function saveOffice(place: PlaceSuggestion, sessionToken: string) {
    setOfficeState("saving");
    try {
      const saved = await api.setCompanyOffice({ placeId: place.placeId, sessionToken });
      onOffice(saved);
      setEditingOffice(false);
      setOfficeDraft("");
      setOfficeState("idle");
      setPhase({ kind: "idle" });
    } catch {
      setOfficeState("error");
    }
  }

  async function find() {
    if (busy || !office) return;
    const request = buildVenueRequest({ ...event, isOutdoor: event.isOutdoor, capacity: event.capacity, costCents: event.costCents }, radius, crypto.randomUUID());
    if (!request) { setPhase({ kind: "message", text: t("venues.needTitle") }); return; }
    const mine = ++run.current;
    setPhase({ kind: "loading" });
    try {
      const result = await api.findVenues(request);
      if (mine !== run.current) return;
      setPhase(result.venues.length === 0 ? { kind: "empty", radius: result.radiusMiles || radius } : { kind: "results", result });
    } catch (error) {
      if (mine !== run.current) return;
      const reason = error instanceof ApiError ? error.reason : undefined;
      if (reason === "OFFICE_NOT_SET") { onOffice(null); setPhase({ kind: "message", text: t("limit.OFFICE_NOT_SET") }); return; }
      setPhase(venueFailure(error, credits.resetsAt));
    }
  }

  const unset = office === null || editingOffice;
  const hintId = `${uid}-hint`;
  const needTitle = !hasTitle && !out;
  return (
    <section className="venues" aria-labelledby={`${uid}-title`}>
      <div className="venues-head">
        <h3 id={`${uid}-title`} className="venues-title"><DipbotMark size={16} />{t("venues.title")}</h3>
        {office && !unset && <button type="button" className="link-btn where-link" onClick={() => setEditingOffice(true)}>{t("venues.changeOffice")}</button>}
      </div>

      {office === undefined ? null : unset ? (
        <div className="venues-office">
          <p className="venues-line">{t("venues.officeUnset")}</p>
          {provider ? (
            <div className="field"><AddressCombobox id={`${uid}-office`} label={t("venues.officeLabel")} hideLabel placeholder={t("venues.officePlaceholder")} value={officeDraft} provider={provider}
              onChange={setOfficeDraft} onSelect={(place, token) => void saveOffice(place, token)} onUnavailable={onUnavailable} /></div>
          ) : <p className="venues-note">{t("venues.officeNoSearch")}</p>}
          <p className="venues-note" role={officeState === "error" ? "alert" : "status"}>
            {officeState === "saving" ? t("venues.officeSaving") : officeState === "error" ? t("venues.officeError") : ""}
          </p>
        </div>
      ) : (
        <>
          <div className="venues-where">
            <label htmlFor={`${uid}-radius`} className="venues-line">{t("venues.near", { address: [office.address, office.locality].filter(Boolean).join(", ") })}</label>
            <select id={`${uid}-radius`} className="venues-radius" aria-label={t("venues.radiusLabel")} value={radius}
              onChange={(e) => { const next = Number(e.target.value); setRadius(next); saveRadius(next); }}>
              {RADIUS_CHOICES.map((r) => <option key={r} value={r}>{t("venues.radius", { n: r })}</option>)}
            </select>
          </div>
          <DipbotAction className="venues-find" label={t("venues.find")} accessibleLabel={t("venues.find")} credits={cost} loading={busy} disabled={out}
            aria-disabled={needTitle || undefined} aria-describedby={needTitle ? hintId : undefined} onClick={() => { if (!needTitle) void find(); }} />
          {out && <p className="venues-note">{t("limit.AI_CREDITS_EXHAUSTED", { date: resetDate(credits.resetsAt) })}</p>}
          {needTitle && <p className="venues-note" id={hintId}>{t("venues.needTitle")}</p>}
        </>
      )}

      <div className="venues-live" role="status" aria-live="polite">
        {phase.kind === "loading" && <p className="venues-note">{t("venues.loading")}</p>}
        {phase.kind === "empty" && <p className="venues-note">{t("venues.empty", { n: phase.radius })}</p>}
        {phase.kind === "message" && <p className="venues-note error">{phase.text}</p>}
        {phase.kind === "error" && (
          <InlineNotice tone={phase.tone} className="venues-notice"
            action={phase.retry ? <Button variant="outline" size="sm" onClick={() => void find()}>{t("venues.retry")}</Button> : undefined}>{phase.text}</InlineNotice>
        )}
        {phase.kind === "results" && <span className="sr-only">{tn("venues.found", phase.result.venues.length, { r: phase.result.radiusMiles })}</span>}
      </div>

      {phase.kind === "results" && (
        <>
          <ul className="venue-list" aria-label={t("venues.listLabel")}>
            {phase.result.venues.slice(0, 5).map((v) => {
              const picked = v.id === selectedId;
              return (
                <li key={v.id}>
                  <button type="button" className={`venue-card${picked ? " selected" : ""}`} aria-pressed={picked} aria-label={t("venues.pick", { name: v.name })} onClick={() => onUse(v)}>
                    <span className="venue-main">
                      <span className="venue-name">{v.name}</span>
                      <span className="venue-meta">{metaOf(v)}</span>
                      {v.reasons.length > 0 && <span className="venue-why">{whyLine(v.reasons)}</span>}
                    </span>
                    <span className="venue-use" aria-hidden>{picked ? t("venues.selected") : t("venues.use")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {phase.result.cached && <p className="venues-note">{t("venues.cached")}</p>}
          <p className="venues-credit" translate="no">{t("where.googleMaps")}</p>
        </>
      )}
    </section>
  );
}
