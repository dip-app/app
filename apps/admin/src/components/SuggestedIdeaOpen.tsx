"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { saveAiDraft } from "@/lib/ideas";
import { LINK_MESSAGES, type LinkProblem, linkProblem, readToken } from "@/lib/suggestions";
import { suggestionsApiFor } from "@/lib/suggestionsApi";
import { useApp } from "./AppProvider";

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
      <div className="empty" role="alert">
        <h2>{problem === "forbidden" ? "This idea isn’t available to you" : problem === "expired" ? "This link doesn’t work anymore" : "Couldn’t open this idea"}</h2>
        <p>{LINK_MESSAGES[problem]}</p>
        <div className="empty-action">
          {problem === "unavailable"
            ? <button className="pill-btn gray" onClick={() => window.location.reload()}>Try again</button>
            : <a className="pill-btn gray" href="/ideas/">Open Event ideas</a>}
        </div>
      </div>
    );
  }
  return (
    <div className="sug-opening" role="status">
      <span className="spinner" aria-hidden />
      <p>Opening your event idea...</p>
    </div>
  );
}
