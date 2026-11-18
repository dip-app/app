import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import type { CommandRegistry } from "./registry";

/**
 * The dispatcher core (docs/design/functions-dispatcher.md): `{ command, payload }` -> the registered handler, called
 * with the caller's own request whose `data` is the payload. The handler's response and HttpsError pass through
 * unchanged, so a client sees exactly what the standalone callable of that name would return.
 *
 * Checked here, before any handler runs: a signed-in caller, the envelope shape, the payload size and a known
 * command. App Check is enforced by `onCall` itself (dipApiV1.ts), as for every standalone callable.
 */

export const DISPATCH_LIMITS = {
  /** Largest serialized payload. The biggest migrated request (an event draft) is a few KiB. */
  maxRequestBytes: 256 * 1024,
  /** Largest serialized response. Every migrated list is paged (at most 100 rows). */
  maxResponseBytes: 8 * 1024 * 1024,
} as const;

/** Letters and digits only: rejects `__proto__`-style names before the lookup and keeps the log field bounded. */
const COMMAND_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const GENERIC_INTERNAL_MESSAGE = "Something went wrong. Try again later.";

export type DispatchOutcome = "ok" | HttpsError["code"];

/** One structured line per call: the command, outcome, timing and sizes. Never the uid, payload or response. */
export interface DispatchLogEntry {
  command: string;
  outcome: DispatchOutcome;
  reason?: string;
  ms: number;
  requestBytes: number;
  responseBytes?: number;
}

export interface DispatchOptions {
  log?: (entry: DispatchLogEntry) => void;
  now?: () => number;
  limits?: { maxRequestBytes: number; maxResponseBytes: number };
}

const bytes = (value: unknown): number => {
  const json = JSON.stringify(value);
  return json === undefined ? 0 : Buffer.byteLength(json, "utf8");
};

/** Prefers the raw body length the framework already read; falls back to the serialized payload (tests). */
function requestSize(request: CallableRequest, payload: unknown): number {
  const raw = (request.rawRequest as { rawBody?: unknown } | undefined)?.rawBody;
  return Buffer.isBuffer(raw) ? raw.length : bytes(payload);
}

function reject(code: HttpsError["code"], reason: string, message: string, fields?: string[]): HttpsError {
  return new HttpsError(code, message, { reason, ...(fields ? { fields } : {}) });
}

function reasonOf(error: HttpsError): string | undefined {
  const details = error.details as { reason?: unknown } | undefined;
  return typeof details?.reason === "string" ? details.reason : undefined;
}

export function createDispatcher(registry: CommandRegistry, options: DispatchOptions = {}) {
  const now = options.now ?? Date.now;
  const limits = options.limits ?? DISPATCH_LIMITS;
  const log = options.log ?? (() => undefined);

  return async (request: CallableRequest): Promise<unknown> => {
    const started = now();
    let command = "invalid";
    let requestBytes = 0;
    try {
      // Unauthenticated callers learn nothing about the envelope or the command list. Every migrated handler
      // rejects them with the same code and reason; the role, provider and email checks stay in the handler.
      if (!request.auth) throw reject("unauthenticated", "UNAUTHENTICATED", "Sign in to continue.");

      const data = request.data as { command?: unknown; payload?: unknown } | null;
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw reject("invalid-argument", "DISPATCH_INVALID_ENVELOPE", "Send { command, payload }.", ["command", "payload"]);
      }
      if (typeof data.command !== "string" || !COMMAND_NAME.test(data.command)) {
        throw reject("invalid-argument", "DISPATCH_INVALID_ENVELOPE", "The command name is invalid.", ["command"]);
      }
      command = data.command;
      const payload = data.payload;
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        throw reject("invalid-argument", "DISPATCH_INVALID_ENVELOPE", "The payload must be an object.", ["payload"]);
      }
      requestBytes = requestSize(request, payload);
      if (requestBytes > limits.maxRequestBytes) {
        throw reject("invalid-argument", "DISPATCH_PAYLOAD_TOO_LARGE", "The request is too large.", ["payload"]);
      }

      const spec = registry.get(command);
      if (!spec) throw reject("not-found", "UNKNOWN_COMMAND", "Unknown command.", ["command"]);

      // The handler sees the caller's request (auth, App Check, raw request) with the payload as its data.
      const result = await spec.handler({ ...request, data: payload });

      const responseBytes = bytes(result);
      if (responseBytes > limits.maxResponseBytes) {
        // Every migrated read is paged, so this is a bug, not a user error. A mutation has already committed.
        throw reject("internal", "DISPATCH_RESPONSE_TOO_LARGE", GENERIC_INTERNAL_MESSAGE);
      }
      log({ command, outcome: "ok", ms: now() - started, requestBytes, responseBytes });
      return result;
    } catch (error) {
      // Handlers already map their failures to HttpsError with `{ reason, fields? }` and no internals.
      const httpsError = error instanceof HttpsError ? error : new HttpsError("internal", GENERIC_INTERNAL_MESSAGE);
      const reason = reasonOf(httpsError) ?? (error instanceof HttpsError ? undefined : "UNEXPECTED");
      log({ command, outcome: httpsError.code, ...(reason ? { reason } : {}), ms: now() - started, requestBytes });
      throw httpsError;
    }
  };
}
