"use client";

import { useState, useEffect } from "react";
import {
  captureInstallPrompt,
  clearInstallPrompt,
  triggerInstall,
  isStandaloneMode,
} from "@/lib/pwaInstall";

export default function PwaInstall() {
  const [showInstallBtn, setShowInstallBtn] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    // 서비스워커 등록 — Chrome 설치 가능 조건(beforeinstallprompt 발화) 충족
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const ua = navigator.userAgent.toLowerCase();
    const installed = isStandaloneMode() || localStorage.getItem("pwa-installed") === "1";

    // beforeinstallprompt 는 항상 전역 캡처(설정 '앱으로 설치'에서 재사용). 플로팅 버튼은 미설치일 때만.
    const handler = (e: Event) => {
      e.preventDefault();
      captureInstallPrompt(e);
      if (!installed) setShowInstallBtn(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const installedHandler = () => {
      clearInstallPrompt();
      localStorage.setItem("pwa-installed", "1");
      setShowInstallBtn(false);
    };
    window.addEventListener("appinstalled", installedHandler);

    if (!installed) {
      // 인앱 브라우저(카카오/네이버 등) → 외부 Chrome 으로 리다이렉트
      const isInApp = /kakaotalk|naver|line|instagram|fbav/i.test(ua);
      if (isInApp && /android/i.test(ua)) {
        const url = window.location.href;
        window.location.href = `intent://${url.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;end`;
      }
      // iOS Safari → 설치 가이드 버튼 (2초 후)
      const isIOS = /iphone|ipad|ipod/i.test(ua) && !("MSStream" in window);
      const isSafari = /safari/i.test(ua) && !/chrome|crios|fxios/i.test(ua);
      if (isIOS && isSafari) setTimeout(() => setShowInstallBtn(true), 2000);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  // 플로팅 버튼은 10초만 노출 후 자동으로 사라짐 (닫아도 다음 노출 기회에 다시 뜸)
  useEffect(() => {
    if (!showInstallBtn) return;
    const t = setTimeout(() => setShowInstallBtn(false), 10000);
    return () => clearTimeout(t);
  }, [showInstallBtn]);

  const handleInstall = async () => {
    const r = await triggerInstall();
    if (r === "accepted") {
      localStorage.setItem("pwa-installed", "1");
      setShowInstallBtn(false);
    } else if (r === "unavailable") {
      // iOS 등 네이티브 프롬프트 불가 → 수동 가이드
      setShowIOSGuide(true);
    }
    // dismissed → 유지(다음에 다시 노출)
  };

  if (!showInstallBtn && !showIOSGuide) return null;

  return (
    <>
      {/* 설치 버튼 */}
      <button
        onClick={handleInstall}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full
          bg-[var(--amber)] px-4 py-3 text-sm font-medium text-white shadow-lg
          hover:bg-[var(--amber-deep)] active:scale-95 transition-all"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"
          />
        </svg>
        앱 설치
      </button>

      {/* iOS 설치 가이드 모달 */}
      {showIOSGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => setShowIOSGuide(false)}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl bg-white p-6 pb-10"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-center text-lg font-bold text-gray-900">
              앱 설치 방법 (iOS)
            </h3>
            <div className="space-y-4 text-sm text-gray-700">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-900 font-bold">
                  1
                </span>
                <span>
                  하단 <strong>공유 버튼</strong> (□↑) 탭
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-900 font-bold">
                  2
                </span>
                <span>
                  <strong>홈 화면에 추가</strong> 선택
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-900 font-bold">
                  3
                </span>
                <span>
                  <strong>추가</strong> 탭
                </span>
              </div>
            </div>
            <button
              onClick={() => setShowIOSGuide(false)}
              className="mt-6 w-full rounded-xl bg-gray-100 py-3 text-sm font-medium text-gray-700"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </>
  );
}
