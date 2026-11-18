"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { saveAiDraft } from "@/lib/ideas";
import { LINK_MESSAGES, type LinkProblem, linkProblem, readToken } from "@/lib/suggestions";
import { suggestionsApiFor } from "@/lib/suggestionsApi";
import { useApp } from "./AppProvider";
import { Button, EmptyState } from "@/components/kit";

/** Resolves the email deep link (`?t=<token>`), hands the draft to the event editor and replaces the URL. */
export function SuggestedIdeaOpen() {
  const { api, session } = useApp();
  const router = useRouter();
  const [problem, setProblem] = useState<LinkProblem | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!session || started.current) return;
    started.current = true;
    const token = readToken(window.location.search);
    if (!token) { setProblem("expired"); return; }
    suggestionsApiFor(api, session).resolveIdea(token).then(
      (result) => {
        try { saveAiDraft(window.sessionStorage, result.draft); } catch { /* the editor then opens empty */ }
        router.replace("/events/new/?from=ai");
      },
      (error: unknown) => setProblem(linkProblem(error)),
    );
  }, [api, session, router]);

  if (problem) {
    return (
      <EmptyState role="alert" title={problem === "forbidden" ? "This idea isn’t available to you" : problem === "expired" ? "This link doesn’t work anymore" : "Couldn’t open this idea"} body={LINK_MESSAGES[problem]}
        action={problem === "unavailable" ? <Button onClick={() => window.location.reload()}>Try again</Button> : <Button href="/ideas/">Open Event ideas</Button>} />
    );
  }
  return (
    <div className="sug-opening" role="status">
      <span className="spinner" aria-hidden />
      <p>Opening your event idea...</p>
    </div>
  );
}
