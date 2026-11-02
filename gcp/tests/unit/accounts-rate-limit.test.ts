import { strict as assert } from "node:assert";
import { test } from "node:test";
import { FirestoreMembershipRateLimiter } from "../../functions/src/modules/accounts/infrastructure/firestoreMembershipRateLimiter";

type LimiterDb = ConstructorParameters<typeof FirestoreMembershipRateLimiter>[0];
function fakeDb(read: () => Promise<{ windowStart: number; attempts: number }>) {
  const writes: unknown[] = [];
  const db = {
    collection: () => ({ doc: () => ({}) }),
    async runTransaction(work: (tx: unknown) => Promise<void>) {
      await work({
        async get() { const data = await read(); return { get: (field: keyof typeof data) => data[field] }; },
        set(_ref: unknown, data: unknown) { writes.push(data); },
      });
    },
  } as unknown as LimiterDb;
  return { db, writes };
}
const rateLimited = (error: any) => {
  assert.equal(error.code, "resource-exhausted");
  assert.equal(error.reason, "RATE_LIMITED");
  return true;
};

test("read delayed across minute boundary cannot reset a newer full window", async () => {
  let now = 179_999;
  let resume!: () => void;
  let reading!: () => void;
  const started = new Promise<void>((resolve) => { reading = resolve; });
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  const { db, writes } = fakeDb(async () => {
    reading();
    await gate;
    return { windowStart: 180_000, attempts: 5 };
  });
  const result = new FirestoreMembershipRateLimiter(db, () => now).consume("delayed");
  const rejected = assert.rejects(result, rateLimited);
  await started;
  now = 180_001;
  resume();
  await rejected;
  assert.deepEqual(writes, []);
});

test("server clock rollback cannot replace a future stored window", async () => {
  const { db, writes } = fakeDb(async () => ({ windowStart: 180_000, attempts: 1 }));
  await assert.rejects(new FirestoreMembershipRateLimiter(db, () => 179_999).consume("rollback"), rateLimited);
  assert.deepEqual(writes, []);
});
