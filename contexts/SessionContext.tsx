"use client";

/**
 * 세션 한 곳 — 앱 전체가 같은 로그인 상태를 본다.
 *
 * 전에는 `useSession` 이 컴포넌트마다 자기 `useState` 를 들고 각자 세션을 물었다. 그래서
 *  - 로그아웃을 눌러도 **다른 인스턴스는 로그인 상태로 남았다.** 특히 `LoginGateProvider` 의 사본이
 *    그대로라 로그아웃 뒤에도 `ensureLogin()` 이 통과했다(로그인 필요 기능이 열림)
 *  - 앱을 열 때 같은 요청이 3~4번 겹쳐 나갔다
 *  - 반대로 탭을 오래 열어 두면 **다시 확인하지 않았다** — 세션 연장 기회를 놓친다
 *
 * ── 체크인이 핵심 기능인 이유 ──
 * 로그인 세션을 늘리는 수단은 교적부 체크인(`GET /api/auth/session`) 하나뿐이다. 교적부는 이 요청에서
 * '로그인 유지' 세션을 하루 한 번 다시 봉인해 내려보낸다. 즉 체크인은 (a) 유효성 확인 (b) **연장**
 * (c) 권한·이름 최신화를 한 번에 한다. 그래서 앱을 열 때와 포커스·복귀 때 부른다(최소 간격 45초 —
 * 교적부에 호출 제한이 없고 매 호출이 DB 왕복이며, 연장은 어차피 하루 한 번이다).
 *
 * ── 판정은 HTTP 상태로만 ──
 * 교적부는 서버 오류(500)에도 본문에 `{isLoggedIn:false}` 를 담는다. 본문을 믿고 분기하면 교적부가
 * 잠깐 아플 때 교인이 통째로 로그아웃된다. **401 일 때만 익명 전환**, 500·네트워크 실패는 그대로 둔다.
 *
 * ── 콜드 스타트: 같은 오리진 라우트를 먼저 읽는다 ──
 * "오류면 기존 상태 유지" 는 앱을 처음 열 때는 지킬 상태가 없다는 뜻이기도 하다. 그래서 같은 오리진의
 * `/api/auth/session`(쿠키 복호화)으로 잠정 상태를 먼저 잡고, 그다음 체크인으로 확정·연장한다.
 * 교적부가 죽어 있어도 유효한 쿠키를 가진 교인이 익명으로 보이지 않고, 첫 화면 깜빡임도 없다.
 * 로컬 쿠키는 '교적부가 폐기했는지' 는 모르므로, 기기 정리 판정(`deviceReady`)은 확정된 뒤에만 켠다.
 *
 * ── localhost·프리뷰 ──
 * 교적부 체크인은 `*.yebom.org` 안에서만 쿠키가 실린다(같은 사이트). localhost·프리뷰에서는 늘 401 이
 * 오므로 아예 부르지 않고 로컬 라우트 판정만 쓴다.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SessionData } from "@/lib/auth/session";
import { markIntentionalLeave } from "@/lib/appExit";
import { clearDeviceData } from "@/lib/auth/clear-device";
import { clearPendingGroupCode, resolveDeviceOwner } from "@/lib/auth/device-owner";

const HUB = "https://saint.yebom.org";
const HOME = "https://bible.yebom.org/";

/** 로그인 화면 — 돌아올 주소는 반드시 인코딩해서 싣는다(쿼리가 붙으면 이어붙이기는 잘린다) */
export const LOGIN_URL = (() => {
  const url = new URL(`${HUB}/login`);
  url.searchParams.set("from", "bible");
  url.searchParams.set("redirect", HOME);
  return url.toString();
})();

/** 교적부 통합 로그아웃 — `.yebom.org` SSO 쿠키를 지우고 홈으로 돌려보낸다 */
const LOGOUT_URL = (() => {
  const url = new URL(`${HUB}/api/auth/logout`);
  url.searchParams.set("return", HOME);
  return url.toString();
})();

/** 교적부 쿠키가 실리는 곳에서만 체크인한다 */
function canCheckIn(): boolean {
  return typeof window !== "undefined" && window.location.hostname.endsWith(".yebom.org");
}

const CHECKIN_MIN_GAP_MS = 45_000;
const EXPIRED_NOTICE = "로그인이 만료되었습니다. 계속하려면 다시 로그인해 주세요.";

