import type {
  AdminDeps, AdminStore, AdminTransaction, Caller, Doc, DocQuery, Filter, GroupQuery, QuerySource, ListQuery, ObjectStore, SessionRevoker,
} from "../../../functions/src/modules/admin/application/ports";

export const NOW = new Date("2030-01-02T12:00:00Z");
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const childOf = (collection: string, path: string) => path.startsWith(`${collection}/`) && !path.slice(collection.length + 1).includes("/");

/**
 * In-memory AdminStore with optimistic transactions: reads record versions and a commit that finds anything changed
 * (or a create target that now exists) retries the work, which is how Firestore serializes conflicting transactions.
 * A test double for command semantics and concurrency, not emulator evidence.
 */
export class FakeAdminStore implements AdminStore {
  docs = new Map<string, { data: Doc; version: number }>();
  writes = 0;
  private clock = 0;
  seed(path: string, data: Doc) { this.docs.set(path, { data: structuredClone(data), version: ++this.clock }); }
  get(path: string): Doc | undefined { return this.docs.get(path)?.data; }
  children(collection: string) { return [...this.docs].filter(([p]) => childOf(collection, p)).map(([p, e]) => ({ id: p.split("/").pop()!, data: e.data })); }
  private collectionVersion(collection: string) {
    return this.children(collection).length * 1_000_000 + [...this.docs].filter(([p]) => childOf(collection, p)).reduce((n, [, e]) => n + e.version, 0);
  }

  private resolve(current: Doc | undefined, data: Doc): Doc {
    const out: Doc = { ...(current ?? {}) };
    for (const [key, value] of Object.entries(data)) {
      const op = (value as { __op?: string } | null)?.__op;
      if (op === "serverTime") out[key] = NOW;
      else if (op === "increment") out[key] = ((out[key] as number | undefined) ?? 0) + (value as { by: number }).by;
      else if (op === "deleteField") delete out[key];
      else out[key] = structuredClone(value);
    }
    return out;
  }

  private tx(seen: Map<string, number>, pending: Array<() => void> | null): AdminTransaction {
    const queue = (apply: () => void) => { if (!pending) throw new Error("write in read-only transaction"); pending.push(apply); };
    return {
      get: async path => { await tick(); const e = this.docs.get(path); seen.set(path, e?.version ?? 0); return e ? structuredClone(e.data) : null; },
      list: async (collection: string, query: ListQuery) => {
        await tick();
        seen.set(`collection:${collection}`, this.collectionVersion(collection));
        return this.children(collection)
          .filter(c => (query.where ?? []).every(([f, v]) => c.data[f] === v))
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .filter(c => !query.afterId || c.id > query.afterId)
          .slice(0, query.limit).map(c => { seen.set(`${collection}/${c.id}`, this.docs.get(`${collection}/${c.id}`)!.version); return { id: c.id, data: structuredClone(c.data) }; });
      },
      count: async (collection, where) => { await tick(); seen.set(`collection:${collection}`, this.collectionVersion(collection)); return this.children(collection).filter(c => (where ?? []).every(([f, v]) => c.data[f] === v)).length; },
      create: (path, data) => queue(() => { if (this.docs.has(path)) throw new Error(`ALREADY_EXISTS ${path}`); this.seed(path, this.resolve(undefined, data)); this.writes++; }),
      update: (path, data) => queue(() => { const cur = this.docs.get(path); if (!cur) throw new Error(`NOT_FOUND ${path}`); this.seed(path, this.resolve(cur.data, data)); this.writes++; }),
      delete: path => queue(() => { this.docs.delete(path); this.writes++; }),
    };
  }

  async runTransaction<T>(work: (tx: AdminTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 25; attempt++) {
      const seen = new Map<string, number>();
      const pending: Array<() => void> = [];
      const result = await work(this.tx(seen, pending));
      await tick();
      const stale = [...seen].some(([key, version]) => key.startsWith("collection:")
        ? this.collectionVersion(key.slice("collection:".length)) !== version : (this.docs.get(key)?.version ?? 0) !== version);
      if (stale) continue;
      const creates = pending.length; void creates;
      for (const apply of pending) apply();
      return result;
    }
    throw new Error("transaction contention");
  }

  runReadOnly<T>(work: (tx: AdminTransaction) => Promise<T>): Promise<T> {
    return work(this.tx(new Map(), null));
  }

  async queryGroup(group: string, query: GroupQuery) {
    const matches = [...this.docs].filter(([p]) => p.split("/").length % 2 === 0 && p.split("/").slice(-2)[0] === group)
      .filter(([, e]) => query.where.every(([f, op, v]) => {
        const actual = e.data[f];
        const a = actual instanceof Date ? actual.getTime() : actual, b = v instanceof Date ? v.getTime() : v;
        return op === "==" ? a === b : op === ">" ? (a as number) > (b as number) : (a as number) >= (b as number);
      }));
    if (query.orderBy) matches.sort(([, x], [, y]) => +(x.data[query.orderBy!] as Date) - +(y.data[query.orderBy!] as Date));
    return matches.slice(0, query.limit).map(([path, e]) => ({ path, data: structuredClone(e.data) }));
  }

  private sourceDocs(source: QuerySource, where: ReadonlyArray<Filter>) {
    const value = (v: unknown) => (v instanceof Date ? v.getTime() : v);
    return [...this.docs].filter(([p]) => {
      const parts = p.split("/");
      if (parts.length % 2 !== 0) return false;
      return "collection" in source ? childOf(source.collection, p) : parts[parts.length - 2] === source.group;
    }).filter(([, e]) => where.every(([f, op, v]) => {
      const a = value(e.data[f]) as number | string | undefined, b = value(v) as number | string;
      if (a === undefined) return false;
      return op === "==" ? a === b : op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b : a <= b;
    }));
  }

