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

  /**
   * 인증이 필요한 액션 전에 호출.
   * 로그인 안 되어 있으면 교적부 로그인으로 리다이렉트.
   *
   * loading 중에는 리다이렉트 보류하고 false 반환 — 세션 fetch 응답 전
   * race condition 으로 인한 의도치 않은 로그인 페이지 점프 차단.
   *
   * @returns true면 인증됨 → 액션 진행, false면 리다이렉트되었거나 로딩 중
   */
  const requireAuth = (): boolean => {
    if (loading) return false; // race 차단 — 호출자는 보호 액션 skip
    if (session?.isLoggedIn) return true;
    window.location.href = LOGIN_URL;
    return false;
  };

  return { session, loading, logout, requireAuth, isLoggedIn: !!session?.isLoggedIn };
}
