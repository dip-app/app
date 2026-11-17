import * as logger from "firebase-functions/logger";
import { REAPER_BATCH, STALE_QUEUED_MS } from "../domain/outbox";
import type { Clock, OutboxReaper } from "./ports";

/**
 * Scheduled cleanup for outbox documents the trigger can no longer finish:
 * - `sending` with an ended lease (instance died mid-send) -> `unknown`/`abandoned`. Never resent: at most once wins.
 * - `queued` for over an hour (an onCreate trigger cannot be re-run, and retries are bounded) -> `failed`/`stale_queued`.
 * Bounded per run; the structured `email.reaper` warning is the alertable signal.
 */

export interface ReaperDeps {
  reaper: OutboxReaper;
  clock: Clock;
  log?: (event: string, fields: Record<string, string | number>) => void;
}

export interface ReaperCounts { abandoned: number; staleQueued: number; errors: number }

export async function reapOutbox(deps: ReaperDeps): Promise<ReaperCounts> {
  const now = deps.clock.now();
  const counts: ReaperCounts = { abandoned: 0, staleQueued: 0, errors: 0 };
  try {
    for (const id of await deps.reaper.expiredSendingIds(now, REAPER_BATCH)) {
      if (await deps.reaper.markAbandoned(id, deps.clock.now())) counts.abandoned++;
    }
  } catch (error) {
    counts.errors++;
    logger.error("email.reaper.sending_failed", { error: error instanceof Error ? error.name : "unknown" });
  }
  try {
    const cutoff = new Date(now.getTime() - STALE_QUEUED_MS);
    for (const id of await deps.reaper.staleQueuedIds(cutoff, REAPER_BATCH)) {
      if (await deps.reaper.markStaleQueued(id, cutoff, deps.clock.now())) counts.staleQueued++;
    }
  } catch (error) {
    counts.errors++;
    logger.error("email.reaper.queued_failed", { error: error instanceof Error ? error.name : "unknown" });
  }
  if (counts.abandoned > 0 || counts.staleQueued > 0 || counts.errors > 0) {
    (deps.log ?? ((event, fields) => logger.warn(event, fields)))("email.reaper", { ...counts });
  }
  return counts;
}
