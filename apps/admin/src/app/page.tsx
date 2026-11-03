"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "@/components/AppProvider";

export default function Home() {
  const { session } = useApp();
  const router = useRouter();
  useEffect(() => {
    router.replace(session ? "/events/" : "/login/");
  }, [session, router]);
  return null;
}
