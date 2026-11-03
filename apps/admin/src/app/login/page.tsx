"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "@/components/AppProvider";

export default function Login() {
  const { session, signIn } = useApp();
  const router = useRouter();
  useEffect(() => {
    if (session) router.replace("/events/");
  }, [session, router]);

  return (
    <main className="login">
      <div className="box">
        <h1>DIP Admin</h1>
        <p>Create and manage your company’s activities.</p>
        <div className="persona">
          <button className="btn" onClick={() => void signIn("admin")}>
            Continue as organizer <span aria-hidden>→</span>
          </button>
          <button className="btn ghost" style={{ color: "white", borderColor: "#4a4f63" }} onClick={() => void signIn("member")}>
            Continue as member (no access) <span aria-hidden>→</span>
          </button>
        </div>
        <p className="note">
          Preview mode: data is kept in this browser only. Production sign-in is Google with your work account;
          organizer access is assigned manually and checked by the backend on every request.
        </p>
      </div>
    </main>
  );
}
