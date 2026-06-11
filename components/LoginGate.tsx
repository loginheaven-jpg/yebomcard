"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useSession, LOGIN_URL } from "@/hooks/useSession";

/**
 * 공용 로그인 게이트.
 *
 * 기존엔 보호 액션마다 `requireAuth()` 가 곧장 외부 SSO 로 window.location.href 점프해
 * 사용자가 경고 없이 앱을 이탈했다. 찬송가 악보 보기만 인앱 "로그인 필요" 모달을 썼는데,
 * 그 패턴을 공용화해 모든 게이트를 통일한다.
 *
 * - `ensureLogin(label)` 이 true → 액션 진행
 * - 세션 로딩 중 → false + "로그인 확인 중..." 토스트 (race 차단)
 * - 미로그인 → false + 인앱 모달. 모달의 "로그인" 클릭 시에만 외부 이동.
 */
type LoginGateContextValue = {
  ensureLogin: (actionLabel?: string) => boolean;
  isLoggedIn: boolean;
  loading: boolean;
};

const LoginGateContext = createContext<LoginGateContextValue | null>(null);

export function useLoginGate(): LoginGateContextValue {
  const ctx = useContext(LoginGateContext);
  if (!ctx) {
    throw new Error("useLoginGate must be used within <LoginGateProvider>");
  }
  return ctx;
}

export function LoginGateProvider({ children }: { children: ReactNode }) {
  const { isLoggedIn, loading } = useSession();
  const [promptLabel, setPromptLabel] = useState<string | null>(null); // null = 모달 닫힘
  const [loadingHint, setLoadingHint] = useState(false);

  const ensureLogin = useCallback(
    (actionLabel?: string): boolean => {
      if (loading) {
        // 세션 fetch 미완료 — race 로 인한 의도치 않은 점프 차단
        setLoadingHint(true);
        setTimeout(() => setLoadingHint(false), 1500);
        return false;
      }
      if (isLoggedIn) return true;
      setPromptLabel(actionLabel ?? "");
      return false;
    },
    [loading, isLoggedIn]
  );

  return (
    <LoginGateContext.Provider value={{ ensureLogin, isLoggedIn, loading }}>
      {children}

      {/* 세션 확인 중 안내 (race 차단) */}
      {loadingHint && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2.5 bg-gray-900 text-white text-sm rounded-xl shadow-lg z-[156] animate-[fadeInUp_0.2s_ease-out]">
          로그인 확인 중...
        </div>
      )}

      {/* 로그인 필요 모달 (찬송가 악보 모달 패턴 공용화) */}
      {promptLabel !== null && (
        <div className="fixed inset-0 z-[155] bg-black/60 flex items-center justify-center animate-[fadeInUp_0.2s_ease-out]">
          <div className="w-[90%] max-w-sm rounded-2xl p-6 shadow-xl bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100">
            <h3 className="text-lg font-bold mb-3 text-center">로그인 필요</h3>
            <p className="text-center mb-6 leading-relaxed text-gray-600 dark:text-gray-300">
              {promptLabel ? (
                <>
                  {`'${promptLabel}' 기능은 로그인 후`}
                  <br />
                  이용하실 수 있습니다.
                </>
              ) : (
                <>
                  로그인 후
                  <br />
                  이용하실 수 있습니다.
                </>
              )}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setPromptLabel(null)}
                className="flex-1 py-3 rounded-xl font-bold transition-colors bg-gray-100 hover:bg-gray-200 text-gray-600 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300"
              >
                취소
              </button>
              <button
                onClick={() => {
                  window.location.href = LOGIN_URL;
                }}
                className="flex-1 py-3 bg-[var(--amber)] hover:bg-[var(--amber-deep)] text-white rounded-xl font-bold transition-colors shadow-sm"
              >
                로그인
              </button>
            </div>
          </div>
        </div>
      )}
    </LoginGateContext.Provider>
  );
}
