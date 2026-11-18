import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { CallableRequest } from "firebase-functions/v2/https";
import * as exported from "../../functions/src/index";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { adminHandlers, toHttpsError } from "../../functions/src/modules/admin/transport/adminCallables";
import { createDispatcher, DISPATCH_LIMITS, type DispatchLogEntry } from "../../functions/src/modules/dispatcher/transport/dispatch";
import { dipApiOptions, productionHandlers, productionRegistry } from "../../functions/src/modules/dispatcher/transport/dipApiV1";
import { buildRegistry, type CommandHandler, type HandlerSets } from "../../functions/src/modules/dispatcher/transport/registry";
import { caller, makeDeps, rid, seedCompany } from "./helpers/adminFakes";

type HttpsError = Error & { code: string; details?: unknown };
/** HttpsError comes from the functions workspace's own firebase-functions copy; match it structurally. */
const isHttpsError = (error: unknown): error is HttpsError =>
  error instanceof Error && error.constructor.name === "HttpsError" && typeof (error as { code?: unknown }).code === "string";

// The production handlers build lazy Admin SDK clients; a project ID keeps them from probing the environment.
process.env.GCLOUD_PROJECT ??= "demo-dispatcher";

type Endpoint = { callableTrigger?: object; availableMemoryMb?: unknown; timeoutSeconds?: unknown; secretEnvironmentVariables?: unknown[] };
type Exported = { __endpoint?: Endpoint; run?: (request: CallableRequest) => Promise<unknown> };
const exports = exported as unknown as Record<string, Exported>;

const MIGRATED = [
  "removeEventPhotoV1", "removeEventPhotoCommentV1", "addEventAttendeeV1", "removeEventAttendeeV1", "recordAttendanceV1",
  "listMembersV1", "getMemberV1", "updateMemberV1", "resetMemberProfileV1", "adjustMemberPointsV1",
  "upsertRosterEntryV1", "revokeRosterEntryV1", "resendRosterInviteV1", "listRosterV1", "getEmployeeImportV1",
  "listBugReportsV1", "getBugReportV1", "updateBugReportV1", "getCompanyInsightsV1",
  "createEventV1", "updateEventV1", "createChallengeV1", "updateChallengeV1",
  "listChallengeSubmissionsV1", "approveChallengeV1", "rejectChallengeV1",
  "autocompletePlacesV1", "resolvePlaceV1", "setCompanyOfficeV1",
].sort();

const auth = (uid: string, overrides: Record<string, unknown> = {}) =>
  ({ uid, token: { email_verified: true, firebase: { sign_in_provider: "google.com" }, ...overrides } }) as unknown as CallableRequest["auth"];
/** `who` null = signed out. */
type Who = CallableRequest["auth"] | null;
const request = (data: unknown, who: Who = auth("admin1")) => ({ data, auth: who ?? undefined }) as CallableRequest;
const envelope = (command: string, payload: unknown, who: Who = auth("admin1")) => request({ command, payload }, who);

/** A thrown callable error reduced to what the client receives. */
async function outcome(promise: Promise<unknown>): Promise<unknown> {
  try {
    return { ok: await promise };
  } catch (error) {
    assert.ok(isHttpsError(error), `expected HttpsError, got ${String(error)}`);
    return { code: error.code, message: error.message, details: error.details };
  }
}

async function rejects(promise: Promise<unknown>, code: string, reason: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(isHttpsError(error), String(error));
    assert.equal(error.code, code);
    assert.equal((error.details as { reason?: string }).reason, reason);
    return true;
  });
}

/** Handler sets of spies with the production shape: every handler records its call and echoes its own name. */
function spySets() {
  const calls: Array<{ name: string; request: CallableRequest }> = [];
  const sets = Object.fromEntries(Object.entries(productionHandlers).map(([module, set]) => [module, Object.fromEntries(
    Object.keys(set).map(name => [name, (async (req: CallableRequest) => { calls.push({ name, request: req }); return { handledBy: name }; }) as CommandHandler]),
  )])) as unknown as HandlerSets;
  return { sets, calls };
}