  async aggregate(source: QuerySource, where: ReadonlyArray<Filter>, sumField?: string) {
    const rows = this.sourceDocs(source, where);
    return { count: rows.length, sum: sumField ? rows.reduce((n, [, e]) => n + (typeof e.data[sumField] === "number" ? (e.data[sumField] as number) : 0), 0) : 0 };
  }

  async queryDocs(source: QuerySource, query: DocQuery) {
    const rows = this.sourceDocs(source, query.where);
    const key = (e: { data: Doc }) => { const v = e.data[query.orderBy!]; return v instanceof Date ? v.getTime() : (v as number); };
    if (query.orderBy) rows.sort(([, x], [, y]) => (query.descending ? -1 : 1) * (key(x) - key(y)));
    return rows.slice(0, query.limit).map(([path, e]) => ({ path, data: structuredClone(e.data) }));
  }

  async getDoc(path: string) { const e = this.docs.get(path); return e ? structuredClone(e.data) : null; }
  async setDoc(path: string, data: Doc) { this.seed(path, data); }

  async deletePage(collection: string, limit: number) {
    const ids = this.children(collection).slice(0, limit);
    for (const c of ids) this.docs.delete(`${collection}/${c.id}`);
    return ids.length;
  }
}

export class FakeObjects implements ObjectStore {
  removed: string[] = [];
  async remove(path: string) { this.removed.push(path); return true; }
}

export class FakeSessions implements SessionRevoker {
  revoked: string[] = [];
  async revoke(uid: string) { this.revoked.push(uid); }
}

export function makeDeps(store = new FakeAdminStore()) {
  const objects = new FakeObjects();
  const sessions = new FakeSessions();
  let n = 0;
  const deps: AdminDeps = { store, objects, sessions, now: () => NOW, newId: () => `id${String(++n).padStart(4, "0")}` };
  return { deps, store, objects, sessions };
}

export const caller = (uid: string, overrides: Partial<Caller> = {}): Caller => ({ uid, emailVerified: true, signInProvider: "google.com", ...overrides });

let counter = 0;
/** A fresh valid idempotency key. */
export const rid = () => `req-${String(++counter).padStart(8, "0")}`;

export function seedCompany(store: FakeAdminStore) {
  store.seed("companies/alpha", { name: "Alpha", emailDomain: "alpha.test" });
  store.seed("companies/beta", { name: "Beta", emailDomain: "beta.test" });
  const user = (extra: Doc) => ({ avatarId: "a1", department: "Eng", jobTitle: "", city: "", photoURL: "", interestTagIds: ["t1"], travelRadiusMiles: 5,
    availability: [], friendIds: [], favoritePhotoIds: [], pointsBalance: 0, ...extra });
  store.seed("users/admin1", user({ companyId: "alpha", role: "admin", displayName: "Ada Admin", email: "ada@alpha.test" }));
  store.seed("users/admin2", user({ companyId: "alpha", role: "admin", displayName: "Abe Admin", email: "abe@alpha.test" }));
  store.seed("users/org1", user({ companyId: "alpha", role: "organizer", displayName: "Olive Organizer", email: "olive@alpha.test" }));
  store.seed("users/m1", user({ companyId: "alpha", role: "member", displayName: "Mia Member", email: "mia@alpha.test", pointsBalance: 100, avatarId: "av9", city: "Pittsburgh", favoritePhotoIds: ["p1"] }));
  store.seed("users/m2", user({ companyId: "alpha", role: "member", displayName: "Max Member", email: "max@alpha.test", department: "Sales" }));
  store.seed("users/m3", user({ companyId: "alpha", role: "member", displayName: "Moe Member", email: "moe@alpha.test" }));
  store.seed("users/deact", user({ companyId: "alpha", role: "member", displayName: "Dee Gone", email: "dee@alpha.test", status: "deactivated" }));
  store.seed("users/bo", user({ companyId: "beta", role: "admin", displayName: "Bo Beta", email: "bo@beta.test" }));
  store.seed("users/bea", user({ companyId: "beta", role: "member", displayName: "Bea Beta", email: "bea@beta.test" }));
  const event = (extra: Doc) => ({ companyId: "alpha", title: "Boat Ride", status: "scheduled", capacity: 2, attendeeCount: 0, revision: 1, pointsValue: 0, ...extra });
  store.seed("companies/alpha/events/past", event({ startTime: new Date("2030-01-01T10:00:00Z"), endTime: new Date("2030-01-01T12:00:00Z") }));
  store.seed("companies/alpha/events/live", event({ startTime: new Date("2030-01-02T11:00:00Z"), endTime: new Date("2030-01-02T14:00:00Z"), pointsValue: 5 }));
  store.seed("companies/alpha/events/soon", event({ startTime: new Date("2030-01-03T10:00:00Z"), endTime: new Date("2030-01-03T12:00:00Z") }));
  store.seed("companies/alpha/events/cancelled", event({ status: "cancelled", startTime: new Date("2030-01-04T10:00:00Z"), endTime: new Date("2030-01-04T12:00:00Z") }));
  store.seed("companies/beta/events/bevent", event({ companyId: "beta", startTime: new Date("2030-01-03T10:00:00Z"), endTime: new Date("2030-01-03T12:00:00Z") }));
}
