import { z } from "zod";
import type { ResolveSuggestedIdeaResponse } from "../../../generated/models";
import { authorize, requireCaller } from "../../admin/application/context";
import type { AdminStore, Caller, RateLimiter } from "../../admin/application/ports";
import { AdminError, invalid } from "../../admin/domain/errors";
import { MIN_KEY_BYTES } from "../../email/domain/unsubscribeToken";
import { ideaById } from "../domain/catalog";
import { verifySuggestionToken } from "../domain/deepLink";
import { ideaToDraft } from "../domain/draft";
import { fieldsOf } from "./manage";
import type { SuggestionsStore } from "./ports";

export interface ResolveDeps {
  admin: AdminStore;
  store: Pick<SuggestionsStore, "getDigest">;
  /** HMAC key (`EMAIL_UNSUBSCRIBE_KEY`). */
  signingKey: string;
  limiter?: RateLimiter;
  now: () => Date;
}

const RequestSchema = z.strictObject({
  contractVersion: z.literal(1),
  companyId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  token: z.string().min(1).max(512),
});

const badLink = () => invalid(["token"]);

/**
 * resolveSuggestedIdeaV1: turns a signed email link into the editor prefill. The signature and expiry are checked
 * first, then the caller must be an admin of the same company (`ai.generate`). Nothing is stored.
 */
export async function resolveSuggestedIdea(deps: ResolveDeps, rawCaller: Caller | null, data: unknown): Promise<ResolveSuggestedIdeaResponse> {
  const caller = requireCaller(rawCaller);
  const parsed = RequestSchema.safeParse(data);
  if (!parsed.success) throw invalid(fieldsOf(parsed.error));
  const { companyId, token } = parsed.data;
  if (Buffer.byteLength(deps.signingKey, "utf8") < MIN_KEY_BYTES) {
    throw new AdminError("failed-precondition", "AI_UNAVAILABLE", "Suggested ideas aren't available on this server yet.");
  }
  await deps.limiter?.consume(caller.uid);

  const verified = verifySuggestionToken(deps.signingKey, token, Math.floor(deps.now().getTime() / 1000));
  if (!verified.ok) {
    if (verified.reason === "expired") {
      throw new AdminError("failed-precondition", "VALIDATION_FAILED", "This link has expired. Open the latest ideas email or the event ideas page.", ["token"]);
    }
    throw badLink();
  }
  if (verified.companyId !== companyId) throw new AdminError("permission-denied", "COMPANY_MISMATCH", "You can only manage your own company.");
  await deps.admin.runReadOnly(tx => authorize(tx, caller, companyId, "ai.generate"));

  const idea = ideaById(verified.ideaId);
  if (!idea) throw badLink();
  const digest = await deps.store.getDigest(companyId, verified.weekKey);
  const ranked = digest?.ideas.find(i => i.ideaId === idea.id);
  const rationale = ranked?.reasons[0] ?? idea.pitch;
  return { contractVersion: 1, ideaId: idea.id, draft: ideaToDraft(idea, rationale, digest?.memberCount ?? null) };
}