describe("registry completeness", () => {
  test("serves exactly the migrated commands", () => {
    assert.deepEqual([...productionRegistry.keys()].sort(), MIGRATED);
  });

  test("each command uses the same handler object as the standalone callable of that name", () => {
    for (const [name, spec] of productionRegistry) {
      const owners = Object.entries(productionHandlers).filter(([, set]) => (set as Record<string, unknown>)[name] === spec.handler);
      assert.equal(owners.length, 1, `${name} must reference its module's ${name} handler`);
    }
  });

  test("each command is still a standalone callable that fits the dispatcher (no secrets, <= 60 s, <= 512 MiB)", () => {
    for (const name of productionRegistry.keys()) {
      const endpoint = exports[name]?.__endpoint;
      assert.ok(endpoint?.callableTrigger, `${name} stays exported as a callable for shipped clients`);
      assert.equal(endpoint.secretEnvironmentVariables?.length ?? 0, 0, `${name} binds no secrets`);
      const timeout = typeof endpoint.timeoutSeconds === "number" ? endpoint.timeoutSeconds : 60;
      const memory = typeof endpoint.availableMemoryMb === "number" ? endpoint.availableMemoryMb : 256;
      assert.ok(timeout <= dipApiOptions.timeoutSeconds, `${name} timeout ${timeout}`);
      assert.ok(memory <= 512, `${name} memory ${memory}`);
    }
    const dispatcher = exports.dipApiV1?.__endpoint as Endpoint & { minInstances?: unknown; maxInstances?: unknown };
    assert.ok(dispatcher?.callableTrigger);
    assert.equal(dispatcher.availableMemoryMb, 512);
    assert.equal(dispatcher.minInstances, 1);
  });

  test("each request schema exists in the V1 contract", () => {
    const schema = JSON.parse(readFileSync(new URL("../../../contracts/v1/models.schema.json", import.meta.url), "utf8")) as { $defs: Record<string, unknown> };
    for (const [name, spec] of productionRegistry) assert.ok(schema.$defs[spec.request], `${name}: ${spec.request}`);
  });

  test("the admin portal's dispatched list matches the registry", () => {
    const source = readFileSync(new URL("../../../apps/admin/src/lib/dispatcher.ts", import.meta.url), "utf8");
    const block = /DISPATCHED_COMMANDS[^=]*= new Set\(\[([\s\S]*?)\]\)/.exec(source)?.[1] ?? "";
    assert.deepEqual([...block.matchAll(/"([A-Za-z0-9]+)"/g)].map(m => m[1]).sort(), MIGRATED);
  });

  test("the production dispatcher and the standalone callable answer identically (unverified caller, every command)", async () => {
    const dispatch = createDispatcher(productionRegistry);
    const unverified = auth("u1", { email_verified: false });
    for (const name of productionRegistry.keys()) {
      const payload = { contractVersion: 1, companyId: "alpha" };
      const standalone = await outcome(exports[name]!.run!(request(payload, unverified)));
      const viaDispatcher = await outcome(dispatch(envelope(name, payload, unverified)));
      assert.deepEqual(viaDispatcher, standalone, name);
      assert.ok(!("ok" in (standalone as object)), `${name} refuses an unverified caller`);
    }
  });

  test("unauthenticated: refused before any handler runs, with the standalone code and reason", async () => {
    const { sets, calls } = spySets();
    const dispatch = createDispatcher(buildRegistry(sets));
    type Refusal = { code: string; details: { reason: string } };
    for (const name of productionRegistry.keys()) {
      const payload = ADMIN_PAYLOADS[name]?.() ?? base();
      const standalone = await outcome(exports[name]!.run!(request(payload, null))) as Refusal;
      const viaDispatcher = await outcome(dispatch(envelope(name, payload, null))) as Refusal;
      assert.deepEqual([viaDispatcher.code, viaDispatcher.details.reason], ["unauthenticated", "UNAUTHENTICATED"], name);
      // With a schema-valid payload the standalone answer is the same. (Some standalone handlers parse before the
      // auth check, so a signed-out caller with a malformed payload gets invalid-argument there; still a refusal.)
      if (ADMIN_PAYLOADS[name]) assert.deepEqual([standalone.code, standalone.details.reason], ["unauthenticated", "UNAUTHENTICATED"], name);
      else assert.ok(["unauthenticated", "invalid-argument"].includes(standalone.code), `${name}: ${standalone.code}`);
    }
    assert.equal(calls.length, 0);
  });
});

