"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { CloudMark } from "@/components/Brand";
import { LoginArt, VALUE_ROWS, ValueIcon } from "@/components/LoginArt";

export default function Login() {
  const { api, session, signIn } = useApp();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const live = api.mode === "live";
  useEffect(() => {
    if (session) router.replace("/overview/");
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
      <section className="login-copy">
        <div className="login-brand">
          <CloudMark size={44} />
          <span>DIP Admin</span>
        </div>
        <h1>Organize your team’s activities</h1>
        <p className="lead">The organizer portal for DIP. Plan events, keep the albums tidy and look after your people, all in one place.</p>
        <ul className="value-list" role="list">
          {VALUE_ROWS.map((row) => (
            <li key={row.title}>
              <span className="value-icon"><ValueIcon name={row.icon} /></span>
              <span className="value-text"><strong>{row.title}</strong><span>{row.text}</span></span>
            </li>
          ))}
        </ul>
        <div className="login-actions">
          <button className="big-pill dark" onClick={() => void start()}>
            {live ? "Sign in with Google" : "Sign in as admin"}
          </button>
          {!live && <button className="big-pill gray" onClick={() => void signIn("organizer").catch(() => setFailed(true))}>Preview as organizer</button>}
        </div>
        {failed && <p className="note error" role="alert">Sign-in didn’t finish. Try again.</p>}
      </section>
      <LoginArt />
    </main>
  );
}
