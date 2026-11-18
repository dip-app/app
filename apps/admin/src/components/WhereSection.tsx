"use client";
// @i18n-migrated

import { useEffect, useMemo, useRef, useState } from "react";
import type { FieldErrors, Venue } from "@/lib/contract";
import { t } from "@/lib/aiStrings";
import { t as tI } from "@/lib/i18n";
import { type LocationProvider, type PlaceSuggestion, type ResolvedPlace, createCallableProvider } from "@/lib/location";
import type { ResolvedFor } from "@/lib/location/saveLocation";
import { type VenueFill, placeToVenue, venueOptionToVenue } from "@/lib/location/venueFill";
import type { CompanyOffice, VenueOption } from "@/lib/venues";
import { useApp } from "./AppProvider";
import { AddressCombobox, type AddressComboboxHandle } from "./AddressCombobox";
import { DipbotPickedTag } from "./DipbotPickedTag";
import { DipbotVenues, type VenueEvent } from "./DipbotVenues";
import { Toggle } from "./Toggle";
import { useLoad } from "./useLoad";

interface Props {
  venue: Venue;
  isOutdoor: boolean;
  errors: FieldErrors;
  /** Merge these fields into the event's venue. */
  onVenue: (patch: Partial<Venue>) => void;
  onOutdoor: (next: boolean) => void;
  /** Tells the form which text the venue's hidden coordinates now belong to (a pick), so the save step can keep them. */
  onResolvedFor?: (resolved: ResolvedFor) => void;
  /** What Dipbot venues sends: the rest of the form. */
  event: Omit<VenueEvent, "isOutdoor">;
  /** Tests and previews can pass a provider (null: Places is not set up); the app uses the callables. */
  provider?: LocationProvider | null;
}

/**
 * The Where section of the event editor: address search first, then the venue fields prefilled and editable. The map position
 * is never shown or typed: it is resolved on a pick and, for typed text, when the form is saved (lib/location/saveLocation.ts).
 */
