import { describe, expect, it } from "vitest";
import { ADMIN_CALLABLES } from "../adminTypes";
import {
  type CallableTransport, DISPATCHED_COMMANDS, DISPATCHER_CALLABLE, createCallableInvoker, dispatcherEnabled, dispatcherFailure,
} from "../dispatcher";

/** A FunctionsError look-alike, as the Firebase SDK throws it. */
const sdkError = (code: string, message: string, details?: unknown) => Object.assign(new Error(message), { code: `functions/${code}`, details });

/** A recording transport: `answer` decides each call's result by callable name. */
function transport(answer: (name: string, data: unknown) => unknown) {
  const calls: Array<{ name: string; data: unknown }> = [];
  const call: CallableTransport = async (name, data) => {
    calls.push({ name, data });
    const result = answer(name, data);
    if (result instanceof Error) throw result;
    return result;
  };
  return { call, calls };
}

describe("dispatcher flag", () => {
  it("is on by default and off only when the build says so", () => {
    expect(dispatcherEnabled(undefined)).toBe(true);
    expect(dispatcherEnabled("")).toBe(true);
    expect(dispatcherEnabled("on")).toBe(true);
    for (const off of ["off", "false", "0", " OFF "]) expect(dispatcherEnabled(off)).toBe(false);
  });
});

describe("dispatched command list", () => {
  it("covers the portal's light admin callables and none of the AI, cover, import or heavy ones", () => {
    for (const name of ["listMembersV1", "getMemberV1", "listRosterV1", "listBugReportsV1", "getCompanyInsightsV1", "createEventV1", "updateChallengeV1", "autocompletePlacesV1"]) {
      expect(DISPATCHED_COMMANDS.has(name), name).toBe(true);
    }
    for (const name of [ADMIN_CALLABLES.generateEventDrafts, ADMIN_CALLABLES.eventIdeaContext, ADMIN_CALLABLES.findVenues, ADMIN_CALLABLES.pickEventCover,
      ADMIN_CALLABLES.planImport, ADMIN_CALLABLES.applyImport, ADMIN_CALLABLES.backfillRoster, ADMIN_CALLABLES.setMemberStatus, "resolveMembershipV1"]) {
      expect(DISPATCHED_COMMANDS.has(name), name).toBe(false);
    }
    expect(DISPATCHED_COMMANDS.size).toBe(29);
  });
});

describe("createCallableInvoker", () => {
  const payload = { contractVersion: 1, companyId: "alpha", userId: "m1" };

  it("sends a dispatched command as { command, payload } to dipApiV1 and returns its response as is", async () => {
    const response = { member: { userId: "m1" } };
    const { call, calls } = transport(() => response);
    const invoke = createCallableInvoker(call, true);
    await expect(invoke("getMemberV1", payload)).resolves.toBe(response);
    expect(calls).toEqual([{ name: DISPATCHER_CALLABLE, data: { command: "getMemberV1", payload } }]);
  });

  it("calls the standalone callable directly when the flag is off or the command is not dispatched", async () => {
    const { call, calls } = transport(() => ({ ok: true }));
    await createCallableInvoker(call, false)("getMemberV1", payload);
    await createCallableInvoker(call, true)("generateEventDraftsV1", payload);
    expect(calls.map((c) => c.name)).toEqual(["getMemberV1", "generateEventDraftsV1"]);
    expect(calls[0].data).toBe(payload);
  });

  it("passes the command's own errors through without a retry, including its not-found", async () => {
    for (const error of [
      sdkError("not-found", "Member not found. [404]", { reason: "MEMBER_NOT_FOUND" }),
      sdkError("permission-denied", "You don't have permission to do this. [403]", { reason: "INSUFFICIENT_ROLE" }),
      sdkError("internal", "Something went wrong. Try again later. [500]"),
      sdkError("resource-exhausted", "Too many requests. [429]", { reason: "RATE_LIMITED" }),
      sdkError("unavailable", "Places are unavailable. [503]", { reason: "PLACES_UNAVAILABLE" }),
    ]) {
      const { call, calls } = transport(() => error);
      await expect(createCallableInvoker(call, true)("getMemberV1", payload)).rejects.toBe(error);
      expect(calls.map((c) => c.name)).toEqual([DISPATCHER_CALLABLE]);
    }
  });

  it("falls back for an unknown command and keeps that one command direct afterwards", async () => {
    const { call, calls } = transport((name) =>
      name === DISPATCHER_CALLABLE ? sdkError("not-found", "Unknown command. [404]", { reason: "UNKNOWN_COMMAND", fields: ["command"] }) : { via: name });
    const invoke = createCallableInvoker(call, true);
    await expect(invoke("getMemberV1", payload)).resolves.toEqual({ via: "getMemberV1" });
    await expect(invoke("getMemberV1", payload)).resolves.toEqual({ via: "getMemberV1" });
    await invoke("listMembersV1", payload);
    expect(calls.map((c) => c.name)).toEqual([DISPATCHER_CALLABLE, "getMemberV1", "getMemberV1", DISPATCHER_CALLABLE, "listMembersV1"]);
    expect(calls[1].data).toBe(payload);
  });

  it.each([
    ["a missing function in the browser (status 0)", sdkError("internal", "internal [0]")],
    ["a missing function in the emulator (404, no details)", sdkError("not-found", "not-found [404]")],
    ["an unavailable service", sdkError("unavailable", "unavailable [503]")],
  ])("falls back on %s and stays direct for the session", async (_label, error) => {
    const { call, calls } = transport((name) => (name === DISPATCHER_CALLABLE ? error : { via: name }));
    const invoke = createCallableInvoker(call, true);
    await expect(invoke("updateMemberV1", { ...payload, requestId: "r1" })).resolves.toEqual({ via: "updateMemberV1" });
    await invoke("listRosterV1", payload);
    expect(calls.map((c) => c.name)).toEqual([DISPATCHER_CALLABLE, "updateMemberV1", "listRosterV1"]);
    expect(calls[1].data).toEqual({ ...payload, requestId: "r1" }); // the retry reuses the requestId: a replay, not a second write
  });

  it("surfaces the standalone error when the fallback also fails", async () => {
    const direct = sdkError("permission-denied", "No. [403]", { reason: "INSUFFICIENT_ROLE" });
    const { call } = transport((name) => (name === DISPATCHER_CALLABLE ? sdkError("internal", "internal [0]") : direct));
    await expect(createCallableInvoker(call, true)("listMembersV1", payload)).rejects.toBe(direct);
  });
});

describe("dispatcherFailure", () => {
  it("classifies only dispatcher-level failures as retryable", () => {
    expect(dispatcherFailure(sdkError("not-found", "x", { reason: "UNKNOWN_COMMAND" }))).toBe("unknown-command");
    expect(dispatcherFailure(sdkError("not-found", "not-found [404]"))).toBe("unreachable");
    expect(dispatcherFailure(sdkError("internal", "internal"))).toBe("unreachable");
    expect(dispatcherFailure(sdkError("not-found", "x", { reason: "EVENT_NOT_FOUND" }))).toBe("none");
    expect(dispatcherFailure(sdkError("invalid-argument", "x", { reason: "DISPATCH_INVALID_ENVELOPE" }))).toBe("none");
    expect(dispatcherFailure(new Error("plain"))).toBe("none");
    expect(dispatcherFailure(null)).toBe("none");
  });
});
