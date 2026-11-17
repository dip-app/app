import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { reapOutbox } from "../../functions/src/modules/email/application/reapOutbox";
import type { OutboxReaper } from "../../functions/src/modules/email/application/ports";
import { MAX_OPEN_COUNT, REAPER_BATCH, STALE_QUEUED_MS, canCountOpen } from "../../functions/src/modules/email/domain/outbox";

const NOW = new Date("2030-01-01T12:00:00Z");

interface Doc { status: string; leaseUntil: Date | null; createdAt: Date; reason?: string }

function fake(docs: Record<string, Doc>, opts: { failQueuedQuery?: boolean } = {}) {
  const limits: number[] = [];
  const reaper: OutboxReaper = {
    async expiredSendingIds(now, limit) {
      limits.push(limit);
      return Object.entries(docs).filter(([, d]) => d.status === "sending" && d.leaseUntil !== null && d.leaseUntil <= now).map(([id]) => id).slice(0, limit);
    },
    async staleQueuedIds(cutoff, limit) {
      limits.push(limit);
      if (opts.failQueuedQuery) throw new Error("FAILED_PRECONDITION: index");
      return Object.entries(docs).filter(([, d]) => d.status === "queued" && d.createdAt < cutoff).map(([id]) => id).slice(0, limit);
    },
    async markAbandoned(id) {
      const d = docs[id]!;
      if (d.status !== "sending") return false;
      d.status = "unknown"; d.reason = "abandoned"; d.leaseUntil = null;
      return true;
    },
    async markStaleQueued(id) {
      const d = docs[id]!;
      if (d.status !== "queued") return false;
      d.status = "failed"; d.reason = "stale_queued";
      return true;
    },
  };
  return { reaper, limits };
}

describe("reapOutbox", () => {
  test("abandons expired leases and fails stale queued docs; leaves live and fresh ones", async () => {
    const docs: Record<string, Doc> = {
      expired: { status: "sending", leaseUntil: new Date(NOW.getTime() - 1000), createdAt: NOW },
      live: { status: "sending", leaseUntil: new Date(NOW.getTime() + 60_000), createdAt: NOW },
      stale: { status: "queued", leaseUntil: null, createdAt: new Date(NOW.getTime() - STALE_QUEUED_MS - 1000) },
      fresh: { status: "queued", leaseUntil: null, createdAt: new Date(NOW.getTime() - 60_000) },
      sent: { status: "sent", leaseUntil: null, createdAt: new Date(0) },
    };
    const logs: Array<[string, Record<string, string | number>]> = [];
    const { reaper, limits } = fake(docs);
    const counts = await reapOutbox({ reaper, clock: { now: () => NOW }, log: (e, f) => logs.push([e, f]) });
    assert.deepEqual(counts, { abandoned: 1, staleQueued: 1, errors: 0 });
    assert.equal(docs["expired"]!.status, "unknown");
    assert.equal(docs["expired"]!.reason, "abandoned");
    assert.equal(docs["stale"]!.status, "failed");
    assert.equal(docs["stale"]!.reason, "stale_queued");
    assert.equal(docs["live"]!.status, "sending");
    assert.equal(docs["fresh"]!.status, "queued");
    assert.deepEqual(limits, [REAPER_BATCH, REAPER_BATCH]);
    assert.deepEqual(logs, [["email.reaper", { abandoned: 1, staleQueued: 1, errors: 0 }]]);
  });

  test("silent when there is nothing to do", async () => {
    const logs: string[] = [];
    const counts = await reapOutbox({ reaper: fake({}).reaper, clock: { now: () => NOW }, log: (e) => logs.push(e) });
    assert.deepEqual(counts, { abandoned: 0, staleQueued: 0, errors: 0 });
    assert.deepEqual(logs, []);
  });

  test("a failing queued query does not stop the sending pass and is counted", async () => {
    const docs: Record<string, Doc> = { expired: { status: "sending", leaseUntil: new Date(NOW.getTime() - 1), createdAt: NOW } };
    const logs: Array<Record<string, string | number>> = [];
    const counts = await reapOutbox({ reaper: fake(docs, { failQueuedQuery: true }).reaper, clock: { now: () => NOW }, log: (_e, f) => logs.push(f) });
    assert.deepEqual(counts, { abandoned: 1, staleQueued: 0, errors: 1 });
    assert.equal(logs.length, 1);
  });
});

describe("open count bound", () => {
  test("counts below the bound and stops at it", () => {
    assert.equal(canCountOpen(undefined), true);
    assert.equal(canCountOpen(MAX_OPEN_COUNT - 1), true);
    assert.equal(canCountOpen(MAX_OPEN_COUNT), false);
    assert.equal(canCountOpen(MAX_OPEN_COUNT + 50), false);
  });
});
