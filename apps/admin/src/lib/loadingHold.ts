import type { AdminApi } from "./api";

// Mock mode only, for design review, screenshots and timing measurements. Sign-in and the session still work. Never
// applied to the live Firebase adapter.
//   ?loading=1       every data call waits forever, so a page stays in its loading state
//   ?latency=<ms>    every data call answers after <ms> (up to 10 s), like a real backend round trip

const KEEP = new Set(["session", "signIn", "signOut"]);
const MAX_LATENCY_MS = 10_000;

/** The `?latency=` value in ms, or 0 when absent or not a positive number. */
export function latencyFromQuery(search: string): number {
  const raw = Number(new URLSearchParams(search).get("latency"));
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_LATENCY_MS) : 0;
}

export function holdReadsFromQuery(api: AdminApi, search: string): AdminApi {
  const hold = new URLSearchParams(search).get("loading") === "1";
  const latency = latencyFromQuery(search);
  if (!hold && latency === 0) return api;
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      if (typeof prop === "string" && KEEP.has(prop)) return value.bind(target);
      if (hold) return () => new Promise(() => {});
      const call = value as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => new Promise((resolve) => setTimeout(resolve, latency)).then(() => call.apply(target, args));
    },
  });
}
