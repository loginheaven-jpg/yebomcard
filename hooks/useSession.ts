"use client";

import { useState, useEffect } from "react";
import type { SessionData } from "@/lib/auth/session";

const LOGIN_URL = "https://saint.yebom.org/login?from=card";

export function useSession() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => setSession(d.session))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession(null);
  };

  /**
   * 인증이 필요한 액션 전에 호출.
   * 로그인 안 되어 있으면 교적부 로그인으로 리다이렉트.
   * @returns true면 인증됨 → 액션 진행, false면 리다이렉트됨
   */
  const requireAuth = (): boolean => {
    if (session?.isLoggedIn) return true;
    window.location.href = LOGIN_URL;
    return false;
  };

  return { session, loading, logout, requireAuth, isLoggedIn: !!session?.isLoggedIn };
}
