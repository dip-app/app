"use client";
// @i18n-migrated

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/contract";
import { getLocale, t } from "@/lib/i18n";
import type { AdminApi } from "@/lib/api";
import { cacheKey, dropEntry, enterScope, fetchOnce, needsFetch, readEntry, subscribe, writeEntry } from "@/lib/queryCache";
import { userErrorMessage } from "@/lib/userError";
import { useApp } from "./AppProvider";
import { toastError } from "./Toast";

/** The cache scope for the signed-in person (user, company, role, language); entering a new one empties the cache. */
export function useCacheScope(): string {
  const { session } = useApp();
  const next = session ? `${session.uid}|${session.companyId}|${session.role}|${getLocale()}` : "";
  return enterScope(next);
}

const asApiError = (failure: unknown) => (failure instanceof ApiError ? failure : new ApiError("failed-precondition", t("common.loadFailed")));

export interface Loaded<T> {
  data: T | null;
  /** Set only when there is nothing to show (a failed first load). A failed background refresh keeps the data and sets `refreshError`. */
  error: ApiError | null;
  /** True while a refresh runs behind data that is already on screen (revisit, `reload`). Never dims or replaces the page. */
  refreshing: boolean;
  refreshError: ApiError | null;
  /** Refetches and keeps the current data on screen meanwhile (used by "Try again" and after changes). */
  reload: () => void;
  /** Replaces the data at once (after an action), for every reader of the same key, without a request. */
  setData: (next: T) => void;
}

/**
 * Loads data for a screen once signed in. With a `key`, answers are cached for the session (stale-while-revalidate): a
 * revisit renders the last answer at once and refreshes it in the background. Readers of the same key mounted together
 * share one request. Without a key nothing is cached.
 */
export function useLoad<T>(load: (api: AdminApi) => Promise<T>, key: string = ""): Loaded<T> {
  const { api, session } = useApp();
  const scope = useCacheScope();
  // The loader is identified by `key`, so inline arrow functions don't refetch on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loader = useCallback(load, [key]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entryKey = useMemo(() => (key ? cacheKey(key, load) : ""), [key]);
  const cached = entryKey && scope ? readEntry<T>(entryKey) : undefined;

  const [data, setLocal] = useState<T | null>(cached ? cached.data : null);
  const [error, setError] = useState<ApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const hasData = useRef(data !== null);
  hasData.current = data !== null;

  // A different key (or scope) is a different request: show its cached answer, or nothing, never the previous key's.
  const shownFor = useRef(`${scope}|${entryKey}|${key}`);
  if (shownFor.current !== `${scope}|${entryKey}|${key}`) {
    shownFor.current = `${scope}|${entryKey}|${key}`;
    const next = cached ? cached.data : null;
    setLocal(next);
    hasData.current = next !== null;
    setError(null);
    setRefreshError(null);
  }

  // Another reader (or setData) updated the entry: follow it.
  useEffect(() => {
    if (!entryKey || !scope) return;
    return subscribe(entryKey, () => { const entry = readEntry<T>(entryKey); if (entry) setLocal(entry.data); });
  }, [entryKey, scope]);

  const forced = useRef(false);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const force = forced.current;
    forced.current = false;
    if (entryKey && !force && !needsFetch(entryKey)) {
      const entry = readEntry<T>(entryKey);
      if (entry) { setLocal(entry.data); setRefreshing(false); return; }
    }
    const behind = hasData.current;
    const startedAt = Date.now();
    if (behind) setRefreshing(true);
    const request = entryKey ? fetchOnce(entryKey, () => loader(api), force) : loader(api);
    request.then(
      (value) => {
        if (cancelled) return;
        // The cache entry wins only when it is newer than this request (another reader forced a newer one meanwhile).
        const entry = entryKey ? readEntry<T>(entryKey) : undefined;
        setLocal(entry && entry.at > startedAt ? entry.data : value); setError(null); setRefreshError(null); setRefreshing(false);
      },
      (failure: unknown) => {
        if (cancelled) return;
        setRefreshing(false);
        const shown = asApiError(failure);
        // Refused (access changed, signed out): the old answer must not stay on screen or in memory.
        if (shown.code === "permission-denied" || shown.code === "unauthenticated") {
          if (entryKey) dropEntry(entryKey);
          setLocal(null); hasData.current = false; setError(shown);
          return;
        }
        // Otherwise the data on screen stays (a failed refresh never replaces a working page), and the person is told
        // (several readers of one key show one toast: the same text replaces the earlier toast).
        if (hasData.current) { setRefreshError(shown); toastError(failure); }
        else setError(shown);
      },
    );
    return () => { cancelled = true; };
  }, [api, session, loader, attempt, entryKey, scope]);

  const reload = useCallback(() => { forced.current = true; setAttempt((n) => n + 1); }, []);
  const setData = useCallback((next: T) => {
    if (entryKey && scope) writeEntry(entryKey, next, Date.now(), true);
    setLocal(next);
  }, [entryKey, scope]);
  return { data, error, refreshing, refreshError, reload, setData };
}

/** The plain-language sentence for a failed action (`userError`); `fallback` words an unknown failure. */
export function describe(failure: unknown, fallback = t("common.actionFailed")): string {
  return userErrorMessage(failure, fallback);
}