export function WhereSection({ venue, isOutdoor, errors, onVenue, onOutdoor, onResolvedFor, event, provider: given }: Props) {
  const { api } = useApp();
  const callable = useMemo(() => createCallableProvider(api), [api]);
  // Places off for this company (PLACES_DISABLED): the combobox stays mounted (focus and typed text kept), acts as a plain field and
  // shows its own note; the event is saved without a map location.
  const [off, setOff] = useState(false);
  const provider = given === undefined ? callable : given;
  const search = useRef<AddressComboboxHandle>(null);
  const officeLoad = useLoad(async (a) => ({ office: await a.companyOffice() }), "company-office");
  const office: CompanyOffice | null | undefined = officeLoad.error ? null : officeLoad.data ? officeLoad.data.office : undefined;

  const [picked, setPicked] = useState<{ primary: string; secondary: string; street: string } | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [dipbotOutdoor, setDipbotOutdoor] = useState(false);
  // After a pick the summary row replaces the search input; "Change" brings the input back, prefilled and focused.
  const [changing, setChanging] = useState(false);
  const refocus = useRef(false);
  useEffect(() => { if (changing && refocus.current) { refocus.current = false; search.current?.focus(); } }, [changing]);

  function apply(fill: VenueFill, id: string | null) {
    onVenue(fill.patch);
    onResolvedFor?.({ address: fill.patch.address, locality: fill.patch.locality });
    setPicked({ primary: fill.primary, secondary: fill.secondary, street: fill.patch.address });
    setVenueId(id);
    // An obviously outdoor place turns Outdoor on and says Dipbot did; any other pick takes the tag away but leaves the toggle.
    if (fill.outdoor) onOutdoor(true);
    setDipbotOutdoor(fill.outdoor);
    setChanging(false);
  }
  const onPick = (place: ResolvedPlace, suggestion: PlaceSuggestion) => apply(placeToVenue(place, venue, suggestion), null);
  const onUseVenue = (option: VenueOption) => apply(venueOptionToVenue(option), option.id);

  // Typing in the street field after a pick drops the hidden position (the save step looks the new text up) but keeps what was typed.
  const onStreet = (text: string) => {
    onVenue(picked && text !== picked.street ? { address: text, placeId: null, latitude: Number.NaN, longitude: Number.NaN } : { address: text });
  };

  const showSummary = !!picked && picked.street === venue.address;
  const err = (key: string) => errors[key];
  const invalid = (key: string) => (errors[key] ? true : undefined);
  const addressError = err("venue.address") || err("venue.coordinates") || err("venue.latitude") || err("venue.longitude");
  // The summary replaces the search while the pick stands; an address error brings the input back.
  const collapsed = showSummary && !changing && !addressError;

  return (
    <div className="section where">
      <h2>{tI("editor.where.title")}</h2>

      {collapsed && picked ? (
        <div className="where-picked" role="group" aria-label={t("where.pickedLabel")}>
          <svg className="ac-pin" viewBox="0 0 24 24" width="16" height="16" aria-hidden focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 1 1 13 0C18.5 15.4 12 21 12 21z" /><circle cx="12" cy="10.5" r="2.3" />
          </svg>
          <span className="where-picked-text">
            <span className="where-picked-primary">{picked.primary}</span>
            {picked.secondary && <span className="where-picked-secondary">{picked.secondary}</span>}
          </span>
          <button type="button" className="link-btn where-link" aria-label={t("where.changeAria")} onClick={() => { refocus.current = true; setChanging(true); }}>{t("where.change")}</button>
        </div>
      ) : (
        <div className="field where-address">
          {provider ? (
            <AddressCombobox id="vaddr" label={t("where.address")} value={venue.address} provider={provider} placeholder={t("where.searchPlaceholder")}
              invalid={!!addressError} describedBy={addressError ? "vaddr-error" : undefined} handle={search}
              onChange={onStreet} onPick={onPick} onUnavailable={() => setOff(true)} />
          ) : (
            <>
              <label htmlFor="vaddr">{t("where.address")}</label>
              <input id="vaddr" value={venue.address} aria-invalid={invalid("venue.address")} aria-describedby={addressError ? "vaddr-error" : undefined}
                onChange={(e) => onStreet(e.target.value)} />
            </>
          )}
          {addressError ? <span className="error" id="vaddr-error">{addressError}</span> : <span className="hint">{provider ? (off ? null : t("where.searchHint")) : t("where.noMapLocation")}</span>}
        </div>
      )}

      <div className="row">
        <div className="field"><label htmlFor="vname">{t("where.venueName")}</label>
          <input id="vname" aria-describedby={err("venue.name") ? "vname-error" : undefined} value={venue.name} aria-invalid={invalid("venue.name")} onChange={(e) => { onVenue({ name: e.target.value }); setVenueId(null); }} />
          {err("venue.name") && <span className="error" id="vname-error">{err("venue.name")}</span>}</div>
        <div className="field"><label htmlFor="vloc">{t("where.locality")}</label>
          <input id="vloc" aria-describedby={err("venue.locality") ? "vloc-error" : undefined} value={venue.locality} aria-invalid={invalid("venue.locality")} onChange={(e) => onVenue({ locality: e.target.value })} />
          {err("venue.locality") && <span className="error" id="vloc-error">{err("venue.locality")}</span>}</div>
      </div>

      <Toggle checked={isOutdoor} onChange={(next) => { onOutdoor(next); setDipbotOutdoor(false); }} label={t("where.outdoor")} hint={t("where.outdoorHint")}
        badge={dipbotOutdoor && isOutdoor ? <DipbotPickedTag /> : undefined} />

      <DipbotVenues event={{ ...event, isOutdoor }} office={office} onOffice={(next) => officeLoad.setData({ office: next })} provider={provider}
        onUnavailable={() => setOff(true)} onUse={onUseVenue} selectedId={venueId} />
    </div>
  );
}
