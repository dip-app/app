"use client";
// @i18n-migrated

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/contract";
import { t } from "@/lib/i18n";
import { beginRead, cacheKey, dropEntry, needsFetch, readEntry, storeIfCurrent, subscribe, writeEntry } from "@/lib/queryCache";
import { useApp } from "./AppProvider";
import { toastError } from "./Toast";
import { useCacheScope } from "./useLoad";

export interface PageResult<T, X> { items: T[]; nextCursor: string | null; extra: X | null }

/** A list that is read page by page from the server. The first page of a new query replaces the list; "load more" appends. */
export interface Paged<T, X> {
  items: T[];
  /** True while more pages exist on the server. */
  hasMore: boolean;
  /** True while the first page of a new query loads. Earlier rows stay in `items` meanwhile (mark the table busy). */
  loading: boolean;
  /** True while rows already on screen are refreshed in the background (a revisit, `reload`). Do not dim for this. */
  refreshing: boolean;
  loadingMore: boolean;
  error: ApiError | null;
  /** Data the first page carries besides the rows (a company total, counts per state). Kept across "load more". */
  extra: X | null;
  loadMore: () => void;
  /** Reads every remaining page (used by exports); resolves with the complete list. Rejects if the query changes meanwhile. */
  loadAll: () => Promise<T[]>;
  /** Refreshes the first page; rows on screen stay (and are not marked busy) until the answer arrives. */
  reload: () => void;
  /** Changes the loaded rows in place (after an action) without a reload; the cached first page follows. */
  mutate: (change: (items: T[]) => T[]) => void;
}

/** A server page can come back short while more follow (the scan is bounded), so keep reading until a page's worth arrived. */
const MAX_CALLS_PER_PAGE = 8;

interface FirstPage<T, X> { items: T[]; cursor: string | null; extra: X | null }

/**
 * Pages a list. `fetchPage` is identified by `queryKey`: when the key changes the list reloads. A stale response never
 * overwrites a newer query (each run owns a generation number). The first page of each query is cached for the session
 * (stale-while-revalidate, `lib/queryCache.ts`): a revisit shows it at once and refreshes it in the background.
 */
