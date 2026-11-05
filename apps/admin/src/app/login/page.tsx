"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Faces } from "@/components/Faces";

export default function Login() {
  const { api, session, signIn } = useApp();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const live = api.mode === "live";
  useEffect(() => {
    if (session) router.replace("/events/");
  }, [session, router]);

  async function start() {
    setFailed(false);
    try {
      await signIn("admin");
    } catch {
      setFailed(true); // popup closed or blocked; the button stays available
    }
  }

  return (
    <main className="login">
      <div className="hero-card"><Faces width={760} /></div>
      <section className="login-copy">
        <h1>Organize your team’s activities</h1>
        <p>Create events, set the details and keep them up to date for everyone in your company.</p>
        <div className="login-actions">
          <button className="big-pill dark" onClick={() => void start()}>
            {live ? "Sign in with Google" : "Sign in as organizer"}
          </button>
        </div>
        {failed && <p className="note" role="alert">Sign-in didn’t finish. Try again.</p>}
        <p className="note">
          {live
            ? "Use your work Google account. Organizer access is assigned manually and checked by the backend on every request."
            : "Preview mode: data stays in this browser. Production sign-in is Google with your work account; organizer access is assigned manually and checked by the backend on every request."}
        </p>
      </section>
    </main>
  );
}
