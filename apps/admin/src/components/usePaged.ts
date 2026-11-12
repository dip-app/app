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
  loading: boolean;
  loadingMore: boolean;
  error: ApiError | null;
  /** Data the first page carries besides the rows (a company total, counts per state). Kept across "load more". */
  extra: X | null;
  loadMore: () => void;
  /** Reads every remaining page (used by exports); resolves with the complete list. */
  loadAll: () => Promise<T[]>;
  reload: () => void;
  /** Changes the loaded rows in place (after an action) without a reload. */
  mutate: (change: (items: T[]) => T[]) => void;
}

/** A server page can come back short while more follow (the scan is bounded), so keep reading until a page's worth arrived. */
const MAX_CALLS_PER_PAGE = 8;

/**
 * Pages a list. `fetchPage` is identified by `queryKey`: when the key changes the list resets. A stale response never
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
  const fetcher = useRef(fetchPage);
  fetcher.current = fetchPage;
  const state = useRef({ items, cursor });
  state.current = { items, cursor };

  const read = useCallback(async (start: T[], from: string | null, gen: number): Promise<{ items: T[]; cursor: string | null; first: X | null } | null> => {
    let all = start;
    let next = from;
    let first: X | null = null;
    const target = start.length + pageSize;
    for (let call = 0; call < MAX_CALLS_PER_PAGE; call += 1) {
      const page = await fetcher.current(api, next);
      if (gen !== generation.current) return null;
      if (page.extra !== null && first === null) first = page.extra;
      all = [...all, ...page.items];
      next = page.nextCursor;
      if (!next || all.length >= target) break;
    }
    return { items: all, cursor: next, first };
  }, [api, pageSize]);

  const fail = (failure: unknown) => setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", "Couldn’t load this. Check your connection and try again.", {}, "LOAD_FAILED"));

  useEffect(() => {
    if (!session) return;
    generation.current += 1;
    const gen = generation.current;
    setLoading(true);
    setError(null);
    setItems([]);
    setCursor(null);
    setExtra(null);
    read([], null, gen).then(
      (result) => {
        if (!result) return;
        setItems(result.items); setCursor(result.cursor); setExtra(result.first); setLoading(false);
      },
      (failure: unknown) => { if (gen === generation.current) { fail(failure); setLoading(false); } },
    );
  // The list resets when the query or the attempt changes, never on a new fetch function identity.
  }, [session, queryKey, attempt, read]);

  const loadMore = useCallback(() => {
    const { items: current, cursor: from } = state.current;
    if (!from) return;
    const gen = generation.current;
    setLoadingMore(true);
    setError(null);
    read(current, from, gen).then(
      (result) => { if (!result) return; setItems(result.items); setCursor(result.cursor); setLoadingMore(false); },
      (failure: unknown) => { if (gen === generation.current) { fail(failure); setLoadingMore(false); } },
    );
  }, [read]);

  const loadAll = useCallback(async () => {
    let { items: all, cursor: next } = state.current;
    const gen = generation.current;
    while (next) {
      const page = await fetcher.current(api, next);
      if (gen !== generation.current) break;
      all = [...all, ...page.items];
      next = page.nextCursor;
    }
    return all;
  }, [api]);

  const setItems_ = useCallback((change: (items: T[]) => T[]) => setItems((current) => change(current)), []);
  return { items, hasMore: cursor !== null, loading, loadingMore, error, extra, loadMore, loadAll, reload: useCallback(() => setAttempt((n) => n + 1), []), mutate: setItems_ };
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
