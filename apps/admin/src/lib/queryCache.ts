// In-memory stale-while-revalidate cache for the data hooks (`useLoad`, `usePaged`). A page that was seen before renders
// its last answer at once and refreshes in the background, so revisits never show a skeleton for data we already have.
//
// Safety rules (see docs/design/polish-2026-11/admin-interaction.md):
// - Scoped: the whole cache belongs to one signed-in user, company, role and language; sign-out empties it. Any change to that
//   scope empties it (a demoted admin keeps the same uid; mock data carries text in the active language).
// - Keys are the hook's key plus the loader's source text, so two call sites that happen to share a key ("company",
//   a raw id) but read different things never share an entry.
// - Any successful write drops every entry no screen is showing (the next visit loads fresh, so a just-saved edit
//   never shows its old version) and marks the ones on screen stale (their page refreshes them). Nothing guesses which
//   entries a write touched.
// - Memory only: nothing is written to storage, and signing out drops it.

export interface CacheEntry<T> {
  data: T;
  /** Date.now() when the answer arrived. */
  at: number;
  /** A write happened since: refetch on the next read even if it is recent. */
  stale: boolean;
}

/** Reads closer together than this share one request (several sections of a page reading the same thing). */
export const DEDUPE_MS = 4000;
/** At most this many entries are kept; the oldest go first. */
const MAX_ENTRIES = 200;

let scope = "";
const entries = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const generations = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();
/** Sets the current scope; a different scope empties the cache. Returns the scope string. */
export function enterScope(next: string): string {
  if (next !== scope) {
    scope = next;
    entries.clear();
    inflight.clear();
  }
  return scope;
}

export function cacheKey(key: string, loader: (...args: never[]) => unknown): string {
  return `${key}\u0000${loader.toString()}`;
}

export function readEntry<T>(key: string): CacheEntry<T> | undefined {
  return entries.get(key) as CacheEntry<T> | undefined;
}

/** True when a read should go to the server: no entry, a stale one, or one older than the dedupe window. */
export function needsFetch(key: string, now = Date.now()): boolean {
  const entry = entries.get(key);
  return !entry || entry.stale || now - entry.at > DEDUPE_MS;
}

/** `stale`: a local patch (after an action) that the next read should still confirm with the server. */
export function writeEntry<T>(key: string, data: T, at = Date.now(), stale = false): void {
  entries.delete(key);
  entries.set(key, { data, at, stale });
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
  listeners.get(key)?.forEach((listener) => listener());
}

/** Shares one request among readers of the same key. `fresh` starts a new one even if a request is running (after a write). */
export function fetchOnce<T>(key: string, run: () => Promise<T>, fresh = false): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running && !fresh) return running;
  const owner = scope;
  const generation = (generations.get(key) ?? 0) + 1;
  generations.set(key, generation);
  const promise = run().finally(() => { if (inflight.get(key) === promise) inflight.delete(key); });
  inflight.set(key, promise);
  // Stored only while it is the newest request for the key and the scope is unchanged (sign-out, role change).
  promise.then((data) => { if (scope === owner && generations.get(key) === generation) writeEntry(key, data); }, () => {});
  return promise;
}

/** Starts a read that stores its own answer (usePaged): the token says which scope and request it belongs to. */
export function beginRead(key: string): { scope: string; generation: number } {
  const generation = (generations.get(key) ?? 0) + 1;
  generations.set(key, generation);
  return { scope, generation };
}

/** Stores an answer only if it is still the newest read for its key in the same scope (not after a sign-out or a write). */
export function storeIfCurrent<T>(key: string, token: { scope: string; generation: number }, data: T): void {
  if (token.scope && token.scope === scope && generations.get(key) === token.generation) writeEntry(key, data);
}

export function subscribe(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) { set = new Set(); listeners.set(key, set); }
  set.add(listener);
  return () => { set!.delete(listener); if (set!.size === 0) listeners.delete(key); };
}

/** After any successful write: entries no screen shows are dropped; entries on screen refetch on their next read. */
export function markAllStale(): void {
  for (const [key, entry] of entries) {
    if (listeners.has(key)) entry.stale = true;
    else entries.delete(key);
  }
  // A read that started before the write answers with the old data: it is neither stored nor shared with later reads.
  for (const key of generations.keys()) generations.set(key, (generations.get(key) ?? 0) + 1);
  inflight.clear();
}

/** Removes one entry (a read the server refused: it must not be shown again from memory). */
export function dropEntry(key: string): void {
  entries.delete(key);
}

/** Tests and sign-out. */
export function resetCache(): void {
  scope = "";
  entries.clear();
  inflight.clear();
  generations.clear();
  listeners.clear();
}

/** Method names that change data (same list the mock failure helper uses). */
export const WRITE_METHOD = /^(create|update|set|save|record|approve|reject|apply|generate|add|remove|revoke|resend|reinvite|invite|deactivate|reactivate|reset|backfill|adjust|pick|cancel|delete|subscribe|unsubscribe|send|triage|import|suggest|eventIdeaSuggestions|dipbot)/;

/** Wraps an api so that every successful write marks the cache stale. Reads pass through untouched. */
export function staleOnWrite<A extends object>(api: A): A {
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function" || typeof prop !== "string" || !WRITE_METHOD.test(prop)) return typeof value === "function" ? value.bind(target) : value;
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (result && typeof (result as Promise<unknown>).then === "function") (result as Promise<unknown>).then(markAllStale, () => {});
        else markAllStale();
        return result;
      };
    },
  });
}
