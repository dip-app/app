import type { KeyValueStore } from "./api";

/**
 * localStorage, or an in-memory stand-in when storage is blocked. Its own module so pages that only need storage don't
 * pull in the mock backend that `api.ts` builds (which re-exports this for existing callers).
 */
export function browserStore(): KeyValueStore {
  try {
    const probe = "__probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
      removeItem: (key) => void memory.delete(key),
    };
  }
}