describe("routing", () => {
  test("routes each command to its handler with the caller's request and the payload as data; returns the response as is", async () => {
    const { sets, calls } = spySets();
    const dispatch = createDispatcher(buildRegistry(sets));
    for (const name of MIGRATED) {
      const payload = { contractVersion: 1, companyId: "alpha", marker: name };
      const req = { ...envelope(name, payload), app: { appId: "app", token: {} }, rawRequest: { headers: {} } } as unknown as CallableRequest;
      assert.deepEqual(await dispatch(req), { handledBy: name });
      const last = calls.at(-1)!;
      assert.equal(last.name, name);
      assert.equal(last.request.data, payload, "the payload object itself, not a copy");
      assert.equal(last.request.auth, req.auth);
      assert.equal(last.request.app, req.app, "App Check context passes through");
      assert.equal(last.request.rawRequest, req.rawRequest);
    }
  });

  test("a handler's HttpsError passes through unchanged; anything else becomes a generic internal error", async () => {
    const failure = toHttpsError(new AdminError("failed-precondition", "EVENT_CLOSED" as never, "Closed.", ["eventId"]));
    const registry = new Map([
      ["failsV1", { handler: async () => { throw failure; }, minRole: "admin", rateLimit: "adminRateLimits/{uid}", request: "X", mutating: false }],
      ["crashesV1", { handler: async () => { throw new Error("secret stack detail"); }, minRole: "admin", rateLimit: "adminRateLimits/{uid}", request: "X", mutating: false }],
    ] as const);
    const dispatch = createDispatcher(registry);
    await assert.rejects(dispatch(envelope("failsV1", {})), (error: unknown) => error === failure);
    await assert.rejects(dispatch(envelope("crashesV1", {})), (error: unknown) =>
      isHttpsError(error) && error.code === "internal" && !error.message.includes("secret"));
  });
});

describe("envelope, unknown command and size limits", () => {
  const { sets, calls } = spySets();
  const logs: DispatchLogEntry[] = [];
  const dispatch = createDispatcher(buildRegistry(sets), { log: entry => logs.push(entry), limits: { maxRequestBytes: 200, maxResponseBytes: 40 } });

  test("unknown commands are a typed not-found, including Object.prototype names", async () => {
    for (const name of ["deleteEverythingV1", "toString", "constructor", "hasOwnProperty", "generateEventDraftsV1", "setMemberStatusV1"]) {
      await rejects(dispatch(envelope(name, {})), "not-found", "UNKNOWN_COMMAND");
    }
    assert.equal(calls.length, 0);
  });

  test("malformed envelopes are invalid-argument", async () => {
    for (const data of [null, "listMembersV1", [], { payload: {} }, { command: 7, payload: {} }, { command: "__proto__", payload: {} },
      { command: "list members", payload: {} }, { command: "x".repeat(65), payload: {} }, { command: "listMembersV1" },
      { command: "listMembersV1", payload: "x" }, { command: "listMembersV1", payload: [] }]) {
      await rejects(dispatch(request(data)), "invalid-argument", "DISPATCH_INVALID_ENVELOPE");
    }
    assert.equal(calls.length, 0);
  });

  test("an oversized payload is refused before the handler runs; the raw body length wins when present", async () => {
    await rejects(dispatch(envelope("listMembersV1", { blob: "x".repeat(300) })), "invalid-argument", "DISPATCH_PAYLOAD_TOO_LARGE");
    const small = { ...envelope("listMembersV1", {}), rawRequest: { rawBody: Buffer.alloc(500) } } as unknown as CallableRequest;
    await rejects(dispatch(small), "invalid-argument", "DISPATCH_PAYLOAD_TOO_LARGE");
    assert.equal(calls.length, 0);
    assert.ok(DISPATCH_LIMITS.maxRequestBytes >= 64 * 1024 && DISPATCH_LIMITS.maxResponseBytes >= 1024 * 1024);
  });

  test("an oversized response is an internal error", async () => {
    const big = createDispatcher(new Map([["bigV1", { handler: async () => ({ rows: "y".repeat(100) }), minRole: "admin", rateLimit: "adminRateLimits/{uid}", request: "X", mutating: false }]] as const),
      { limits: { maxRequestBytes: 200, maxResponseBytes: 40 } });
    await rejects(big(envelope("bigV1", {})), "internal", "DISPATCH_RESPONSE_TOO_LARGE");
  });

  test("logs the command, outcome, timing and sizes only: never the uid, payload or response", async () => {
    logs.length = 0;
    await dispatch(envelope("getMemberV1", { userId: "private-user-42" }, auth("uid-secret-7")));
    await dispatch(envelope("nopeV1", { userId: "private-user-42" }, auth("uid-secret-7"))).catch(() => undefined);
    assert.deepEqual(logs.map(l => [l.command, l.outcome, l.reason ?? null]), [["getMemberV1", "ok", null], ["nopeV1", "not-found", "UNKNOWN_COMMAND"]]);
    for (const entry of logs) {
      assert.deepEqual(Object.keys(entry).filter(k => !["command", "outcome", "reason", "ms", "requestBytes", "responseBytes"].includes(k)), []);
      const text = JSON.stringify(entry);
      assert.ok(!text.includes("uid-secret-7") && !text.includes("private-user-42") && !text.includes("handledBy"), text);
    }
  });
});

