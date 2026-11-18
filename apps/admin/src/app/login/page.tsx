"use client";
// @i18n-migrated

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { CloudMark } from "@/components/Brand";
import { LoginArt, VALUE_ROWS, ValueIcon } from "@/components/LoginArt";
import { BRAND, t } from "@/lib/i18n";

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
          <span>{BRAND}</span>
        </div>
        <h1>{t("login.title")}</h1>
        <p className="lead">{t("login.lead")}</p>
        <ul className="value-list" role="list">
          {VALUE_ROWS.map((row) => (
            <li key={row.title}>
              <span className="value-icon"><ValueIcon name={row.icon} /></span>
              <span className="value-text"><strong>{t(row.title)}</strong><span>{t(row.text)}</span></span>
            </li>
          ))}
        </ul>
        <div className="login-actions">
          <button className="big-pill dark" onClick={() => void start()}>
            {live ? t("login.google") : t("login.mockAdmin")}
          </button>
          {!live && <button className="big-pill gray" onClick={() => void signIn("organizer").catch(() => setFailed(true))}>{t("login.mockOrganizer")}</button>}
        </div>
        {failed && <p className="note error" role="alert">{t("login.failed")}</p>}
      </section>
      <LoginArt />
    </main>
  );
}
