"use client";

import { type KeyboardEvent, type Ref, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { t, tn } from "@/lib/aiStrings";
import { highlightParts } from "@/lib/location/highlight";
import { LocationError, type LocationProvider, type PlaceSuggestion, type ResolvedPlace, isAbort } from "@/lib/location/types";

export const MIN_CHARS = 3;
export const DEBOUNCE_MS = 300;
export const MAX_RESULTS = 5;

type Status = "idle" | "loading" | "results" | "empty" | "error" | "limit" | "gone";

export interface AddressComboboxHandle { focus: () => void }

interface Props {
  /** DOM id of the input (focus target for "fix this field"). */
  id: string;
  label: string;
  value: string;
  /** Called for every edit the admin types (not when a result is picked). */
  onChange: (text: string) => void;
  /** Called with the picked result after resolvePlaceV1 (placeId + session token) answered. */
  onPick?: (place: ResolvedPlace, suggestion: PlaceSuggestion) => void;
  /** Instead of onPick: the raw pick and its session token, with no resolve here (the office setup lets the server resolve). */
  onSelect?: (suggestion: PlaceSuggestion, sessionToken: string) => void;
  provider: LocationProvider;
  /** Places is off for this company: the parent switches to plain fields. */
  onUnavailable?: () => void;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  /** Show the visible label above the input (the Where section does; the office setup uses aria-label only). */
  hideLabel?: boolean;
  handle?: Ref<AddressComboboxHandle>;
}

/** Bold the words the admin typed inside a result line. */
function Highlight({ text, query }: { text: string; query: string }) {
  return <>{highlightParts(text, query).map((part, i) => (part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}</>;
}

function PinIcon() {
  return (
    <svg className="ac-pin" viewBox="0 0 24 24" width="16" height="16" aria-hidden focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 1 1 13 0C18.5 15.4 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.3" />
    </svg>
  );
}

/**
 * Address typeahead following the ARIA 1.2 combobox pattern with a list popup: the input is the combobox (it keeps focus),
 * the popup is a listbox of options reached through aria-activedescendant. Searches after 3 characters and a 250 ms pause,
 * cancels the request in flight when the text changes, and keeps free typing working at every step.
 */
export function AddressCombobox({ id, label, value, onChange, onPick, onSelect, onUnavailable, provider, placeholder, invalid, describedBy, hideLabel, handle }: Props) {
  const uid = useId();
  const listId = `${uid}-list`;
  const statusId = `${uid}-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(handle, () => ({ focus: () => inputRef.current?.focus() }), []);

  // `term` changes only on typing, so picking a result (which rewrites `value`) never starts another search.
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  // Places is not turned on (PLACES_DISABLED): the input stays and works as a plain field, with a small note under it.
  const [off, setOff] = useState(false);

  // One session token per typing session: results and the resolve that ends it share it; a pick, clearing or leaving starts a new one.
  const tokenRef = useRef<string | null>(null);
  const resultsToken = useRef("");
  const seq = useRef(0);
  const rotate = () => { tokenRef.current = null; };
  const bump = () => { seq.current++; };

  const query = term.trim();
  useEffect(() => {
    if (off || query.length < MIN_CHARS) { setStatus("idle"); setResults([]); setActive(-1); return; }
    const controller = new AbortController();
    const mine = ++seq.current; // callables cannot be cancelled: a late answer is ignored by sequence
    const timer = setTimeout(() => {
      setStatus("loading");
      setActive(-1);
      const token = (tokenRef.current ??= crypto.randomUUID());
      provider.autocomplete(query, { sessionToken: token, signal: controller.signal }).then(
        (found) => {
          if (controller.signal.aborted || mine !== seq.current) return;
          const list = found.slice(0, MAX_RESULTS);
          resultsToken.current = token;
          setResults(list);
          setStatus(list.length ? "results" : "empty");
        },
        (failure: unknown) => {
          if (controller.signal.aborted || mine !== seq.current || isAbort(failure)) return;
          setResults([]);
          if (failure instanceof LocationError && failure.kind === "disabled") { setOff(true); setStatus("idle"); onUnavailable?.(); return; }
          setStatus(failure instanceof LocationError && failure.kind === "limit" ? "limit" : "error");
        },
      );
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); bump(); };
  }, [query, provider, off]); // eslint-disable-line react-hooks/exhaustive-deps -- onUnavailable and bump are stable enough

  const showOptions = open && status === "results";
  const showPopup = open && status !== "idle";
  const optionId = (index: number) => `${uid}-opt-${index}`;

  const finish = () => { setOpen(false); setActive(-1); setStatus("idle"); setTerm(""); setResults([]); rotate(); };
  const pick = useCallback(async (suggestion: PlaceSuggestion) => {
    const token = resultsToken.current;
    if (onSelect) { finish(); onSelect(suggestion, token); return; }
    setResolving(true);
    try {
      const place = await provider.resolve({ placeId: suggestion.placeId, sessionToken: token });
      if (!place) { setStatus("gone"); return; }
      finish();
      onPick?.(place, suggestion);
    } catch (failure) {
      if (failure instanceof LocationError && failure.kind === "disabled") { setOff(true); onUnavailable?.(); return; }
      setStatus(failure instanceof LocationError ? (failure.kind === "limit" ? "limit" : failure.kind === "notFound" ? "gone" : "error") : "error");
    } finally {
      setResolving(false);
    }
  }, [provider, onPick, onSelect, onUnavailable]); // eslint-disable-line react-hooks/exhaustive-deps -- finish only touches state setters and a ref

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (status !== "results" || results.length === 0) return;
        event.preventDefault();
        if (!open) { setOpen(true); setActive(event.key === "ArrowDown" ? 0 : results.length - 1); return; }
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((current) => (current < 0 ? (step === 1 ? 0 : results.length - 1) : (current + step + results.length) % results.length));
        return;
      }
      case "Enter":
        // A picked option wins; with the list open and nothing active, Enter never submits the form by accident.
        if (showOptions) { event.preventDefault(); if (active >= 0 && results[active]) void pick(results[active]); }
        return;
      case "Escape":
        if (showPopup) { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1); }
        return;
      default:
    }
  }

  const announcement = status === "loading" ? t("where.loading") : status === "results" ? tn("where.results", results.length) : status === "empty" ? t("where.empty") : status === "limit" ? t("where.limit") : status === "gone" ? t("where.notFound") : status === "error" ? t("where.error") : "";

  return (
    <div className="ac">
      <label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>{label}</label>
      <div className="ac-box">
      <input
        ref={inputRef}
        id={id}
        className="ac-input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showOptions}
        aria-controls={listId}
        aria-activedescendant={showOptions && active >= 0 ? optionId(active) : undefined}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={[describedBy, statusId].filter(Boolean).join(" ") || undefined}
        aria-busy={resolving || undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setTerm(e.target.value); setOpen(true); if (!e.target.value.trim()) rotate(); }}
        onFocus={() => { if (status === "results") setOpen(true); }}
        onBlur={() => { setOpen(false); setActive(-1); rotate(); }}
        onKeyDown={onKeyDown}
      />
      <span id={statusId} className="sr-only" role="status" aria-live="polite">{open ? announcement : ""}</span>
      {/* The popup keeps the input focused: pressing inside it never moves focus. */}
      <div className="ac-popup" hidden={!showPopup} onMouseDown={(e) => e.preventDefault()}>
        <ul id={listId} role="listbox" aria-label={label} className="ac-list" hidden={!showOptions}>
          {results.map((place, index) => (
            <li
              key={`${place.placeId}-${index}`}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              className={`ac-option${index === active ? " active" : ""}`}
              onMouseMove={() => { if (active !== index) setActive(index); }}
              onClick={() => void pick(place)}
            >
              <PinIcon />
              <span className="ac-text">
                <span className="ac-primary"><Highlight text={place.primary} query={query} /></span>
                {place.secondary && <span className="ac-secondary"><Highlight text={place.secondary} query={query} /></span>}
              </span>
            </li>
          ))}
        </ul>
        {open && status === "loading" && <p className="ac-msg">{t("where.loading")}</p>}
        {open && status === "empty" && <p className="ac-msg">{t("where.empty")}</p>}
        {open && status === "error" && <p className="ac-msg error">{t("where.error")}</p>}
        {open && status === "limit" && <p className="ac-msg">{t("where.limit")}</p>}
        {open && status === "gone" && <p className="ac-msg error">{t("where.notFound")}</p>}
        {/* Google Maps Platform attribution: results are not shown on a Google map. */}
        <p className="ac-credit" translate="no">{t("where.googleMaps")}</p>
      </div>
      {off && <p className="ac-note" role="status">{t("where.manualNote")}</p>}
      </div>
    </div>
  );
}
