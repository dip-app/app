import type { AdminApi } from "./api";

// Mock mode only: `?fail=<scenario>` makes calls fail the way the Firebase SDK does in live mode (code prefix and the
// HTTP status appended), passed through the same adapter, so error states can be reviewed and screenshotted.
// Never applied to the live Firebase adapter.
//   offline   every read fails like a request that got no answer ("internal [0]")
//   save      every write fails with the server's bare "Invalid request. [400]"
//   conflict  every write fails as changed elsewhere ("aborted [409]")
//   long      every write fails with a long server sentence
//   busy      every write fails as the service being unavailable ("unavailable [503]")

const KEEP = new Set(["session", "signIn", "signOut", "listTags"]);
const WRITE = /^(create|update|set|save|record|approve|reject|apply|generate|add|remove|revoke|resend|invite|deactivate|reactivate|adjust|pick|find|cancel|delete|subscribe|unsubscribe|send|triage)/;

type Scenario = "offline" | "save" | "conflict" | "long" | "busy";

function sdkError(scenario: Scenario): unknown {
  const raw = (code: string, message: string, details?: unknown) => Object.assign(new Error(message), { name: "FirebaseError", code: `functions/${code}`, details });
  if (scenario === "offline") return raw("internal", "internal [0]");
  if (scenario === "busy") return raw("unavailable", "unavailable [503]");
  if (scenario === "conflict") return raw("aborted", "This was changed by someone else since you opened it. [409]", { reason: "REVISION_CONFLICT" });
  // The server's longest typed message, with its key so Spanish shows the catalog text.
  if (scenario === "long") {
    return raw("failed-precondition", "The times can't be changed once anyone has responded. Cancel and recreate the event instead. [400]",
      { reason: "TIME_CHANGE_BLOCKED", messageKey: "errors.timeChangeBlocked" });
  }
  return raw("invalid-argument", "Invalid request. [400]", { reason: "VALIDATION_FAILED", messageKey: "errors.validationFailed" });
}

/** Async so the adapter (and the Firebase SDK behind it) loads only when a scenario is asked for. */
export async function failFromQuery(api: AdminApi, search: string): Promise<AdminApi> {
  const value = new URLSearchParams(search).get("fail");
  if (value !== "offline" && value !== "save" && value !== "conflict" && value !== "long" && value !== "busy") return api;
  const scenario: Scenario = value;
  // `&failAfter=N` lets the first N calls of each affected method succeed (an export that fails after the first page).
  const allowed = Number(new URLSearchParams(search).get("failAfter") ?? 0) || 0;
  const calls = new Map<string, number>();
  const { apiErrorFrom } = await import("./firebaseAdapter");
  return new Proxy(api, {
    get(target, prop, receiver) {
      const member = Reflect.get(target, prop, receiver) as unknown;
      if (typeof member !== "function" || typeof prop !== "string" || KEEP.has(prop)) return typeof member === "function" ? member.bind(target) : member;
      const write = WRITE.test(prop);
      if (scenario === "offline" ? write : !write) return member.bind(target);
      return (...args: unknown[]) => {
        const made = calls.get(prop) ?? 0;
        calls.set(prop, made + 1);
        if (made < allowed) return (member as (...a: unknown[]) => unknown).apply(target, args);
        return Promise.reject(apiErrorFrom(sdkError(scenario)));
      };
    },
  });
}
