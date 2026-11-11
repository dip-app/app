"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/contract";
import type { AdminApi } from "@/lib/api";
import { useApp } from "./AppProvider";

/** Loads data for a screen once signed in; `reload` refetches (used by "Try again" and after changes). */
export function useLoad<T>(load: (api: AdminApi) => Promise<T>, key: string = ""): {
  data: T | null; error: ApiError | null; reload: () => void; setData: (next: T) => void;
} {
  const { api, session } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The loader is identified by `key`, so inline arrow functions don't refetch on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loader = useCallback(load, [key]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    loader(api).then(
      (value) => !cancelled && (setData(value), setError(null)),
      (failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure : new ApiError("failed-precondition", "Couldn’t load this. Check your connection and try again.")),
    );
    return () => { cancelled = true; };
  }, [api, session, loader, attempt]);

  return { data, error, reload: useCallback(() => setAttempt((n) => n + 1), []), setData };
}

export function describe(failure: unknown, fallback = "That didn’t go through. Try again."): string {
  return failure instanceof ApiError ? failure.message : fallback;
}
