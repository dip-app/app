import type { SuggestionIdeaVariables, TemplateVariables } from "../../email/domain/templates/types";
import { ideaById } from "../domain/catalog";
import { signSuggestionToken, suggestionLinkURL } from "../domain/deepLink";
import type { StoredDigest } from "./ports";

export interface VariableOptions {
  companyId: string;
  /** HMAC key (`EMAIL_UNSUBSCRIBE_KEY`), at least 32 bytes. */
  signingKey: string;
  /** `https://letsdip.work`. */
  origin: string;
  nowSeconds: number;
}

/**
 * Allow-listed `admin_suggestions` variables for a digest: copy comes from the curated catalog by idea id (ids the
 * catalog no longer knows are dropped), each idea gets its own signed deep link.
 */
export function digestVariables(digest: StoredDigest, options: VariableOptions): TemplateVariables["admin_suggestions"] {
  const ideas: SuggestionIdeaVariables[] = [];
  for (const ranked of digest.ideas) {
    const idea = ideaById(ranked.ideaId);
    if (!idea) continue;
    const token = signSuggestionToken(options.signingKey, { companyId: options.companyId, weekKey: digest.weekKey, ideaId: idea.id }, options.nowSeconds);
    ideas.push({
      ideaId: idea.id,
      title: idea.title,
      pitch: idea.pitch,
      theme: idea.theme,
      fitLabel: ranked.label,
      reasons: ranked.reasons.slice(0, 2),
      facts: ranked.facts,
      whenHint: ranked.whenHint,
      linkURL: suggestionLinkURL(options.origin, token),
    });
  }
  return { weekKey: digest.weekKey, weekLabel: digest.weekLabel, dataNote: digest.dataNote, ideas };
}
