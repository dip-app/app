import type { Clock, DeviceDirectory, StaleDeviceStore } from "./ports";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PruneOptions { maxAgeDays: number; pageSize: number; maxPages: number }

export const DEFAULT_PRUNE: PruneOptions = { maxAgeDays: 60, pageSize: 300, maxPages: 20 };

/**
 * Deletes registry rows whose `lastSeenAt` is older than `maxAgeDays`. The app re-registers its token on every
 * launch, so a row untouched for that long belongs to an uninstalled or abandoned install. Pages until a short
 * page or `maxPages` (the next daily run continues). Returns counts only.
 */
export async function pruneStaleDevices(
  deps: { stale: StaleDeviceStore; devices: Pick<DeviceDirectory, "remove">; clock: Clock },
  options: PruneOptions = DEFAULT_PRUNE,
): Promise<{ removed: number; pages: number }> {
  const cutoff = new Date(deps.clock.now().getTime() - options.maxAgeDays * DAY_MS);
  let removed = 0;
  let pages = 0;
  while (pages < options.maxPages) {
    const batch = await deps.stale.staleBefore(cutoff, options.pageSize);
    pages++;
    if (batch.length > 0) await deps.devices.remove(batch);
    removed += batch.length;
    if (batch.length < options.pageSize) break;
  }
  return { removed, pages };
}
