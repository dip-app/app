"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "@/components/AppProvider";
import { Faces } from "@/components/Faces";

export default function Login() {
  const { session, signIn } = useApp();
  const router = useRouter();
  useEffect(() => {
    if (session) router.replace("/events/");
  }, [session, router]);

  return (
    <main className="login">
      <div className="hero-card"><Faces size={120} /></div>
      <section className="login-copy">
        <h1>Organize your team’s activities</h1>
        <p>Create events, set the details and keep them up to date for everyone in your company.</p>
        <div className="login-actions">
          <button className="big-pill dark" onClick={() => void signIn("admin")}>Continue as organizer</button>
          <button className="big-pill gray" onClick={() => void signIn("member")}>Continue as member (no access)</button>
        </div>
        <p className="note">
          Preview mode: data stays in this browser. Production sign-in is Google with your work account; organizer access is
          assigned manually and checked by the backend on every request.
        </p>
      </section>
    </main>
  );
}