const HASH = "a".repeat(64);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = () => ({ contractVersion: 1, companyId: "alpha" });
/** A schema-valid payload for every migrated admin command (fixed per test so two stores see the same input). */
const ADMIN_PAYLOADS: Record<string, () => Record<string, unknown>> = {
  removeEventPhotoV1: () => ({ ...base(), requestId: rid(), eventId: "past", photoId: "m1_0" }),
  removeEventPhotoCommentV1: () => ({ ...base(), requestId: rid(), eventId: "past", photoId: "m1_0", commentId: "c1" }),
  addEventAttendeeV1: () => ({ ...base(), requestId: rid(), eventId: "soon", userId: "m1" }),
  removeEventAttendeeV1: () => ({ ...base(), requestId: rid(), eventId: "soon", userId: "m1" }),
  recordAttendanceV1: () => ({ ...base(), eventId: "live", userId: "m1" }),
  listMembersV1: () => base(),
  getMemberV1: () => ({ ...base(), userId: "m1" }),
  updateMemberV1: () => ({ ...base(), requestId: rid(), userId: "m1", workLocation: "HQ" }),
  resetMemberProfileV1: () => ({ ...base(), requestId: rid(), userId: "m1" }),
  adjustMemberPointsV1: () => ({ ...base(), requestId: rid(), userId: "m1", delta: 5, reason: "Bonus" }),
  upsertRosterEntryV1: () => ({ ...base(), requestId: rid(), entry: { email: "new@alpha.test" } }),
  revokeRosterEntryV1: () => ({ ...base(), requestId: rid(), entryId: HASH }),
  resendRosterInviteV1: () => ({ ...base(), requestId: rid(), entryId: HASH }),
  listRosterV1: () => base(),
  getEmployeeImportV1: () => ({ ...base(), jobId: "job1" }),
  listBugReportsV1: () => base(),
  getBugReportV1: () => ({ ...base(), reportId: uuid(1) }),
  updateBugReportV1: () => ({ ...base(), requestId: rid(), reportId: uuid(2), status: "triaged" }),
  getCompanyInsightsV1: () => base(),
};

/** A fresh seeded fake world: the real admin handlers over fake deps, spies for the other modules. */
function world() {
  const { deps, store } = makeDeps();
  seedCompany(store);
  const real = adminHandlers(() => deps);
  const { sets } = spySets();
  const dispatch = createDispatcher(buildRegistry({ ...sets, admin: real }));
  return { deps, store, real, dispatch };
}

