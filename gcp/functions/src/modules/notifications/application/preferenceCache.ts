import type { ResolvedPreferences } from "../domain/preferences";
import type { PreferencesReader } from "./ports";

/**
 * Per-invocation memo over a PreferencesReader: each uid is read at most once per trigger run, however many
 * notifications or channels it is evaluated for. Create one per invocation; never share across invocations,
 * or a member's toggle would be ignored until the instance recycles.
 */
export function cachedPreferences(reader: PreferencesReader): PreferencesReader {
  const cache = new Map<string, ResolvedPreferences>();
  return {
    async preferencesFor(uids) {
      const missing = [...new Set(uids)].filter((uid) => !cache.has(uid));
      if (missing.length) for (const [uid, prefs] of await reader.preferencesFor(missing)) cache.set(uid, prefs);
      const result = new Map<string, ResolvedPreferences>();
      for (const uid of uids) { const prefs = cache.get(uid); if (prefs) result.set(uid, prefs); }
      return result;
    },
  };
}
