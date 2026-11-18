import { vi } from "vitest";

/** In-memory `window.localStorage` (newer Node versions leave jsdom without a usable one). Returns the stub for spying. */
export function stubLocalStorage(): Storage {
  const data = new Map<string, string>();
  const stub: Storage = {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, String(value)); },
  };
  vi.stubGlobal("localStorage", stub);
  Object.defineProperty(window, "localStorage", { value: stub, configurable: true });
  return stub;
}
