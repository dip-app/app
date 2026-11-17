"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/contract";
import { useApp } from "./AppProvider";

export interface PageResult<T, X> { items: T[]; nextCursor: string | null; extra: X | null }

/** A list that is read page by page from the server. The first page of a new query replaces the list; "load more" appends. */
export interface Paged<T, X> {
  items: T[];
  /** True while more pages exist on the server. */
  hasMore: boolean;
  /** True while the first page of the current query loads. Earlier rows stay in `items` meanwhile (mark the table busy). */
  loading: boolean;
  loadingMore: boolean;
  error: ApiError | null;
  /** Data the first page carries besides the rows (a company total, counts per state). Kept across "load more". */
  extra: X | null;
  loadMore: () => void;
  /** Reads every remaining page (used by exports); resolves with the complete list. Rejects if the query changes meanwhile. */
  loadAll: () => Promise<T[]>;
  reload: () => void;
  /** Changes the loaded rows in place (after an action) without a reload. */
  mutate: (change: (items: T[]) => T[]) => void;
}

/** A server page can come back short while more follow (the scan is bounded), so keep reading until a page's worth arrived. */
const MAX_CALLS_PER_PAGE = 8;

/**
 * Pages a list. `fetchPage` is identified by `queryKey`: when the key changes the list reloads. A stale response never
 * overwrites a newer query (each run owns a generation number).
 */
export function usePaged<T, X>(
  fetchPage: (api: ReturnType<typeof useApp>["api"], cursor: string | null) => Promise<PageResult<T, X>>,
  queryKey: string,
  pageSize: number,
): Paged<T, X> {
  const { api, session } = useApp();
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [extra, setExtra] = useState<X | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  // Generation of the "load more" call that is running (null when none): a second click or key press cannot start another.
  const moreInFlight = useRef<number | null>(null);
  const firstLoading = useRef(true);
  const fetcher = useRef(fetchPage);
  fetcher.current = fetchPage;
  const latest = useRef({ items, cursor });
  latest.current = { items, cursor };

  /** Reads pages from `from` until a page's worth of new rows arrived. Resolves null when a newer query replaced this one. */
  const read = useCallback(async (from: string | null, gen: number): Promise<{ added: T[]; cursor: string | null; first: X | null } | null> => {
    const added: T[] = [];
    let next = from;
    let first: X | null = null;
    for (let call = 0; call < MAX_CALLS_PER_PAGE; call += 1) {
      const page = await fetcher.current(api, next);
      if (gen !== generation.current) return null;
      if (page.extra !== null && first === null) first = page.extra;
      added.push(...page.items);
      next = page.nextCursor;
      if (!next || added.length >= pageSize) break;
    }
    return { added, cursor: next, first };
  }, [api, pageSize]);

  const fail = (failure: unknown) => setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", "Couldn’t load this. Check your connection and try again.", {}, "LOAD_FAILED"));

  useEffect(() => {
    if (!session) return;
    generation.current += 1;
    const gen = generation.current;
    // A "load more" from the previous query must neither keep the button busy nor block the next one.
    moreInFlight.current = null;
    firstLoading.current = true;
    setLoadingMore(false);
    setLoading(true);
    setError(null);
    // The old rows stay on screen (the page marks them busy) until the new query answers; paging on from the old cursor would mix queries.
    setCursor(null);
    read(null, gen).then(
      (result) => {
        if (!result) return;
        firstLoading.current = false;
        setItems(result.added); setCursor(result.cursor); setExtra(result.first); setLoading(false);
      },
      (failure: unknown) => { if (gen === generation.current) { firstLoading.current = false; fail(failure); setItems([]); setLoading(false); } },
    );
  // The list resets when the query or the attempt changes, never on a new fetch function identity.
  }, [session, queryKey, attempt, read]);

  const loadMore = useCallback(() => {
    const from = latest.current.cursor;
    if (!from || moreInFlight.current !== null || firstLoading.current) return;
    const gen = generation.current;
    moreInFlight.current = gen;
    setLoadingMore(true);
    setError(null);
    const settle = () => {
      // Only the call that is still current clears the flag; a stale one finds it already reset by the new query.
      if (moreInFlight.current === gen) { moreInFlight.current = null; setLoadingMore(false); }
    };
    read(from, gen).then(
      (result) => {
        if (!result) { settle(); return; }
        // Functional append: rows changed with mutate() while this page was loading are kept.
        setItems((previous) => [...previous, ...result.added]);
        setCursor(result.cursor);
        settle();
      },
      (failure: unknown) => { if (gen === generation.current) fail(failure); settle(); },
    );
  }, [read]);

  const loadAll = useCallback(async () => {
    if (firstLoading.current) throw new Error("The list is still loading. Try again in a moment.");
    const gen = generation.current;
    const loaded = latest.current.items;
    const rest: T[] = [];
    let next = latest.current.cursor;
    while (next) {
      const page = await fetcher.current(api, next);
      if (gen !== generation.current) throw new Error("The filters changed while exporting. Try again.");
      rest.push(...page.items);
      next = page.nextCursor;
    }
    return [...loaded, ...rest];
  }, [api]);

  const mutate = useCallback((change: (items: T[]) => T[]) => setItems((current) => change(current)), []);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { items, hasMore: cursor !== null, loading, loadingMore, error, extra, loadMore, loadAll, reload, mutate };
}

/** A value that follows `value` after `ms` of quiet (search boxes call the server only once typing pauses). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
