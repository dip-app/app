"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/** Picks `value` when it is one of `allowed`, otherwise the fallback (a hand-edited URL never breaks the page). */
export function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Keeps page state (filters, search, tab) in the URL so reload, back/forward and shared links restore it.
 * `defaults` lists the keys this page owns; a value equal to its default is left out of the URL, other params
 * (such as `id`) are kept. Values update immediately from a local copy while the URL catches up, so typing never
 * loses characters. The page must sit under a Suspense boundary (static export).
 */
export function useQueryState<D extends Record<string, string>>(defaults: D): [D, (patch: Partial<D>) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fixed = useRef(defaults);
  const urlString = params.toString();

  const read = useCallback((source: URLSearchParams): D => {
    const next: Record<string, string> = { ...fixed.current };
    for (const key of Object.keys(fixed.current)) next[key] = source.get(key) ?? fixed.current[key];
    return next as D;
  }, []);

  const [values, setValues] = useState<D>(() => read(params));
  // URLs this hook wrote that the router has not reported back yet; seeing one of them is not an outside change.
  const pending = useRef<string[]>([]);
  const seen = useRef(urlString);
  const latest = useRef(values);

  useEffect(() => {
    if (urlString === seen.current) return;
    seen.current = urlString;
    const at = pending.current.indexOf(urlString);
    if (at >= 0) { pending.current.splice(0, at + 1); return; }
    pending.current = [];
    const outside = read(new URLSearchParams(urlString));
    latest.current = outside;
    setValues(outside);
  }, [urlString, read]);

  const update = useCallback((patch: Partial<D>) => {
    const merged = { ...latest.current, ...patch } as Record<string, string>;
    latest.current = merged as D;
    setValues(merged as D);
    // Start from the newest URL we know of so two quick updates (or an `id` param) are never lost.
    const base = pending.current.length ? pending.current[pending.current.length - 1] : seen.current;
    const next = new URLSearchParams(base);
    for (const key of Object.keys(fixed.current)) {
      if (merged[key] === fixed.current[key]) next.delete(key);
      else next.set(key, merged[key]);
    }
    const query = next.toString();
    if (query === base) return;
    pending.current.push(query);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [router, pathname]);

  return [values, update];
}
