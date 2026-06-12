"use client";

import { useState, useEffect } from "react";
import type { SessionData } from "@/lib/auth/session";

export const LOGIN_URL = "https://saint.yebom.org/login?from=bible";

export function useSession() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      setLoading(true);
      fetch("/api/auth/session")
        .then((r) => r.json())
        .then((d) => { if (!cancelled) setSession(d.session); })
        .catch(() => { if (!cancelled) setSession(null); })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    refresh();
    // bfcache(iOS Safari/Android Chrome 백그라운드 복귀) 시 세션 stale 가능 → 재검증
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) refresh();
    };
    window.addEventListener("pageshow", onShow);
    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", onShow);
    };
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession(null);
  };

  return { session, loading, logout, isLoggedIn: !!session?.isLoggedIn };
}
