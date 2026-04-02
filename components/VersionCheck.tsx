"use client";

import { useState, useEffect, useRef } from "react";

const CURRENT_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID;
const CHECK_INTERVAL = 5 * 60 * 1000; // 5분

export default function VersionCheck() {
  const [showBanner, setShowBanner] = useState(false);
  const lastCheck = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const isUserTyping = () => {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return (
      tag === "input" ||
      tag === "textarea" ||
      (el as HTMLElement).isContentEditable
    );
  };

  const checkVersion = async () => {
    if (showBanner) return;

    const now = Date.now();
    if (now - lastCheck.current < 30_000) return; // 30초 쿨다운
    lastCheck.current = now;

    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;
      const { buildId } = await res.json();

      if (buildId && buildId !== CURRENT_BUILD_ID) {
        if (isUserTyping()) {
          setShowBanner(true);
        } else {
          window.location.reload();
        }
      }
    } catch {
      // 네트워크 에러 무시
    }
  };

  useEffect(() => {
    intervalRef.current = setInterval(checkVersion, CHECK_INTERVAL);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") checkVersion();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!showBanner) return null;

  return (
    <div
      onClick={() => window.location.reload()}
      className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 cursor-pointer rounded-full
        bg-gray-900 px-5 py-2.5 text-sm font-medium text-white shadow-lg
        animate-bounce hover:bg-gray-800"
    >
      새 버전이 있습니다 · 탭하여 업데이트
    </div>
  );
}