export function usePaged<T, X>(
  fetchPage: (api: ReturnType<typeof useApp>["api"], cursor: string | null) => Promise<PageResult<T, X>>,
  queryKey: string,
  pageSize: number,
): Paged<T, X> {
  const { api, session } = useApp();
  const scope = useCacheScope();
  // The fetcher's source keeps two lists with the same query text apart.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entryKey = useMemo(() => cacheKey(`paged|${pageSize}|${queryKey}`, fetchPage), [queryKey, pageSize]);
  const initial = scope ? readEntry<FirstPage<T, X>>(entryKey)?.data : undefined;
  const [items, setItems] = useState<T[]>(initial?.items ?? []);
  const [cursor, setCursor] = useState<string | null>(initial?.cursor ?? null);
  const [extra, setExtra] = useState<X | null>(initial?.extra ?? null);
  const [loading, setLoading] = useState(!initial);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  // Generation of the "load more" call that is running (null when none): a second click or key press cannot start another.
  const moreInFlight = useRef<number | null>(null);
  const firstLoading = useRef(!initial);
  const fetcher = useRef(fetchPage);
  fetcher.current = fetchPage;
  const latest = useRef({ items, cursor });
  latest.current = { items, cursor };
  // Set by reload(): refresh behind the rows on screen instead of treating it as a new query.
  const inBackground = useRef(false);
  // "Load more" pressed while a background refresh runs: it pages on from the fresh first page once that arrives.
  const moreQueued = useRef(false);
  const refreshingNow = useRef(false);
  // Row changes (mutate) made while a background refresh runs are applied again to its answer, which predates them.
  const changesDuringRefresh = useRef<((items: T[]) => T[])[]>([]);

  // Marks this list as on screen, so a write elsewhere marks it stale instead of dropping it (lib/queryCache.ts).
  useEffect(() => (scope ? subscribe(entryKey, () => {}) : undefined), [scope, entryKey]);
  // Unmounted: answers still on their way are ignored (a newer generation never matches theirs).
  useEffect(() => () => { generation.current += 1; }, []);

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

  const fail = (failure: unknown) => setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", t("common.loadFailed"), {}, "LOAD_FAILED"));

  const loadMoreRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!session) return;
    generation.current += 1;
    const gen = generation.current;
    // A "load more" from the previous query must neither keep the button busy nor block the next one.
    moreInFlight.current = null;
    moreQueued.current = false;
    setLoadingMore(false);
    setError(null);
    const cached = scope ? readEntry<FirstPage<T, X>>(entryKey) : undefined;
    const reloading = inBackground.current;
    inBackground.current = false;
    // Behind rows already on screen: a revisit (cached first page) or a reload. Otherwise a new query.
    const behind = reloading ? latest.current.items.length > 0 || !!cached : !!cached;
    if (cached && !reloading) {
      setItems(cached.data.items); setCursor(cached.data.cursor); setExtra(cached.data.extra);
      if (!needsFetch(entryKey)) { firstLoading.current = false; refreshingNow.current = false; setLoading(false); setRefreshing(false); return; }
    }
    changesDuringRefresh.current = [];
    if (behind) {
      firstLoading.current = false;
      refreshingNow.current = true;
      setLoading(false);
      setRefreshing(true);
    } else {
      firstLoading.current = true;
      refreshingNow.current = false;
      setLoading(true);
      setRefreshing(false);
      // The old rows stay on screen (the page marks them busy) until the new query answers; paging on from the old cursor would mix queries.
      setCursor(null);
    }
    // Stored only if no sign-out, scope change or write happened while it was on its way (lib/queryCache.ts).
    const token = beginRead(entryKey);
    read(null, gen).then(
      (result) => {
        if (!result) return;
        firstLoading.current = false;
        refreshingNow.current = false;
        const rows = changesDuringRefresh.current.reduce((list, change) => change(list), result.added);
        changesDuringRefresh.current = [];
        storeIfCurrent(entryKey, token, { items: rows, cursor: result.cursor, extra: result.first });
        setItems(rows); setCursor(result.cursor); setExtra(result.first); setLoading(false); setRefreshing(false);
        // A queued "load more" pages on from the fresh cursor (the render that would update `latest` has not run yet).
        latest.current = { items: rows, cursor: result.cursor };
        if (moreQueued.current) { moreQueued.current = false; setLoadingMore(false); loadMoreRef.current(); }
      },
      (failure: unknown) => {
        if (gen !== generation.current) return;
        firstLoading.current = false;
        refreshingNow.current = false;
        moreQueued.current = false;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
        const refused = failure instanceof ApiError && (failure.code === "permission-denied" || failure.code === "unauthenticated");
        // Refused (access changed, signed out): the rows must not stay on screen or in memory.
        if (refused) { dropEntry(entryKey); fail(failure); setItems([]); setCursor(null); return; }
        // Otherwise rows on screen stay after a failed background refresh (and the person is told); a failed first load shows the error.
        if (behind) { toastError(failure); return; }
        fail(failure); setItems([]);
      },
    );
  // The list resets when the query or the attempt changes, never on a new fetch function identity.
   
  }, [session, queryKey, attempt, read, scope, entryKey]);

  const loadMore = useCallback(() => {
    // During a background refresh the cursor on screen may be replaced; page on once the fresh first page is in.
    if (refreshingNow.current) { moreQueued.current = true; setLoadingMore(true); return; }
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
  loadMoreRef.current = loadMore;

  const loadAll = useCallback(async () => {
    if (firstLoading.current) throw new Error(t("common.listLoading"));
    const gen = generation.current;
    const loaded = latest.current.items;
    const rest: T[] = [];
    let next = latest.current.cursor;
    while (next) {
      const page = await fetcher.current(api, next);
      if (gen !== generation.current) throw new Error(t("common.filtersChanged"));
      rest.push(...page.items);
      next = page.nextCursor;
    }
    return [...loaded, ...rest];
  }, [api]);

  const mutate = useCallback((change: (items: T[]) => T[]) => {
    if (refreshingNow.current) changesDuringRefresh.current.push(change);
    setItems((current) => change(current));
    // The cached first page follows the change, so a revisit shows it before the refresh answers.
    const entry = scope ? readEntry<FirstPage<T, X>>(entryKey) : undefined;
    if (entry) writeEntry(entryKey, { ...entry.data, items: change(entry.data.items) }, entry.at, true);
  }, [scope, entryKey]);
  const reload = useCallback(() => { inBackground.current = true; setAttempt((n) => n + 1); }, []);
  return { items, hasMore: cursor !== null, loading, refreshing, loadingMore, error, extra, loadMore, loadAll, reload, mutate };
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
