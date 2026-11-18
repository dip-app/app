import type { AdminApi } from "./api";

// Mock mode only: `?loading=1` makes every data call wait forever, so a page stays in its loading state for design review
// and screenshots. Sign-in and the session still work. Never applied to the live Firebase adapter.

const KEEP = new Set(["session", "signIn", "signOut"]);

export function holdReadsFromQuery(api: AdminApi, search: string): AdminApi {
  if (new URLSearchParams(search).get("loading") !== "1") return api;
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      if (typeof prop === "string" && KEEP.has(prop)) return value.bind(target);
      return () => new Promise(() => {});
    },
  });
}
