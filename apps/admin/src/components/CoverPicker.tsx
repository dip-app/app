"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { COVER_LIBRARY, THEMES, buildPickRequest, type CoverEntry, type CoverPhotoCandidate, type CoverThemeKey, coverByURL, coverImage, coverThumb, rememberCoverAlt, searchCovers, themeLabel } from "@/lib/covers";
import type { AiCredits } from "@/lib/adminTypes";
import { tMaybe } from "@/lib/aiStrings";
import { ApiError } from "@/lib/contract";
import { creditsText, resetDate } from "@/lib/credits";
import { useApp } from "./AppProvider";
import { DipbotCoverTag } from "./DipbotCoverTag";
import { DipbotMark } from "./DipbotMark";

export interface CoverPickerEvent { title: string; description?: string; tagIds?: readonly string[]; theme?: CoverThemeKey }

interface Props {
  value: string;
  /** `by: "dipbot"` marks a cover Dipbot chose; any manual choice calls it without. */
  onChange: (url: string, by?: "dipbot") => void;
  /** The cover Dipbot picked, when the parent tracks it (a Dipbot draft prefill). Without it, the picker tracks its own "Let Dipbot choose" result. */
  dipbotURL?: string | null;
  event: CoverPickerEvent;
  /** Covers already used by sibling drafts; Dipbot avoids them. */
  excludeURLs?: readonly string[];
  label?: string;
  compact?: boolean;
  /** DOM id for the first tile (focus target for "fix this field"). */
  firstId?: string;
  describedBy?: string;
  invalid?: boolean;
  /** Dipbot credits when the page already has them (Ideas); the pick costs `creditCost.coverPick`, 1 credit otherwise. */
  credits?: AiCredits;
}

/** "Search more photos" results live in component state only: Pixabay previews may be shown temporarily, never persisted. */
type More = { kind: "idle" } | { kind: "loading" } | { kind: "results"; candidates: CoverPhotoCandidate[] } | { kind: "message"; text: string };
const MORE_UNAVAILABLE = "More photos are not available right now. Try again later.";

type Note = { kind: "picked"; text: string; badge: string; dipbot: boolean; fresh?: boolean; url?: string } | { kind: "error"; text: string } | null;

/** Thumbnails above this index lazy-load inside the scroll region; the first screenful loads eagerly so tiles are never blank. */
const EAGER_THUMBS = 16;