describe("admin commands: dispatched behavior equals the standalone handler", () => {
  test("covers every migrated admin command", () => {
    const adminNames = [...productionRegistry].filter(([, spec]) => Object.values(productionHandlers.admin).includes(spec.handler as never)).map(([n]) => n).sort();
    assert.deepEqual(Object.keys(ADMIN_PAYLOADS).sort(), adminNames);
  });

  for (const [name, payloadOf] of Object.entries(ADMIN_PAYLOADS)) {
    test(name, async () => {
      for (const who of ["admin1", "org1", "m1", "bo", "deact", "nobody"]) {
        const payload = payloadOf();
        const direct = world();
        const routed = world();
        const handler = (direct.real as Record<string, CommandHandler>)[name]!;
        const expected = await outcome(handler(request(payload, auth(who))));
        const actual = await outcome(routed.dispatch(envelope(name, payload, auth(who))));
        assert.deepEqual(actual, expected, `${name} as ${who}`);
        // Same writes, including audit entries and idempotency receipts.
        assert.deepEqual(Object.fromEntries([...routed.store.docs].map(([p, e]) => [p, e.data])), Object.fromEntries([...direct.store.docs].map(([p, e]) => [p, e.data])), `${name} as ${who}: stored state`);
        // Role and tenant: a member and another company's admin are always refused, and nothing is written.
        const reason = (actual as { details?: { reason?: string } }).details?.reason;
        if (who === "m1") assert.equal(reason, "INSUFFICIENT_ROLE");
        if (who === "bo") assert.equal(reason, "COMPANY_MISMATCH", "another tenant's admin cannot act on alpha");
        if (who === "org1") {
          const spec = productionRegistry.get(name)!;
          if (spec.minRole === "admin") assert.equal(reason, "INSUFFICIENT_ROLE", `${name} is admin-only`);
          else assert.notEqual(reason, "INSUFFICIENT_ROLE", `${name} admits organizers`);
        }
        if (["m1", "bo", "deact", "nobody"].includes(who)) assert.equal(routed.store.writes, 0);
      }
    });
  }

  test("a mutating command replays from its receipt when the client retries through the other transport", async () => {
    const { real, dispatch, store } = world();
    const payload = { ...base(), requestId: rid(), userId: "m1", delta: 5, reason: "Bonus" };
    const first = await dispatch(envelope("adjustMemberPointsV1", payload)) as Record<string, unknown>;
    const retry = await real.adjustMemberPointsV1(request(payload)) as Record<string, unknown>;
    assert.deepEqual({ ...retry, replayed: undefined }, { ...first, replayed: undefined });
    assert.equal(store.get("users/m1")!.pointsBalance, 105, "awarded once");
  });
});

describe("rate limiting", () => {
  test("dispatched and standalone calls draw from the same per-uid budget", async () => {
    const { deps, real, dispatch } = world();
    const consumed: string[] = [];
    deps.limiter = { consume: async uid => { consumed.push(uid); if (consumed.length > 2) throw new AdminError("resource-exhausted", "RATE_LIMITED", "Too many requests. Try again later."); } };
    await dispatch(envelope("getMemberV1", { ...base(), userId: "m1" }));
    await real.getMemberV1(request({ ...base(), userId: "m1" }));
    await rejects(dispatch(envelope("listMembersV1", base())), "resource-exhausted", "RATE_LIMITED");
    await rejects(real.listMembersV1(request(base())), "resource-exhausted", "RATE_LIMITED");
    assert.deepEqual(consumed, ["admin1", "admin1", "admin1", "admin1"]);
  });

  test("an unauthorized caller never reaches the limiter through the dispatcher", async () => {
    const { deps, dispatch } = world();
    const consumed: string[] = [];
    deps.limiter = { consume: async uid => { consumed.push(uid); } };
    await dispatch(envelope("listMembersV1", base(), auth("m1"))).catch(() => undefined);
    await dispatch(envelope("listMembersV1", base(), auth("bo"))).catch(() => undefined);
    await dispatch(envelope("listMembersV1", base(), null)).catch(() => undefined);
    assert.deepEqual(consumed, []);
  });
});