type SessionContextValue = {
  session: SessionData | null;
  loading: boolean;
  isLoggedIn: boolean;
  /** 기기 주인 판정이 끝나 동기화해도 되는 상태 — 로그인 동기화·스크랩 이관·그룹 자동참여는 이걸 기다린다 */
  deviceReady: boolean;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [deviceReady, setDeviceReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const lastCheckRef = useRef(0);
  const inFlightRef = useRef(false);
  const loggedInRef = useRef(false); // 401 안내는 '로그인 상태였을 때' 만
  const ownerRef = useRef<string | null>(null); // 기기 주인 판정은 사용자마다 한 번

  /**
   * 세션을 갈아 끼운다. confirmed = 교적부가 확인해 준 값인가(또는 체크인이 불가능한 환경의 로컬 판정인가).
   * 확정된 로그인에서만 기기 주인을 맞추고 `deviceReady` 를 켠다 — 잠정 상태로 남의 데이터를 합치지 않는다.
   */
  const apply = useCallback((next: SessionData | null, confirmed: boolean) => {
    setSession(next);
    const userId = next?.isLoggedIn ? next.user_id : null;
    loggedInRef.current = !!userId;
    if (userId && confirmed) {
      if (ownerRef.current !== userId) {
        ownerRef.current = userId;
        resolveDeviceOwner(userId);
      }
      setDeviceReady(true);
      return;
    }
    if (!userId) {
      ownerRef.current = null;
      setDeviceReady(false);
    }
  }, []);

  /** 같은 오리진 — 쿠키 복호화만 한다. 빠르고 교적부와 무관하다 */
  const readLocalSession = useCallback(async (): Promise<SessionData | null> => {
    try {
      const res = await fetch("/api/auth/session");
      const data = (await res.json()) as { session?: SessionData | null };
      return data?.session ?? null;
    } catch {
      return null;
    }
  }, []);

  const checkIn = useCallback(
    async (force = false) => {
      if (!canCheckIn() || inFlightRef.current) return;
      const now = Date.now();
      if (!force && now - lastCheckRef.current < CHECKIN_MIN_GAP_MS) return;
      inFlightRef.current = true;
      lastCheckRef.current = now;
      try {
        const res = await fetch(`${HUB}/api/auth/session`, { credentials: "include" });
        if (res.status === 200) {
          const data = (await res.json()) as { user?: SessionData };
          apply(data?.user ?? null, true);
        } else if (res.status === 401) {
          // 만료·강제 로그아웃·승인 취소 — 이유는 가리지 않는다. 저장소는 지우지 않고 화면만 익명으로.
          if (loggedInRef.current) setNotice(EXPIRED_NOTICE);
          clearPendingGroupCode(); // 남의 그룹에 자동 참여하지 않도록
          apply(null, true);
        }
        // 500·그 밖의 응답 → 기존 상태 유지 (교적부 장애로 로그아웃시키지 않는다)
      } catch {
        /* 네트워크 오류 → 기존 상태 유지 */
      } finally {
        inFlightRef.current = false;
      }
    },
    [apply],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      const local = await readLocalSession();
      if (!alive) return;
      // 체크인을 못 하는 곳(localhost·프리뷰)에서는 로컬 판정이 곧 확정이다
      apply(local, !canCheckIn());
      setLoading(false);
      await checkIn(true);
    })();

    const onFocus = () => void checkIn();
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkIn();
    };
    // bfcache 복귀(iOS 사파리·안드로이드 크롬)는 세션이 오래됐을 수 있다
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void checkIn(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [apply, checkIn, readLocalSession]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  /**
   * 로그아웃 — 이 기기의 흔적을 먼저 지우고 교적부 통합 로그아웃으로 넘긴다(5개 앱 공통 순서).
   * `beforeunload` 종료 확인창에 걸리지 않도록 이동 직전에 의도된 이탈로 표시한다.
   */
  const logout = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!window.confirm("로그아웃하시겠습니까?\n이 기기에 저장된 로그인 정보가 모두 지워집니다.")) return;
    markIntentionalLeave();
    await clearDeviceData();
    if (!canCheckIn()) {
      // localhost·프리뷰 — 교적부 통합 로그아웃은 `.yebom.org` 쿠키가 없어 아무것도 지우지 못한다.
      // 개발 중에 로그아웃이 먹통으로 보이지 않게 이 환경에서만 로컬 라우트로 쿠키를 만료시킨다.
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } catch {
        /* 무시 */
      }
      window.location.replace("/");
      return;
    }
    window.location.replace(LOGOUT_URL);
  }, []);

  return (
    <SessionContext.Provider
      value={{ session, loading, isLoggedIn: !!session?.isLoggedIn, deviceReady, logout }}
    >
      {children}
      {notice && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2.5 bg-gray-900 text-white text-sm rounded-xl shadow-lg z-[156] animate-[fadeInUp_0.2s_ease-out]">
          {notice}
        </div>
      )}
    </SessionContext.Provider>
  );
}
