"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "@/hooks/useSession";
import { isAdmin } from "@/lib/admin";

/** 관리자 전용 신고 알림 벨 — 신고/임시숨김 건수 배지 + /admin/reports 링크.
 *  비관리자에겐 렌더하지 않음. 창 포커스 시 자동 갱신. */
export default function AdminReportBell() {
  const { session } = useSession();
  const admin = isAdmin(session);
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/verse-notes");
      if (res.ok) {
        const d = await res.json();
        setCount((d.items || []).length);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!admin) return;
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [admin, refresh]);

  if (!admin) return null;

  return (
    <a
      href="/admin/reports"
      title="신고된 메모"
      aria-label={`신고 알림${count > 0 ? ` ${count}건` : ""}`}
      className="relative inline-flex items-center justify-center w-8 h-8 rounded-full text-gray-500 dark:text-gray-400 hover:text-[var(--amber)] hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
        />
      </svg>
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </a>
  );
}