function CheckMark() {
  return (
    <svg className="cp-check" viewBox="0 0 18 18" width="18" height="18" aria-hidden focusable="false">
      <circle cx="9" cy="9" r="9" fill="currentColor" />
      <path d="M5.2 9.3l2.4 2.4 5.2-5.4" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Searchable cover library: preview, text search, theme filter and a thumbnail grid in its own scroll region, plus "Let Dipbot choose". */
export function CoverPicker({ value, onChange, dipbotURL, event, excludeURLs, label = "Cover image", compact = false, firstId, describedBy, invalid, credits }: Props) {
  const { api } = useApp();
  const uid = useId();
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<CoverThemeKey | "">("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [more, setMore] = useState<More>({ kind: "idle" });
  const [importing, setImporting] = useState<string | null>(null);
  const [moreError, setMoreError] = useState("");
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = coverByURL(value);
  const shown = useMemo(() => searchCovers({ query, theme }), [query, theme]);
  const themeCounts = useMemo(() => THEMES.map((t) => ({ ...t, count: searchCovers({ query, theme: t.key }).length })), [query]);
  const total = useMemo(() => searchCovers({ query }).length, [query]);
  const stop = shown.find((c) => c.url === selected?.url)?.url ?? shown[0]?.url;

  // A picked note describes one cover: drop it when the value changes by other means (parent reset, edits elsewhere).
  useEffect(() => { setNote((n) => (n?.kind === "picked" && n.url && n.url !== value ? null : n)); }, [value]);

  const choose = (url: string) => { onChange(url); setNote(null); };
  // "Dipbot picked this" shows only while Dipbot's pick is still the cover; choosing anything else clears it.
  const byDipbot = dipbotURL !== undefined ? !!value && dipbotURL === value : note?.kind === "picked" && note.dipbot && note.url === value;

  function move(event_: React.KeyboardEvent) {
    const at = shown.findIndex((c) => c.url === (document.activeElement as HTMLElement | null)?.dataset.url);
    const here = at < 0 ? shown.findIndex((c) => c.url === stop) : at;
    const first = refs.current[shown[0]?.url ?? ""];
    const cols = first ? shown.filter((c) => refs.current[c.url]?.offsetTop === first.offsetTop).length : 1;
    const step = cols > 0 && cols < shown.length ? cols : 1;
    let next = -1;
    switch (event_.key) {
      case "ArrowRight": next = Math.min(here + 1, shown.length - 1); break;
      case "ArrowLeft": next = Math.max(here - 1, 0); break;
      case "ArrowDown": next = Math.min(here + step, shown.length - 1); break;
      case "ArrowUp": next = Math.max(here - step, 0); break;
      case "Home": next = 0; break;
      case "End": next = shown.length - 1; break;
      default: return;
    }
    event_.preventDefault();
    if (next < 0 || !shown[next]) return;
    const to = shown[next].url;
    choose(to);
    refs.current[to]?.focus();
  }

  async function dipbotPick() {
    if (busy) return;
    const request = buildPickRequest(event, excludeURLs ?? []);
    if (!request) { setNote({ kind: "error", text: "Add a title first so Dipbot knows what the event is." }); return; }
    setBusy(true);
    setNote(null);
    try {
      const result = await api.pickEventCover(request);
      const entry = coverByURL(result.coverImageURL);
      if (!entry) { setNote({ kind: "error", text: "Dipbot suggested a cover this portal doesn’t have yet. Pick one below." }); return; }
      rememberCoverAlt(entry.url, result.coverAlt);
      const dipbot = result.source === "dipbot" || result.source === "match";
      onChange(entry.url, dipbot ? "dipbot" : undefined);
      setNote({
        kind: "picked", url: entry.url, fresh: result.newPhoto === true, dipbot,
        badge: result.source === "dipbot" ? "Dipbot picked this" : result.source === "match" ? "Best match" : "Default cover",
        text: result.source === "dipbot" ? `Dipbot picked ${entry.label}` : result.source === "match" ? `Best match: ${entry.label}` : `No close match, so Dipbot used the default: ${entry.label}`,
      });
      // Make sure the new choice is visible and reachable in the grid.
      if (COVER_LIBRARY.some((c) => c.url === entry.url) && !searchCovers({ query, theme }).some((c) => c.url === entry.url)) { setQuery(""); setTheme(""); }
    } catch (error) {
      const known = error instanceof ApiError && error.reason ? tMaybe(`limit.${error.reason}`, { n: "", date: resetDate(credits?.resetsAt ?? "") }) : null;
      // The reason class goes to the console only; the admin sees a plain message and keeps every other form edit.
      if (!known) console.warn("pickEventCover failed", error instanceof ApiError ? { code: error.code, reason: error.reason ?? null, fields: Object.keys(error.fields) } : { name: error instanceof Error ? error.name : typeof error });
      setNote({ kind: "error", text: known ?? "Dipbot couldn’t pick a cover this time. Try again or choose one yourself." });
    } finally {
      setBusy(false);
    }
  }

  async function searchMore() {
    const text = query.trim();
    if (!text || more.kind === "loading" || importing) return;
    setMore({ kind: "loading" });
    setMoreError("");
    try {
      const result = await api.searchCoverPhotos(text);
      if (result.status === "ok" && result.candidates.length > 0) setMore({ kind: "results", candidates: result.candidates });
      else if (result.status === "ok") setMore({ kind: "message", text: "No more photos found. Try different words." });
      else setMore({ kind: "message", text: MORE_UNAVAILABLE });
    } catch {
      setMore({ kind: "message", text: MORE_UNAVAILABLE });
    }
  }

  async function importPhoto(candidate: CoverPhotoCandidate) {
    if (importing) return;
    setImporting(candidate.key);
    setMoreError("");
    try {
      const result = await api.importCoverPhoto(candidate.key);
      rememberCoverAlt(result.coverImageURL, result.coverAlt);
      onChange(result.coverImageURL);
      setNote({ kind: "picked", url: result.coverImageURL, fresh: result.newPhoto, dipbot: false, badge: "Photo from Pixabay", text: "Picked a photo from Pixabay" });
    } catch (error) {
      const reason = error instanceof ApiError ? error.reason : undefined;
      setMoreError(reason === "COVER_CANDIDATE_EXPIRED" ? "That photo is no longer available. Search again." : reason === "COVER_SEARCH_UNAVAILABLE" ? MORE_UNAVAILABLE : "That photo couldn’t be added. Try another one.");
    } finally {
      setImporting(null);
    }
  }

  const clear = () => { setQuery(""); setTheme(""); searchRef.current?.focus(); };
  const noteId = `${uid}-note`;
  const resultsId = `${uid}-results`;
  const count = shown.length === COVER_LIBRARY.length ? `${shown.length} covers` : `${shown.length} of ${COVER_LIBRARY.length}`;

  return (
    <div className={`cover-picker${compact ? " compact" : ""}`}>
      <div className="cp-top">
        <div className="cp-preview">
          {selected ? (
            // eslint-disable-next-line @next/next/no-img-element -- static export, unoptimized images
            <img src={coverImage(selected)} alt={selected.alt} width={320} height={200} />
          ) : (
            <div className="cp-empty-preview" role="img" aria-label="No cover selected">No cover</div>
          )}
          {byDipbot ? <DipbotCoverTag /> : note?.kind === "picked" && note.url === value && <span className="cp-badge" aria-hidden>{note.badge}</span>}
        </div>
        <div className="cp-selected">
          <div className="cp-selected-text">
            <span className="cp-selected-label">{selected ? selected.label : "No cover selected"}</span>
            <span className="cp-selected-meta">{selected ? selected.themes.map(themeLabel).join(" · ") : "Search or browse, or let Dipbot choose."}</span>
          </div>
          <button type="button" className="pill-btn gray cp-dipbot" onClick={() => void dipbotPick()} aria-busy={busy || undefined} aria-describedby={noteId}>
            <DipbotMark size={16} />
            {busy ? "Dipbot is choosing…" : "Let Dipbot choose"}
            <span className="cp-cost">{creditsText(credits?.creditCost.coverPick ?? 1)}</span>
          </button>
          <div id={noteId} className={`cp-note ${note?.kind ?? ""}`} role={note?.kind === "error" ? "alert" : "status"} aria-live="polite">
            {note?.kind === "error" ? note.text : note?.kind === "picked" ? <><span className="sr-only">{note.text}</span>{note.fresh && <span className="cp-fresh">Found a new photo for this event</span>}</> : ""}
          </div>
        </div>
      </div>

      <div className="cp-toolbar">
        <input ref={searchRef} className="cp-search" type="search" aria-label="Search covers" placeholder={`Search ${COVER_LIBRARY.length} covers`} value={query} autoComplete="off" aria-controls={resultsId}
          onChange={(e) => setQuery(e.target.value)} />
        <select className="cp-theme" aria-label="Filter by theme" value={theme} onChange={(e) => setTheme(e.target.value as CoverThemeKey | "")}>
          <option value="">All themes ({total})</option>
          {themeCounts.map((t) => (
            <option key={t.key} value={t.key} disabled={t.count === 0 && theme !== t.key}>{t.label} ({t.count})</option>
          ))}
        </select>
      </div>

      <div className="cp-region-wrap">
      <div className={`cp-region${shown.length === 0 ? " empty" : ""}`}>
        {shown.length === 0 ? (
          <div className="cp-no-results">
            <p>No covers match {query.trim() ? <>“{query.trim()}”</> : "these filters"}{theme ? <> in {themeLabel(theme)}</> : null}.</p>
            <button type="button" className="pill-btn gray small" onClick={clear}>Clear search</button>
          </div>
        ) : (
          <div className="cp-grid" role="radiogroup" aria-label={label} aria-describedby={describedBy} aria-invalid={invalid || undefined} onKeyDown={move}>
            {shown.map((cover: CoverEntry, i) => {
              const checked = cover.url === selected?.url;
              return (
                <button
                  key={cover.key}
                  ref={(node) => { refs.current[cover.url] = node; }}
                  id={i === 0 ? firstId : undefined}
                  type="button"
                  role="radio"
                  className="cp-tile"
                  data-url={cover.url}
                  title={cover.label}
                  aria-checked={checked}
                  aria-label={cover.label}
                  tabIndex={cover.url === stop ? 0 : -1}
                  onClick={() => choose(cover.url)}
                >
                  <span className="cp-thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element -- static export, unoptimized images */}
                    <img src={coverThumb(cover)} alt="" width={200} height={125} loading={i < EAGER_THUMBS ? "eager" : "lazy"} decoding="async" />
                    {checked && <CheckMark />}
                  </span>
                  <span className="cp-label">{cover.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      </div>
      <span className="cp-count" id={resultsId} aria-live="polite">{count}</span>

      {query.trim() && (
        <div className="cp-more">
          <button type="button" className="pill-btn gray small cp-more-btn" onClick={() => void searchMore()} aria-busy={more.kind === "loading" || undefined} disabled={more.kind === "loading" || importing !== null}>
            {more.kind === "loading" ? "Searching…" : "Search more photos"}
          </button>
          <div className="cp-more-status" role="status" aria-live="polite">
            {more.kind === "message" ? more.text : more.kind === "loading" ? "Searching for more photos…" : ""}
          </div>
          {moreError && <div className="cp-more-status error" role="alert">{moreError}</div>}
          {more.kind === "results" && (
            <>
              <ul className="cp-more-grid" aria-label="More photos">
                {more.candidates.map((c) => (
                  <li key={c.key}>
                    <button type="button" className="cp-tile cp-more-tile" onClick={() => void importPhoto(c)} disabled={importing !== null} aria-busy={importing === c.key || undefined}
                      aria-label={c.tags.length ? `Use photo: ${c.tags.slice(0, 3).join(", ")}` : "Use this photo"}>
                      <span className="cp-thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element -- temporary third-party preview, not optimizable */}
                        <img src={c.previewURL} alt={c.tags.slice(0, 3).join(", ")} width={200} height={125} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                        {importing === c.key && <span className="cp-busy">Adding…</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="cp-credit">
                <a href="https://pixabay.com/" target="_blank" rel="noopener noreferrer">Photos from Pixabay</a>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
